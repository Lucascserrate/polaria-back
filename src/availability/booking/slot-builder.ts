import { isOverlapping } from '../utils/availability.helpers';
import {
  isWithinWorkingRanges,
  startsWithinWorkingRanges,
} from '../utils/working-hours.resolver';
import type { SlotRange } from '../utils/availability.types';
import type { BookingSlot } from './booking-slot.type';
import { assignDistinctStaff } from './staff-matching';

export type StaffBusyMap = Record<string, SlotRange[]>;

/**
 * Un servicio de la reserva, ya ubicado dentro del bloque.
 *
 * `offsetMinutes` es cuánto después del inicio del bloque arranca este tramo.
 * Con servicios encadenados es lo que convierte una lista en una cadena —el
 * segundo empieza cuando termina el primero—; con servicios simultáneos, dos
 * tramos comparten `offsetMinutes` y arrancan juntos. Lo decide
 * `buildExecutionPlans`, y es la misma cuenta que después escribe la cita.
 */
export type BookingSegmentSpec = {
  /**
   * Profesionales habilitados para **este** servicio.
   *
   * Ya viene filtrada por el pedido: si el cliente eligió a alguien para este
   * tramo, acá viene esa persona sola. Vacía no puede llegar —sin candidatos no
   * hay horario que calcular— y el servicio corta antes.
   */
  staffIds: string[];
  offsetMinutes: number;
  durationMinutes: number;
  /**
   * En qué tanda va. Los tramos de una misma tanda ocurren a la vez y exigen
   * profesionales **distintos**; los de tandas distintas no se pisan y se
   * resuelven por separado.
   *
   * Omitirlo es el caso de siempre: cada tramo en su propia tanda, es decir
   * servicios encadenados. Los tres canales que reservan de a un servicio nunca
   * lo escriben.
   */
  roundIndex?: number;
};

export type BuildBookingSlotsInput = {
  /**
   * Instantes de arranque a evaluar.
   *
   * Sólo se lee su `startTime`: el fin del bloque lo decide el plan, no el
   * candidato. Con planes de distinta duración —una hora con dos profesionales,
   * dos con una sola— un candidato con fin propio estaría afirmando una duración
   * antes de saber quién puede atender.
   */
  candidateSlots: SlotRange[];
  /**
   * Los servicios de la reserva, ya ubicados.
   *
   * Uno solo es el caso de siempre —WhatsApp, el Flow, el panel— y entonces el
   * único tramo ocupa el bloque entero.
   */
  segments: BookingSegmentSpec[];
  /**
   * Franjas de trabajo de cada profesional en la fecha, según
   * `resolveWorkingRangesByStaff`.
   *
   * Es obligatorio: un profesional ausente del mapa no recibe reservas. Estar
   * habilitado para el servicio no implica estar en el local a esa hora.
   */
  workingRangesByStaff: Record<string, SlotRange[]>;
  /** Citas ya agendadas por profesional, para la fecha en cuestión. */
  appointmentsByStaff: StaffBusyMap;
  /** Ningún slot que empiece antes de este momento se ofrece. */
  minStartTime?: Date;
  /**
   * Acepta además los que empiezan dentro de la jornada y terminan después,
   * marcándolos con `endsAfterHours`.
   *
   * Lo piden todos los canales: un horario de atención dice hasta qué hora se
   * recibe gente, no a qué hora se apaga la luz. Un local abierto hasta las
   * 22:00 acepta un corte de una hora a las 21:30 y quien atiende se queda
   * hasta terminarlo; exigir que la reserva cerrara antes borraba la última
   * hora del día de todos los negocios cuyo servicio no entra justo.
   *
   * La marca se conserva igual, porque el dato sigue importando: es lo que deja
   * avisar en el panel que esa cita termina fuera del horario.
   */
  allowEndAfterHours?: boolean;
  /**
   * Exige que **una misma persona** pueda con todos los tramos.
   *
   * Es el modo por defecto de una reserva de varios servicios encadenados: quien
   * pide un corte y una barba sin elegir profesional espera que lo atienda
   * alguien, no que lo pasen de silla en silla.
   *
   * **Un plan con servicios simultáneos lo ignora**, y no es una excepción
   * caprichosa: pedir que una sola persona atienda dos servicios a la vez es
   * pedir que el plan no exista. Cuando el negocio declaró que dos categorías
   * conviven, lo que el cliente pidió al elegirlas juntas es terminar antes.
   * Ver `buildExecutionPlans`, que ofrece igual el plan encadenado por si nadie
   * puede cumplir el simultáneo.
   *
   * Con un solo tramo no cambia nada: la lista del tramo y la de quienes pueden
   * con todo son la misma.
   */
  requireSingleStaff?: boolean;
};

