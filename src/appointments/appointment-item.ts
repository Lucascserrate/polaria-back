import { pickReminderToShow } from '../reminders/appointment-reminders.rules';
import type { Appointment } from './entities/appointment.entity';
import type { AppointmentStatus } from './entities/appointment.entity';

/**
 * La forma en que una cita sale del backend, y el único lugar donde se arma.
 *
 * Antes había dos mapeos casi iguales —uno en el listado y otro en la agenda— y
 * ya habían empezado a separarse: el listado devolvía `endTime` y la agenda no,
 * y cada uno elegía el recordatorio a mostrar con su propio criterio. Cualquier
 * campo nuevo tenía que agregarse dos veces para no dejar una pantalla atrás.
 */

/**
 * Un tramo de la cita: un servicio, con quién lo hace y cuándo.
 *
 * Existe porque una cita de dos servicios puede repartirse entre dos
 * profesionales, y cada tramo tiene su propio horario. La agenda por
 * profesional necesita exactamente eso: en la columna de Diego va su tramo, no
 * la cita entera. Es dato que la base ya guarda en `appointment_services`.
 */
export interface AppointmentSegmentItem {
  /** `null` si el profesional fue borrado físicamente alguna vez. */
  staffId: string | null;
  staffName: string | null;
  /**
   * Token de color del profesional, para distinguir sus citas en la agenda.
   *
   * Viaja por **tramo** y no por cita porque el color identifica a una persona, y
   * una cita repartida entre dos no tiene un color: tiene dos. Quien dibuja
   * decide qué hacer con eso —en la vista por profesional cada tramo va en su
   * columna, y en la semanal una cita compartida no se pinta de ninguno de los
   * dos—.
   *
   * `null` cuando nadie eligió color. El cliente cae a uno derivado del id, así
   * que un equipo sin colores configurados igual se distingue.
   */
  staffColor: string | null;
  serviceId: string;
  serviceName: string | null;
  startTime: string;
  endTime: string;
  /** Lo pactado al reservar, no lo que el servicio cuesta hoy. */
  price: number;
  durationMinutes: number;
}

export interface AppointmentItem {
  id: string;
  startTime: string;
  /** Instante de fin. La agenda calcula la altura de la cita con estos dos. */
  endTime: string;
  startTimeFormatted: string;
  endTimeFormatted: string;
  status: AppointmentStatus;
  clientName?: string;
  /** `'Varios'` cuando la atienden dos profesionales. Para el detalle, ver `segments`. */
  staffName?: string;
  businessName?: string;
  serviceNames: string[];
  totalDuration: number;
  timezone: string;
  segments: AppointmentSegmentItem[];
  /**
   * Recordatorio de esta cita, si hay alguno. Permite ver desde la agenda si el
   * aviso salió y, cuando no, por qué.
   */
  reminder: {
    state: string;
    scheduledFor: string | null;
    sentAt: string | null;
    failureReason: string | null;
  } | null;
}

/** Fecha y hora en la zona del negocio, para mostrar tal cual. */
export const formatAppointmentDateTime = (
  date: Date,
  timezone: string,
): string =>
  new Intl.DateTimeFormat('es-CO', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);

/**
 * @param timezone La del negocio. Se pasa desde afuera porque quien consulta
 * varias citas ya la resolvió una vez y no tiene sentido volver a leerla por
 * cada fila.
 */
export const toAppointmentItem = (
  appointment: Appointment,
  timezone: string,
): AppointmentItem => {
  const services = appointment.services ?? [];

  const serviceNames = services
    .map((s) => s.service?.name)
    .filter((name): name is string => !!name);

  const totalDuration = services.reduce(
    (sum, s) => sum + (s.durationAtBooking ?? 0),
    0,
  );

  const staffNames = Array.from(
    new Set(services.map((s) => s.staff?.name).filter((n): n is string => !!n)),
  );

  const segments = services
    .map((s) => ({
      staffId: s.staffId ?? null,
      staffName: s.staff?.name ?? null,
      staffColor: s.staff?.calendarColor ?? null,
      serviceId: s.serviceId,
      serviceName: s.service?.name ?? null,
      startTime: s.startTime.toISOString(),
      endTime: s.endTime.toISOString(),
      price: Number(s.priceAtBooking),
      durationMinutes: s.durationAtBooking,
    }))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const reminder = pickReminderToShow(appointment.reminders ?? []);

  return {
    id: appointment.id,
    startTime: appointment.startTime.toISOString(),
    // El fin sale de la cita y no de sumar `totalDuration`, que es la suma de
    // `durationAtBooking` y queda en 0 si algún servicio no la tiene cargada.
    endTime: appointment.endTime.toISOString(),
    startTimeFormatted: formatAppointmentDateTime(
      appointment.startTime,
      timezone,
    ),
    endTimeFormatted: formatAppointmentDateTime(appointment.endTime, timezone),
    status: appointment.status,
    clientName: appointment.client?.name,
    staffName:
      staffNames.length === 0
        ? undefined
        : staffNames.length === 1
          ? staffNames[0]
          : 'Varios',
    businessName: appointment.tenant?.name,
    serviceNames,
    totalDuration,
    timezone,
    segments,
    reminder: reminder
      ? {
          state: reminder.state,
          scheduledFor: reminder.scheduledFor
            ? reminder.scheduledFor.toISOString()
            : null,
          sentAt: reminder.sentAt ? reminder.sentAt.toISOString() : null,
          failureReason: reminder.failureReason,
        }
      : null,
  };
};

/**
 * La reserva con lo que hace falta para editarla.
 *
 * Existe aparte del ítem de la agenda por dos razones. Una es que trae datos que
 * sólo importan en el detalle: el cliente con su teléfono y el total. La otra es
 * más importante: `GET /appointments/:id` devolvía la entidad cruda con la
 * relación `tenant`, y eso arrastraba **el token de WhatsApp del negocio en
 * texto plano** hasta el navegador. Un mapeo explícito no puede filtrar lo que no
 * nombra.
 */
export interface AppointmentDetail extends AppointmentItem {
  client: { id: string; name: string | null; phone: string | null } | null;
  /** Suma de lo pactado en cada tramo. */
  totalPrice: number;
}

export const toAppointmentDetail = (
  appointment: Appointment,
  timezone: string,
): AppointmentDetail => {
  const item = toAppointmentItem(appointment, timezone);

  return {
    ...item,
    client: appointment.client
      ? {
          id: appointment.client.id,
          name: appointment.client.name ?? null,
          phone: appointment.client.phone ?? null,
        }
      : null,
    totalPrice: item.segments.reduce((sum, segment) => sum + segment.price, 0),
  };
};
