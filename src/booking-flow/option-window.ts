/**
 * Reparto de las opciones de un paso cuando el canal tiene un tope.
 *
 * El dominio de disponibilidad devuelve todos los horarios; acá se decide cuáles
 * entran en el componente. El único número que cruza desde el transporte es el
 * tope total (10 filas en una lista nativa de WhatsApp); el resto del reparto es
 * lógica del flujo, porque depende de qué opciones agrega el propio flujo.
 *
 * Cuentas con un tope de 10 y `Cancelar` siempre presente:
 *
 * - hasta 9 horarios: 9 horarios + Cancelar = 10
 * - más de 9 horarios: 8 horarios + "Ver más horarios" + Cancelar = 10
 *
 * Es decir, en cuanto hace falta paginar se muestran 8 y no 9: la fila de "ver
 * más" también ocupa lugar.
 */
export type OptionWindow = {
  /** Índice inicial (inclusive) del tramo de contenido a mostrar. */
  start: number;
  /** Índice final (exclusivo). */
  end: number;
  /** Quedan opciones después de `end`, así que hay que ofrecer "ver más". */
  hasMore: boolean;
};

export function computeOptionWindow(params: {
  /** Cantidad total de opciones de contenido disponibles. */
  total: number;
  /** Desde dónde mostrar. Se normaliza si quedó fuera de rango. */
  offset: number;
  /** Tope de opciones del canal. Sin tope si se omite. */
  maxOptionsPerPrompt?: number;
  /** Opciones que el flujo agrega siempre, como `Cancelar`. */
  reservedOptions?: number;
}): OptionWindow {
  const { total, maxOptionsPerPrompt } = params;
  const reserved = params.reservedOptions ?? 0;

  if (total <= 0) return { start: 0, end: 0, hasMore: false };

  // Un offset fuera de rango significa que la lista se recalculó y encogió.
  // Volver al principio es preferible a mostrar una página vacía.
  const offset = params.offset > 0 && params.offset < total ? params.offset : 0;

  if (maxOptionsPerPrompt === undefined) {
    return { start: 0, end: total, hasMore: false };
  }

  const contentBudget = Math.max(1, maxOptionsPerPrompt - reserved);
  const remaining = total - offset;

  if (remaining <= contentBudget) {
    return { start: offset, end: total, hasMore: false };
  }

  // Hay que paginar: una opción del presupuesto se va en "ver más".
  const budgetWithMore = Math.max(1, contentBudget - 1);

  return {
    start: offset,
    end: offset + budgetWithMore,
    hasMore: offset + budgetWithMore < total,
  };
}
