import type { SlotRange } from './availability.types';
import {
  getDayOfWeek,
  makeDateInTimeZone,
  normalizeTime,
} from './availability.helpers';

/**
 * Una franja recurrente de la semana, tal como la guardan `business_hours` y
 * `staff_schedules`. Es estructural a propósito: ambas entidades encajan sin
 * necesidad de convertirlas.
 */
export interface WeeklyTimeRange {
  /** 0 = domingo. */
  dayOfWeek: number;
  /** `HH:MM` o `HH:MM:SS`, que es como MySQL devuelve las columnas `time`. */
  startTime: string;
  endTime: string;
}

export interface ResolveWorkingRangesInput {
  /** Fecha `YYYY-MM-DD` en la zona horaria del negocio. */
  date: string;
  timeZone: string;
  /** Todas las franjas del negocio, de cualquier día. */
  businessHours: WeeklyTimeRange[];
  /** `Staff.usesCustomSchedule`. */
  usesCustomSchedule: boolean;
  /** Todas las franjas propias del profesional, de cualquier día. */
  staffSchedules: WeeklyTimeRange[];
}

/**
 * Franjas en las que un profesional puede recibir reservas en una fecha dada.
 *
 *     franjas = horario_del_negocio ∩ jornada_del_profesional
 *
 * Las dos capas significan cosas distintas y por eso se componen en vez de
 * pisarse: el horario del negocio es la envolvente —cuándo está abierto el
 * local, dato que además se le informa al cliente— y la jornada del profesional
 * es capacidad dentro de esa envolvente. De ahí que sea una intersección: si el
 * local cierra a las 20:00, un olvido en la ficha de una persona no puede
 * generar reservas a las 21:00.
 *
 * Recibe la **fecha** y no el día de la semana a propósito. Un `dayOfWeek` es un
 * número del 0 al 6 y no permite preguntarle a una excepción por fecha
 * (vacaciones, feriados) si aplica. Con la fecha, esa capa entra más adelante
 * como un paso más acá adentro, sin tocar a ningún llamador.
 *
 * Devuelve instantes absolutos, ya resueltos contra la zona horaria del negocio,
 * y sin solapamientos: es lo que necesitan tanto la generación de la grilla de
 * candidatos como `isWithinWorkingRanges`.
 */
export const resolveWorkingRanges = (
  input: ResolveWorkingRangesInput,
): SlotRange[] => {
  const { date, timeZone, businessHours, usesCustomSchedule, staffSchedules } =
    input;

  const dayOfWeek = getDayOfWeek(date, timeZone);

  const business = mergeRanges(
    toAbsoluteRanges(businessHours, dayOfWeek, date, timeZone),
  );

  // Local cerrado: no hay jornada propia que valga.
  if (business.length === 0) return [];

  if (!usesCustomSchedule) return business;

  const own = mergeRanges(
    toAbsoluteRanges(staffSchedules, dayOfWeek, date, timeZone),
  );

  // Con el flag encendido, sus filas son la verdad completa: sin fila para este
  // día, no trabaja. Ver `Staff.usesCustomSchedule`.
  if (own.length === 0) return [];

  return intersectRanges(business, own);
};

/**
 * Resuelve las franjas de varios profesionales de una vez.
 *
 * Existe para que los dos motores de disponibilidad —el conversacional y el del
 * flujo guiado— compartan exactamente el mismo criterio en vez de repetir el
 * bucle cada uno por su lado.
 */
export const resolveWorkingRangesByStaff = (input: {
  date: string;
  timeZone: string;
  businessHours: WeeklyTimeRange[];
  staff: Array<{ id: string; usesCustomSchedule: boolean }>;
  /** Jornadas propias por `staffId`, tal como las agrupa el repositorio. */
  schedulesByStaff: Record<string, WeeklyTimeRange[]>;
}): Record<string, SlotRange[]> => {
  const rangesByStaff: Record<string, SlotRange[]> = {};

  for (const member of input.staff) {
    rangesByStaff[member.id] = resolveWorkingRanges({
      date: input.date,
      timeZone: input.timeZone,
      businessHours: input.businessHours,
      usesCustomSchedule: member.usesCustomSchedule,
      staffSchedules: input.schedulesByStaff[member.id] ?? [],
    });
  }

  return rangesByStaff;
};

/**
 * De una lista de fechas, las que el negocio efectivamente atiende.
 *
 * Una fecha entra si **al menos un** profesional del equipo tiene franja ese
 * día. Cubre los dos motivos por los que un día no sirve: el local cerrado —un
 * domingo sin horario— y el día en el que nadie del equipo trabaja.
 *
 * Existe para no ofrecer días que no llevan a ninguna parte. Elegir "domingo 23"
 * y recibir "no quedan horarios" no es un error del cálculo: es haber presentado
 * como opción algo que nunca lo fue.
 *
 * No mira la agenda, así que un día abierto pero con todo tomado sigue
 * apareciendo. Descartarlo obligaría a calcular la disponibilidad real de cada
 * fecha, que son varias consultas por día; esto resuelve el caso frecuente con
 * lo que ya está cargado en memoria.
 *
 * Con `notBefore` cubre además un tercer motivo, que es de reloj y no de
 * calendario: el día que ya terminó.
 */