/**
 * Convierte instantes candidatos en horarios ofrecibles.
 *
 * Deliberadamente **no** aplica ningún criterio cosmético: no recorta a N
 * resultados, no exige separación mínima entre horarios, no prefiere minutos
 * "redondos" ni equilibra mañana y tarde. Devuelve todo lo que está disponible.
 *
 * Cuántos horarios mostrar es decisión del renderizador, que es el único que
 * conoce el límite del componente (10 filas en una lista nativa, 200 en un
 * Dropdown de Flows). Mezclar esa decisión con el cálculo fue justamente lo que
 * volvió inutilizable al cálculo anterior.
 *
 * ---
 *
 * **Los tramos de tandas distintas se resuelven por separado**, y eso no es una
 * simplificación: no se solapan, así que quién puede atender el segundo no
 * depende de quién atendió el primero. Es lo que deja que el corte lo haga Diego
 * y la barba Carlos sin resolver ningún encaje combinado — y también que los dos
 * los haga la misma persona, que es un caso particular y no uno distinto.
 *
 * **Dentro de una tanda no**: ahí los tramos ocurren a la vez y hace falta un
 * reparto sin repetidos. Ver `assignDistinctStaff`.
 */
export function buildBookingSlots(
  input: BuildBookingSlotsInput,
): BookingSlot[] {
  return buildBookingSlotsForPlans({
    ...input,
    plans: [{ segments: input.segments }],
  });
}

/** Un plan candidato: los mismos servicios, acomodados de otra forma. */
export type BookingPlanSpec = {
  segments: BookingSegmentSpec[];
};

export type BuildBookingSlotsForPlansInput = Omit<
  BuildBookingSlotsInput,
  'segments'
> & {
  /**
   * Las formas de acomodar la reserva, de la más conveniente a la menos.
   *
   * Cada instante candidato se prueba contra los planes **en orden** y se queda
   * con el primero que alguien pueda atender. Por eso el horario de las 15:00
   * puede durar una hora —hay dos profesionales libres— y el de las 16:00 dos,
   * con una sola: son el mismo pedido resuelto de la única manera que ese
   * momento del día permitía.
   *
   * Que la lista de horarios tenga duraciones distintas entre sí es la
   * consecuencia buscada, no un efecto colateral: la alternativa es esconder el
   * horario de las 16:00, que existe.
   */
  plans: BookingPlanSpec[];
};

export function buildBookingSlotsForPlans(
  input: BuildBookingSlotsForPlansInput,
): BookingSlot[] {
  const { candidateSlots, plans, minStartTime } = input;

  /*
   * Un plan sin tramos, o con un tramo que no tiene a nadie habilitado, no se
   * descarta del arreglo: se saltea. El índice que viaja en el horario es el de
   * esta lista, y compactarla lo haría apuntar a otro plan.
   */
  const usable = plans.map(
    (plan) =>
      plan.segments.length > 0 &&
      plan.segments.every((segment) => segment.staffIds.length > 0),
  );

  if (!usable.some(Boolean)) return [];

  const slots: BookingSlot[] = [];

  for (const candidate of candidateSlots) {
    if (minStartTime && candidate.startTime < minStartTime) continue;

    for (const [index, plan] of plans.entries()) {
      if (!usable[index]) continue;

      const slot = evaluatePlanAt(candidate.startTime, plan, input);
      if (slot) {
        slots.push({ ...slot, planIndex: index });
        break;
      }
    }
  }

  return slots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
}

