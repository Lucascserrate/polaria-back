/**
 * Qué relación de tiempo declara el negocio entre dos categorías.
 *
 * Hoy hay un solo valor, y aun así es una columna y no un booleano `isParallel`.
 * La diferencia importa el día que aparezca la regla contraria —dos categorías
 * que **nunca** pueden ir juntas aunque sobre gente— o una que pida un margen
 * entre medio: con un booleano eso es una migración, con esto es un valor más.
 */
export enum SchedulingMode {
  /** Se pueden hacer al mismo tiempo, con dos profesionales distintos. */
  PARALLEL = 'PARALLEL',
}

export const SCHEDULING_MODES: readonly string[] = Object.values(
  SchedulingMode,
) as string[];