export const datesWithCoverage = (input: {
  dates: string[];
  timeZone: string;
  businessHours: WeeklyTimeRange[];
  staff: Array<{ id: string; usesCustomSchedule: boolean }>;
  schedulesByStaff: Record<string, WeeklyTimeRange[]>;
  /**
   * Instante antes del cual una jornada ya no sirve.
   *
   * Sin esto, un negocio abierto de 09:00 a 22:00 consultado a las 21:50
   * ofrecía "hoy" como día con atención, y el paso siguiente contestaba que no
   * quedan horarios. Un día cuya jornada terminó no es un día con cobertura: la
   * jornada existe, pero ya no se puede llegar a ella.
   *
   * Es el mismo piso que aplica el armado de horarios (`minStartTime`), sólo
   * que preguntado un nivel más arriba. Omitirlo mantiene el comportamiento
   * anterior, que es lo que necesita cualquier consulta sobre el pasado.
   */
  notBefore?: Date;
}): string[] =>
  input.dates.filter((date) => {
    const rangesByStaff = resolveWorkingRangesByStaff({
      date,
      timeZone: input.timeZone,
      businessHours: input.businessHours,
      staff: input.staff,
      schedulesByStaff: input.schedulesByStaff,
    });

    const { notBefore } = input;

    return input.staff.some((member) =>
      (rangesByStaff[member.id] ?? []).some(
        // Alcanza con que a la franja le quede algo por delante: si entra el
        // servicio completo lo decide el armado de horarios, que es quien
        // conoce su duración.
        (range) => !notBefore || range.endTime > notBefore,
      ),
    );
  });

/**
 * Cobertura combinada del equipo, para generar una única grilla de candidatos.
 *
 * Con Julio de 09:00 a 17:00 y Marco de 13:00 a 21:00 la grilla va de 09:00 a
 * 21:00, y después cada profesional se filtra contra su propia franja. Generar
 * una grilla por persona produciría horarios desalineados entre sí.
 */
export const unionWorkingRanges = (
  rangesByStaff: Record<string, SlotRange[]>,
  staffIds: string[],
): SlotRange[] =>
  mergeRanges(staffIds.flatMap((staffId) => rangesByStaff[staffId] ?? []));

/**
 * Indica si un slot candidato entra completo en alguna de las franjas.
 *
 * Exige que quepa dentro de **una sola** franja: como vienen fusionadas, un slot
 * que abarca dos franjas es un slot que cruza un hueco (la siesta, por ejemplo)
 * y no es ofrecible.
 *
 * Sin franjas responde `false`. Es lo contrario a `isStaffFree`, que ante la
 * ausencia de citas responde `true`, y la asimetría es deliberada: no tener
 * citas significa estar libre, pero no tener horario significa no trabajar.
 */
export const isWithinWorkingRanges = (
  ranges: SlotRange[] | undefined,
  candidate: SlotRange,
): boolean => {
  if (!ranges || ranges.length === 0) return false;

  return ranges.some(
    (range) =>
      candidate.startTime >= range.startTime &&
      candidate.endTime <= range.endTime,
  );
};

/**
 * Fusiona franjas solapadas o contiguas en tramos continuos.
 *
 * Hace falta para armar la unión de las jornadas de todo el equipo: dos
 * profesionales con 09:00–17:00 y 13:00–21:00 tienen que producir una sola
 * grilla de 09:00 a 21:00. Sin fusionar, el tramo compartido generaría slots
 * candidatos duplicados.
 */
export const mergeRanges = (ranges: SlotRange[]): SlotRange[] => {
  if (ranges.length <= 1) return ranges.map((range) => ({ ...range }));

  const sorted = [...ranges].sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime(),
  );

  const merged: SlotRange[] = [{ ...sorted[0] }];

  for (const range of sorted.slice(1)) {
    const last = merged[merged.length - 1];

    if (range.startTime <= last.endTime) {
      if (range.endTime > last.endTime) last.endTime = range.endTime;
      continue;
    }

    merged.push({ ...range });
  }

  return merged;
};

const toAbsoluteRanges = (
  rows: WeeklyTimeRange[],
  dayOfWeek: number,
  date: string,
  timeZone: string,
): SlotRange[] =>
  rows
    .filter((row) => row.dayOfWeek === dayOfWeek)
    .map((row) => ({
      startTime: makeDateInTimeZone(
        date,
        normalizeTime(row.startTime),
        timeZone,
      ),
      endTime: makeDateInTimeZone(date, normalizeTime(row.endTime), timeZone),
    }))
    // Una franja que termina antes de empezar es un dato roto, no una jornada
    // nocturna: `generateCandidateSlots` ya la descarta con el mismo criterio.
    .filter((range) => range.endTime > range.startTime);

/**
 * Intersección de dos conjuntos de franjas ya fusionados. El resultado hereda
 * de ellos la propiedad de no solaparse.
 */
const intersectRanges = (a: SlotRange[], b: SlotRange[]): SlotRange[] => {
  const result: SlotRange[] = [];

  for (const left of a) {
    for (const right of b) {
      const startTime =
        left.startTime > right.startTime ? left.startTime : right.startTime;
      const endTime =
        left.endTime < right.endTime ? left.endTime : right.endTime;

      if (endTime > startTime) result.push({ startTime, endTime });
    }
  }

  return result.sort((x, y) => x.startTime.getTime() - y.startTime.getTime());
};
