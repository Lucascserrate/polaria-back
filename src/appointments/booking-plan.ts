/**
 * Cómo se acomodan los servicios de una reserva en el tiempo.
 *
 * Es puro y está separado del servicio porque acá viven tres decisiones que se
 * rompen en silencio: en qué orden y a qué hora arranca cada tramo, qué precio
 * se conserva y cuándo termina la reserva. Un error en la cadena de horarios no
 * lanza nada: deja dos servicios pisándose o un hueco en el medio.
 */

export interface BookingItem {
  serviceId: string;
  /**
   * Profesional de **ese** servicio. Uno por tramo y no uno por reserva: el
   * corte lo puede hacer Diego y la barba Carlos, y el modelo ya lo soporta.
   */
  staffId: string;
}

export interface PlannedSegment extends BookingItem {
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  price: number;
  sequenceOrder: number;
}

export type BookingPlan =
  | { ok: true; segments: PlannedSegment[]; endTime: Date }
  | { ok: false; missingServiceIds: string[] };

export interface PlanBookingInput {
  startTime: Date;
  /** En orden de ejecución: el primero arranca en `startTime`. */
  items: BookingItem[];
  /** Duración y precio vigentes de cada servicio, por id. */
  services: Map<string, { durationMinutes: number; price: number }>;
  /**
   * Precio ya pactado de los servicios que la reserva **ya tenía**, por id.
   *
   * Se conserva a propósito. La columna se llama `priceAtBooking` y eso es
   * literal: corregir la hora de una cita no puede re-cotizar un servicio que el
   * cliente ya tenía acordado a otro precio. Un servicio que se agrega ahora sí
   * entra con el precio de hoy.
   */
  agreedPrices?: Map<string, number>;
}

/**
 * Encadena los tramos uno detrás del otro desde `startTime`.
 *
 * La duración es siempre la vigente del servicio, incluso para los que ya
 * estaban: es la que usa el motor de disponibilidad para decidir si el horario
 * entra, y sostener una duración vieja dejaría la agenda diciendo una cosa y la
 * disponibilidad otra.
 */
export const planBookingSegments = (input: PlanBookingInput): BookingPlan => {
  const missingServiceIds = input.items
    .map((item) => item.serviceId)
    .filter((serviceId) => {
      const service = input.services.get(serviceId);
      return !service || service.durationMinutes <= 0;
    });

  if (missingServiceIds.length > 0) {
    return { ok: false, missingServiceIds: [...new Set(missingServiceIds)] };
  }

  let cursor = input.startTime;

  const segments = input.items.map((item, index) => {
    const service = input.services.get(item.serviceId)!;
    const startTime = cursor;
    const endTime = new Date(
      startTime.getTime() + service.durationMinutes * 60_000,
    );
    cursor = endTime;

    return {
      ...item,
      startTime,
      endTime,
      durationMinutes: service.durationMinutes,
      price: input.agreedPrices?.get(item.serviceId) ?? service.price,
      sequenceOrder: index,
    };
  });

  return { ok: true, segments, endTime: cursor };
};
