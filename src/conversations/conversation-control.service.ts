import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';

import {
  Conversation,
  ConversationState,
} from './entities/conversation.entity';

/**
 * Tiempo de inactividad tras el cual una conversación transferida vuelve sola a
 * Polaria.
 *
 * Es una red de seguridad, no el camino normal —ese es el botón del panel—. Sin
 * ella, una conversación transferida una vez queda muda para siempre, que es la
 * forma silenciosa de perder todas las reservas futuras de ese cliente.
 *
 * En minutos y no en horas porque a esta escala la unidad importa: una hora de
 * silencio ya es mucho para alguien que escribió pidiendo un turno.
 *
 * El techo real es este valor **más** el intervalo del barrido, que no puede
 * detectar un vencimiento antes de correr. Ver `ConversationHandoffCleanupJob`.
 */
export const HANDOFF_TTL_MINUTES = 60;

export const HANDOFF_REASONS = {
  CLIENT_REQUEST: 'CLIENT_REQUEST',
} as const;

/**
 * Una conversación esperando atención humana, como la muestra el panel.
 *
 * Es una proyección y no la entidad porque `Conversation` arrastra el contexto
 * de la conversación y los datos del negocio, y nada de eso hace falta para
 * decidir a quién hay que responder.
 */
export type PendingHandoff = {
  conversationId: string;
  clientId: string;
  clientName: string | null;
  /** En formato internacional, para poder abrir el chat de WhatsApp. */
  clientPhone: string | null;
  /** ISO 8601. Cuánto lleva esperando se calcula en la interfaz. */
  handoffRequestedAt: string | null;
  handoffReason: string | null;
  lastMessageAt: string | null;
};

/**
 * Control de quién atiende una conversación: Polaria o una persona.
 *
 * El traspaso solo puede iniciarse desde el menú, nunca durante una reserva: un
 * flujo de reserva empezado se termina o se cancela, y mezclar ambos dejaría la
 * conversación congelada y muda al mismo tiempo.
 */
@Injectable()
export class ConversationControlService {
  private readonly logger = new Logger(ConversationControlService.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
  ) {}

  isHandedOff(conversation: Conversation): boolean {
    return conversation.currentState === ConversationState.HUMAN_HANDOFF;
  }

  /** Deja la conversación en manos del negocio. Polaria deja de responder. */
  async handOff(params: {
    conversation: Conversation;
    reason?: string;
    now?: Date;
  }): Promise<Conversation> {
    const { conversation } = params;
    const now = params.now ?? new Date();

    conversation.currentState = ConversationState.HUMAN_HANDOFF;
    conversation.handoffRequestedAt = now;
    conversation.handoffReason =
      params.reason ?? HANDOFF_REASONS.CLIENT_REQUEST;

    this.logger.log(
      `Conversación transferida a humano (conversationId=${conversation.id}, reason=${conversation.handoffReason}).`,
    );

    return this.conversationRepository.save(conversation);
  }

  /**
   * Devuelve la conversación a Polaria.
   *
   * No envía ningún aviso a propósito: volver en silencio y esperar el próximo
   * mensaje es menos confuso que anunciar un "ya volví" sin contexto, y evita
   * hablar por encima de la persona que venía atendiendo.
   */
  async resume(conversation: Conversation): Promise<Conversation> {
    conversation.currentState = ConversationState.IDLE;
    conversation.handoffRequestedAt = null;
    conversation.handoffReason = null;

    this.logger.log(
      `Conversación devuelta a Polaria (conversationId=${conversation.id}).`,
    );

    return this.conversationRepository.save(conversation);
  }

  /**
   * Devuelve a Polaria una conversación del negocio indicado.
   *
   * El `tenantId` va en el `where` y no en un chequeo posterior para que una
   * conversación de otro negocio sea indistinguible de una inexistente: así el
   * endpoint no confirma la existencia de ids ajenos.
   *
   * Que ya esté en manos de Polaria no es un error: dos personas pueden tocar el
   * botón a la vez, y la segunda tiene que encontrar el resultado que esperaba.
   */
  async resumeById(params: {
    id: string;
    tenantId: string;
  }): Promise<Conversation | null> {
    const conversation = await this.conversationRepository.findOneBy({
      id: params.id,
      tenantId: params.tenantId,
    });
    if (!conversation) return null;
    if (!this.isHandedOff(conversation)) return conversation;

    return this.resume(conversation);
  }

  /** Conversaciones esperando atención humana, la que espera hace más primero. */
  async findPendingHandoffs(tenantId: string): Promise<PendingHandoff[]> {
    const conversations = await this.conversationRepository.find({
      where: { tenantId, currentState: ConversationState.HUMAN_HANDOFF },
      relations: { client: true },
      order: { handoffRequestedAt: 'ASC' },
    });

    return conversations.map((conversation) => ({
      conversationId: conversation.id,
      clientId: conversation.clientId,
      clientName: conversation.client?.name ?? null,
      clientPhone: conversation.client?.phone ?? null,
      handoffRequestedAt:
        conversation.handoffRequestedAt?.toISOString() ?? null,
      handoffReason: conversation.handoffReason ?? null,
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
    }));
  }

  /** Devuelve a Polaria las conversaciones transferidas hace demasiado. */
  async resumeStale(now: Date = new Date()): Promise<number> {
    const threshold = new Date(now.getTime() - HANDOFF_TTL_MINUTES * 60 * 1000);

    const result = await this.conversationRepository.update(
      {
        currentState: ConversationState.HUMAN_HANDOFF,
        handoffRequestedAt: LessThan(threshold),
      },
      {
        currentState: ConversationState.IDLE,
        handoffRequestedAt: null,
        handoffReason: null,
      },
    );

    return result.affected ?? 0;
  }
}
