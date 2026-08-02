import { Injectable } from '@nestjs/common';

import { AppointmentsService } from '../../appointments/appointments.service';
import { ConversationsService } from '../../conversations/conversations.service';
import type { Conversation } from '../../conversations/entities/conversation.entity';

/**
 * Contexto conversacional del asistente.
 *
 * Quedó reducido a lo que sirve al rol nuevo de la IA. Todo el aparato de
 * entidades acumuladas —`mergeEntitiesForStore`, `pendingBooking`,
 * `lastAvailabilityKey`, `appointmentCreated`— desapareció con el flujo de
 * reserva conversacional: los datos de una reserva viven en `booking_sessions`,
 * con esquema explícito.
 */
@Injectable()
export class AssistantContextService {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly appointmentsService: AppointmentsService,
  ) {}

  /** Evita repetir la presentación larga en cada saludo. */
  async markAssistantIntroduced(conversation: Conversation): Promise<void> {
    if (conversation.contextJson?.hasAssistantIntroduced === true) return;

    const nextContext = {
      ...(conversation.contextJson ?? {}),
      hasAssistantIntroduced: true,
    };

    await this.conversationsService.update(conversation.id, {
      contextJson: nextContext,
    });
    conversation.contextJson = nextContext;
  }

  /**
   * Resumen de la última cita del cliente, leído de la base.
   *
   * Antes se armaba desde `conversation.contextJson.pendingBooking`, es decir,
   * desde lo que la IA había ido acumulando. Ahora sale de la cita real: si no
   * existe, se dice que no hay, en lugar de describir una reserva que quizá nunca
   * se creó.
   */
  async buildLastAppointmentSummary(params: {
    tenantId: string;
    clientId: string;
    timezone: string;
  }): Promise<string | null> {
    const { tenantId, clientId, timezone } = params;

    const appointment = await this.appointmentsService.findLastByClient(
      tenantId,
      clientId,
    );
    if (!appointment) return null;

    const serviceNames = (appointment.services ?? [])
      .map((segment) => segment.service?.name)
      .filter((name): name is string => typeof name === 'string');

    const staffNames = Array.from(
      new Set(
        (appointment.services ?? [])
          .map((segment) => segment.staff?.name)
          .filter((name): name is string => typeof name === 'string'),
      ),
    );

    const startTime =
      appointment.startTime instanceof Date
        ? appointment.startTime
        : new Date(appointment.startTime as unknown as string);

    const formatted = new Intl.DateTimeFormat('es-AR', {
      timeZone: timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(startTime);

    const lines = [
      'Tu próxima cita:',
      `- Servicio: ${serviceNames.length > 0 ? serviceNames.join(', ') : 'No definido'}`,
      `- Fecha y hora: ${formatted}`,
    ];

    if (staffNames.length > 0) {
      lines.push(`- Profesional: ${staffNames.join(', ')}`);
    }

    return lines.join('\n');
  }
}