/**
 * Si este plan se puede atender empezando en ese instante, y con quiénes.
 *
 * Devuelve `null` cuando no, que es la señal para que el llamador pruebe el plan
 * siguiente. Las dos rondas —completa y, sólo para el panel, la que admite
 * pasarse del cierre— están acá juntas a propósito: son la misma pregunta con
 * distinto criterio de jornada, y separarlas dejaría dos copias de la parte
 * difícil, que es el reparto.
 */
function evaluatePlanAt(
  startTime: Date,
  plan: BookingPlanSpec,
  input: Omit<BuildBookingSlotsForPlansInput, 'plans'>,
): Omit<BookingSlot, 'planIndex'> | null {
  const {
    workingRangesByStaff,
    appointmentsByStaff,
    allowEndAfterHours = false,
    requireSingleStaff = false,
  } = input;

  const { segments } = plan;
  const endTime = new Date(
    startTime.getTime() + blockMinutes(segments) * 60_000,
  );

  const windows = segments.map((segment) => windowOf(startTime, segment));

  /** Quién podría atender cada tramo, con el criterio de jornada que se pida. */
  const candidatesWith = (
    fitsShift: (staffId: string, window: SlotRange) => boolean,
  ) =>
    segments.map((segment, index) =>
      orderById(segment.staffIds).filter(
        (staffId) =>
          fitsShift(staffId, windows[index]) &&
          isStaffFree(appointmentsByStaff[staffId], windows[index]),
      ),
    );

  const withinShift = (staffId: string, window: SlotRange) =>
    isWithinWorkingRanges(workingRangesByStaff[staffId], window);

  const startsInShift = (staffId: string, window: SlotRange) =>
    startsWithinWorkingRanges(workingRangesByStaff[staffId], window.startTime);

  const complete = candidatesWith(withinShift);
  const resolved = resolve(complete, segments, requireSingleStaff);

  if (resolved) {
    return { startTime, endTime, ...resolved };
  }

  if (!allowEndAfterHours) return null;

  /*
   * Nadie lo cubre entero; se mira quién al menos lo empieza dentro.
   *
   * El orden importa: si alguien puede hacerlo completo, el horario es normal
   * y no lleva marca, aunque a otro del equipo se le pase del turno. Marcarlo
   * igual diría que se pasa del horario un horario que no se pasa para quien
   * lo va a atender.
   */
  const starting = resolve(
    candidatesWith(startsInShift),
    segments,
    requireSingleStaff,
  );

  if (!starting) return null;

  return { startTime, endTime, ...starting, endsAfterHours: true };
}

/**
 * De los candidatos por tramo a las dos listas que lleva un horario, o `null`
 * si este plan no se puede cumplir.
 *
 * Lo que decide es el reparto **por tanda**: cada tanda tiene que poder cubrirse
 * con profesionales distintos. Una tanda de un solo tramo se cumple con que
 * tenga a alguien, que es el caso de siempre.
 */
function resolve(
  candidatesBySegment: string[][],
  segments: BookingSegmentSpec[],
  requireSingleStaff: boolean,
): Pick<BookingSlot, 'eligibleStaffIds' | 'eligibleStaffIdsBySegment'> | null {
  if (candidatesBySegment.some((ids) => ids.length === 0)) return null;

  for (const round of roundIndexesOf(segments)) {
    if (round.length < 2) continue;

    if (
      !assignDistinctStaff(round.map((index) => candidatesBySegment[index]))
    ) {
      return null;
    }
  }

  /*
   * Quién puede con **toda** la reserva solo. Con algún tramo simultáneo no
   * puede ser nadie, y la intersección hay que saltearla en vez de confiar en
   * que dé vacía: que Ana esté habilitada para la manicure y para la pedicure no
   * significa que pueda hacerlas al mismo tiempo, y ofrecerla como "una sola
   * persona para todo" sería ofrecer lo imposible.
   */
  const eligibleStaffIds = hasParallelRound(segments)
    ? []
    : intersect(candidatesBySegment);

  if (requireSingleStaff && !hasParallelRound(segments)) {
    if (eligibleStaffIds.length === 0) return null;
  }

  return { eligibleStaffIds, eligibleStaffIdsBySegment: candidatesBySegment };
}

