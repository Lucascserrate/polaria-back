import type { AssistantContextService } from '../services/assistant-context.service';

export const buildPendingBookingSummary = (params: {
  services: string[];
  staff: string | null;
  date: string;
  time: string;
}): string => {
  const { services, staff, date, time } = params;

  const staffLabel =
    typeof staff === 'string' && staff.trim().length > 0
      ? staff
      : 'sin preferencia';

  return `Resumen de tu cita:\n- Servicio: ${
    services.length > 0 ? services.join(', ') : 'No definido'
  }\n- Barbero: ${staffLabel}\n- Fecha: ${date}\n- Hora: ${time}\n¿Deseas confirmar la cita?`;
};

export const buildBackendSummaryReply = async (params: {
  tenantId: string;
  conversation: { contextJson?: Record<string, unknown> };
  timezone: string;
  assistantContextService: Pick<
    AssistantContextService,
    'buildLastAppointmentSummary'
  >;
}): Promise<string> => {
  const { tenantId, conversation, timezone, assistantContextService } = params;

  const pending = conversation.contextJson?.pendingBooking as
    | {
        date?: string;
        time?: string;
        staffId?: string;
      }
    | undefined;
  const entities = conversation.contextJson?.entities as
    | {
        services?: string[] | null;
        staff?: string | null;
      }
    | undefined;
  const lastBookedEntities = conversation.contextJson?.lastBookedEntities as
    | {
        staff?: string | null;
      }
    | undefined;

  if (pending?.date && pending?.time) {
    const services = Array.isArray(entities?.services)
      ? entities?.services
      : [];
    const staff =
      typeof pending.staffId === 'string' && pending.staffId.trim().length > 0
        ? pending.staffId
        : typeof entities?.staff === 'string'
          ? entities.staff
          : typeof lastBookedEntities?.staff === 'string'
            ? lastBookedEntities.staff
            : null;
    return buildPendingBookingSummary({
      services,
      staff,
      date: pending.date,
      time: pending.time,
    });
  }

  const appointmentId =
    typeof conversation.contextJson?.appointmentId === 'string'
      ? conversation.contextJson.appointmentId
      : undefined;

  if (appointmentId) {
    const summary = await assistantContextService.buildLastAppointmentSummary({
      tenantId,
      appointmentId,
      timezone,
    });
    if (summary) return summary;
  }

  return 'Aún no tengo una cita en curso para resumir. Dime qué servicio quieres agendar y para qué día.';
};
