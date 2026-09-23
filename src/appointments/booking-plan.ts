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
  /** `null` mientras el servicio no tenga precio. Ver `quoted-price.ts`. */
  price: number | null;
  currency: string;
  sequenceOrder: number;
}

export type BookingPlan =
  | { ok: true; segments: PlannedSegment[]; endTime: Date }
  | { ok: false; missingServiceIds: string[] };

export interface PlanBookingInput {
  startTime: Date;
  /** En orden de ejecución: el primero arranca en `startTime`. */
  items: BookingItem[];
  services: Map<
    string,
    { durationMinutes: number; price: number | null; currency: string }
  >;
  agreedPrices?: Map<string, { price: number | null; currency: string }>;
  /**
   * Cuántos minutos después del inicio arranca cada ítem, en su mismo orden.
   *
   * Omitirlo encadena, que es lo que Polaria hizo siempre y sigue siendo el caso
   * de casi todas las reservas. Se pasa cuando el negocio declaró que dos
   * categorías se atienden a la vez: ahí dos ítems comparten offset, y la cuenta
   * de dónde empieza cada uno la hizo `buildExecutionPlans` sobre la misma lista
   * contra la que se comprobó la disponibilidad.
   *
   * **No se recalcula acá aunque se pudiera**: el horario que se ofreció salió
   * de un reparto concreto, y rehacerlo al escribir es la forma más silenciosa
   * de guardar una cita que dura distinto de la que se mostró.
   */
  offsetsMinutes?: number[];
}

/**
 * Ubica los tramos a partir de `startTime`.
 *
 * Encadenados por defecto —cada uno donde termina el anterior— o donde diga
 * `offsetsMinutes`, que es como dos servicios simultáneos comparten instante de
 * arranque.
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

  let chained = 0;

  const segments = input.items.map((item, index) => {
    const service = input.services.get(item.serviceId)!;

    const offsetMinutes = input.offsetsMinutes?.[index] ?? chained;
    chained = offsetMinutes + service.durationMinutes;

    const startTime = new Date(
      input.startTime.getTime() + offsetMinutes * 60_000,
    );
    const endTime = new Date(
      startTime.getTime() + service.durationMinutes * 60_000,
    );

    const agreed = input.agreedPrices?.get(item.serviceId);

    /*
     * Se pregunta si el tramo **estaba**, no si su precio era un número: un
     * servicio que se cotiza se guardó sin precio, y con `??` ese hueco se
     * llenaría con el precio de hoy del catálogo. Lo pactado manda aunque lo
     * pactado sea "todavía nada".
     */
    const booked = agreed ? agreed.price : service.price;

    return {
      ...item,
      startTime,
      endTime,
      durationMinutes: service.durationMinutes,
      price: booked,
      currency: agreed?.currency ?? service.currency,
      sequenceOrder: index,
    };
  });

  /*
   * El fin de la reserva es el del último tramo en terminar, y con servicios
   * simultáneos ése no tiene por qué ser el último de la lista: una pedicure de
   * media hora que arranca junto a una manicure de una termina antes. Tomar el
   * final del último ítem dejaría la cita diciendo que termina media hora antes
   * de que su profesional se libere.
   */
  const endTime = new Date(
    Math.max(...segments.map((segment) => segment.endTime.getTime())),
  );

  return { ok: true, segments, endTime };
};

/**
 * Qué tramos de una reserva se pisan entre sí con el mismo profesional.
 *
 * Es la comprobación que el índice único de la base **no** puede hacer. Aquel
 * cubre `(staffId, activeStartTime)`, o sea dos tramos que arrancan en el mismo
 * instante; mientras los servicios iban encadenados eso alcanzaba, porque dos
 * tramos de una misma cita nunca se solapaban. Con servicios simultáneos de
 * distinta duración —manicure de 60 y pedicure de 30 arrancando juntas— un
 * solape parcial no comparte instante de inicio y pasaría sin que nada avisara.
 *
 * Devuelve los profesionales repetidos, para poder nombrarlos en el mensaje: al
 * administrador que puso a la misma persona en dos servicios que ocurren a la
 * vez hay que decirle quién es, no que "hay un conflicto".
 */
export const overlappingStaffIds = (
  segments: Array<{ staffId: string; startTime: Date; endTime: Date }>,
): string[] => {
  const conflicted = new Set<string>();

  for (let a = 0; a < segments.length; a++) {
    for (let b = a + 1; b < segments.length; b++) {
      if (segments[a].staffId !== segments[b].staffId) continue;

      const overlaps =
        segments[a].startTime < segments[b].endTime &&
        segments[b].startTime < segments[a].endTime;

      if (overlaps) conflicted.add(segments[a].staffId);
    }
  }

  return [...conflicted];
};