/**
 * Los índices de los tramos, agrupados por tanda y en orden.
 *
 * Se exporta porque la asignación definitiva de profesionales necesita el mismo
 * agrupamiento que la comprobación de disponibilidad: si las dos decidieran por
 * su cuenta qué va junto, un cambio en una dejaría a la otra repartiendo sobre
 * tandas que ya no existen.
 */
export function roundIndexesOf(
  segments: Array<Pick<BookingSegmentSpec, 'roundIndex'>>,
): number[][] {
  const byRound = new Map<number, number[]>();

  segments.forEach((segment, index) => {
    const round = segment.roundIndex ?? index;
    const current = byRound.get(round);
    if (current) current.push(index);
    else byRound.set(round, [index]);
  });

  return [...byRound.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, indexes]) => indexes);
}

/** Si alguna tanda lleva más de un servicio, o sea si algo ocurre a la vez. */
function hasParallelRound(
  segments: Array<Pick<BookingSegmentSpec, 'roundIndex'>>,
): boolean {
  return roundIndexesOf(segments).some((round) => round.length > 1);
}

/**
 * Cuánto ocupa el bloque entero: hasta que termina el último tramo.
 *
 * Es el máximo y no la suma, y ahí está toda la diferencia. Con tramos
 * encadenados las dos cuentas coinciden; con dos simultáneos de una hora, la
 * suma diría dos horas para una reserva que ocupa una.
 */
function blockMinutes(segments: BookingSegmentSpec[]): number {
  return Math.max(
    ...segments.map(
      (segment) => segment.offsetMinutes + segment.durationMinutes,
    ),
  );
}

/** Indica si existe al menos un horario ofrecible. */
export function hasAnyBookingSlot(input: BuildBookingSlotsInput): boolean {
  return buildBookingSlots(input).length > 0;
}

/**
 * Busca un horario exacto por su instante de inicio.
 *
 * Es la operación de revalidación: al confirmar, el horario elegido se vuelve a
 * buscar contra disponibilidad fresca. Compara el instante exacto porque el
 * horario provino de un componente que nosotros mismos generamos.
 */
export function findBookingSlotAt(
  slots: BookingSlot[],
  startTime: Date,
): BookingSlot | null {
  const target = startTime.getTime();
  return slots.find((slot) => slot.startTime.getTime() === target) ?? null;
}

/** Los minutos que ocupa un tramo dentro de un bloque que arranca en `start`. */
export function windowOf(
  start: Date,
  segment: { offsetMinutes: number; durationMinutes: number },
): SlotRange {
  const startTime = new Date(start.getTime() + segment.offsetMinutes * 60_000);

  return {
    startTime,
    endTime: new Date(startTime.getTime() + segment.durationMinutes * 60_000),
  };
}

function isStaffFree(
  appointments: SlotRange[] | undefined,
  candidate: SlotRange,
): boolean {
  if (!appointments || appointments.length === 0) return true;
  return !appointments.some((appointment) =>
    isOverlapping(
      appointment.startTime,
      appointment.endTime,
      candidate.startTime,
      candidate.endTime,
    ),
  );
}

/**
 * Los que están en todas las listas, conservando el orden de la primera.
 *
 * Con un solo tramo devuelve esa lista tal cual, que es lo que hace que el caso
 * de siempre no pase por ninguna rama nueva.
 */
function intersect(lists: string[][]): string[] {
  const [first, ...rest] = lists;
  if (rest.length === 0) return [...first];

  const sets = rest.map((list) => new Set(list));
  return first.filter((id) => sets.every((set) => set.has(id)));
}

/** Orden estable por id, para que la salida no dependa del orden de consulta. */
function orderById(staffIds: string[]): string[] {
  return [...staffIds].sort((a, b) => {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  });
}
