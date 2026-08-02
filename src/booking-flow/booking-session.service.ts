import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { In, LessThan, Not, Repository } from 'typeorm';

import {
  BOOKING_SESSION_TTL_MINUTES,
  BookingSessionState,
  StaffPreference,
  TERMINAL_STATES,
} from './booking-flow.types';
import { BookingSession } from './entities/booking-session.entity';

export type BookingSelectionPatch = {
  selectedDate?: string | null;
  selectedServiceId?: string | null;
  staffPreference?: StaffPreference | null;
  selectedStaffId?: string | null;
  selectedSlotStart?: Date | null;
  pageOffset?: number;
};

/**
 * Ciclo de vida de las sesiones de reserva: creación, avance, caducidad y cierre.
 *
 * Cada avance incrementa `stepVersion` y renueva `expiresAt`. Esas dos
 * operaciones son las que hacen descartables las interacciones viejas y
 * detectables las sesiones abandonadas.
 */
@Injectable()
export class BookingSessionService {
  constructor(
    @InjectRepository(BookingSession)
    private readonly bookingSessionRepository: Repository<BookingSession>,
  ) {}

  /** Sesión abierta de un cliente, si existe. */
  findActive(params: {
    tenantId: string;
    clientId: string;
  }): Promise<BookingSession | null> {
    return this.bookingSessionRepository.findOne({
      where: {
        tenantId: params.tenantId,
        clientId: params.clientId,
        state: notTerminal(),
      },
      order: { createdAt: 'DESC' },
    });
  }

  findByToken(token: string): Promise<BookingSession | null> {
    return this.bookingSessionRepository.findOne({ where: { token } });
  }

  /**
   * Abre una sesión nueva. Si ya había una abierta, se cierra primero: un cliente
   * no puede tener dos reservas en curso, y dejar la anterior viva volvería
   * ambiguo qué componente contesta cada interacción.
   */
  async start(params: {
    tenantId: string;
    clientId: string;
    conversationId?: string;
    now: Date;
  }): Promise<BookingSession> {
    const existing = await this.findActive(params);
    if (existing) {
      await this.close(
        existing,
        BookingSessionState.CANCELLED,
        'RESTARTED',
        params.now,
      );
    }

    return this.bookingSessionRepository.save(
      this.bookingSessionRepository.create({
        tenantId: params.tenantId,
        clientId: params.clientId,
        conversationId: params.conversationId,
        token: generateSessionToken(),
        state: BookingSessionState.ASK_SERVICE,
        stepVersion: 1,
        expiresAt: expiryFrom(params.now),
        lastInteractionAt: params.now,
      }),
    );
  }

  /**
   * Avanza la sesión a un paso nuevo.
   *
   * Incrementar `stepVersion` invalida de inmediato el componente anterior, que es
   * lo que neutraliza el doble toque: la segunda pulsación llega con la versión
   * vieja y se descarta.
   */
  advance(params: {
    session: BookingSession;
    state: BookingSessionState;
    selection?: BookingSelectionPatch;
    metaMessageId?: string | null;
    now: Date;
  }): Promise<BookingSession> {
    const { session, state, selection, metaMessageId, now } = params;

    // Cambiar de paso invalida la paginación del anterior. Si el llamador la fija
    // explícitamente (por ejemplo, "ver más" dentro del mismo paso), manda él.
    const changesStep = state !== session.state;
    if (changesStep && selection?.pageOffset === undefined) {
      session.pageOffset = 0;
    }

    Object.assign(session, selection ?? {});
    session.state = state;
    session.stepVersion += 1;
    session.expiresAt = expiryFrom(now);
    session.lastInteractionAt = now;
    if (metaMessageId) session.lastMetaMessageId = metaMessageId;

    return this.bookingSessionRepository.save(session);
  }

  /**
   * Reenvía el paso actual sin avanzar.
   *
   * Se usa cuando llega texto libre con el flujo abierto, o cuando el horario
   * elegido se ocupó. Renueva la caducidad pero **también** incrementa la versión,
   * porque se está emitiendo un componente nuevo y el anterior debe morir.
   */
  reissue(params: {
    session: BookingSession;
    selection?: BookingSelectionPatch;
    metaMessageId?: string | null;
    now: Date;
  }): Promise<BookingSession> {
    return this.advance({
      session: params.session,
      state: params.session.state,
      selection: params.selection,
      metaMessageId: params.metaMessageId,
      now: params.now,
    });
  }

  /** Registra el mensaje procesado sin alterar el paso ni la caducidad. */
  markMetaMessageProcessed(
    session: BookingSession,
    metaMessageId: string | null | undefined,
  ): Promise<BookingSession> {
    if (!metaMessageId) return Promise.resolve(session);
    session.lastMetaMessageId = metaMessageId;
    return this.bookingSessionRepository.save(session);
  }

  async complete(params: {
    session: BookingSession;
    appointmentId: string;
    metaMessageId?: string | null;
    now: Date;
  }): Promise<BookingSession> {
    const { session, appointmentId, metaMessageId, now } = params;

    session.appointmentId = appointmentId;
    session.state = BookingSessionState.COMPLETED;
    session.stepVersion += 1;
    session.lastInteractionAt = now;
    session.closedAt = now;
    session.closedReason = 'CONFIRMED';
    if (metaMessageId) session.lastMetaMessageId = metaMessageId;

    return this.bookingSessionRepository.save(session);
  }

  close(
    session: BookingSession,
    state: BookingSessionState,
    reason: string,
    now: Date,
  ): Promise<BookingSession> {
    session.state = state;
    session.closedAt = now;
    session.closedReason = reason;
    session.lastInteractionAt = now;
    return this.bookingSessionRepository.save(session);
  }

  cancel(
    session: BookingSession,
    now: Date,
    reason = 'CANCELLED_BY_CLIENT',
  ): Promise<BookingSession> {
    return this.close(session, BookingSessionState.CANCELLED, reason, now);
  }

  expire(session: BookingSession, now: Date): Promise<BookingSession> {
    return this.close(session, BookingSessionState.EXPIRED, 'TTL', now);
  }

  /**
   * Cierra en lote las sesiones vencidas. Pensado para una tarea periódica: la
   * caducidad se detecta igualmente al recibir una interacción, pero sin barrido
   * las sesiones abandonadas quedan abiertas para siempre.
   */
  async expireStale(now: Date): Promise<number> {
    const result = await this.bookingSessionRepository.update(
      {
        state: notTerminal(),
        expiresAt: LessThan(now),
      },
      {
        state: BookingSessionState.EXPIRED,
        closedAt: now,
        closedReason: 'TTL_SWEEP',
      },
    );

    return result.affected ?? 0;
  }
}

function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + BOOKING_SESSION_TTL_MINUTES * 60_000);
}

/** Token corto, imposible de adivinar y sin el separador del codec. */
function generateSessionToken(): string {
  return randomBytes(8).toString('hex');
}

/** Condición "estado no terminal", usada para localizar sesiones abiertas. */
function notTerminal() {
  return Not(In([...TERMINAL_STATES]));
}
