/**
 * El conjunto de pares de categorías que un negocio declaró simultáneos.
 *
 * Está separado de la base y del planificador porque es la pieza que las une, y
 * porque encierra la única regla que tiene que valer en los dos lados: **el par
 * es simétrico**. Preguntar "¿Manicures con Pedicures?" y "¿Pedicures con
 * Manicures?" tiene que dar lo mismo siempre, se esté leyendo una fila o
 * escribiéndola, y la forma de garantizarlo es que exista una sola manera de
 * nombrar el par.
 */

/**
 * Cómo se nombra un par, sin importar en qué orden venga.
 *
 * Ordenar los dos ids alfabéticamente es lo que hace que la fila que guarda
 * "A con B" sea la misma que responde "¿B con A?". Sin esta normalización harían
 * falta dos filas por regla, y con dos filas es posible que exista una y no la
 * otra: un estado en el que A permite a B pero B no permite a A, que ninguna
 * pantalla sabe dibujar y nadie sabe corregir.
 */
export function pairKey(categoryAId: string, categoryBId: string): string {
  return categoryAId < categoryBId
    ? `${categoryAId}|${categoryBId}`
    : `${categoryBId}|${categoryAId}`;
}

/** El par en el orden en que se guarda: primero el id menor. */
export function canonicalPair(
  categoryAId: string,
  categoryBId: string,
): { categoryAId: string; categoryBId: string } {
  return categoryAId < categoryBId
    ? { categoryAId, categoryBId }
    : { categoryAId: categoryBId, categoryBId: categoryAId };
}

/**
 * Las reglas de un negocio, listas para preguntar.
 *
 * Se arma una vez por cálculo de disponibilidad y se consulta muchas: el
 * planificador pregunta por cada par de servicios de la reserva, y hay un plan
 * por cada forma de repartirlos.
 */
export class ParallelPairs {
  private readonly keys: Set<string>;

  constructor(pairs: Array<{ categoryAId: string; categoryBId: string }> = []) {
    this.keys = new Set(
      pairs.map((pair) => pairKey(pair.categoryAId, pair.categoryBId)),
    );
  }

  /**
   * Si estas dos categorías se pueden atender a la vez.
   *
   * Una categoría consigo misma nunca: dos manicures simultáneas sobre la misma
   * clienta no existen. Se responde acá y no sólo al guardar, porque una regla
   * guardada antes de esta comprobación no puede volverse verdad por estar en la
   * base.
   */
  allows(categoryAId: string, categoryBId: string): boolean {
    if (categoryAId === categoryBId) return false;
    return this.keys.has(pairKey(categoryAId, categoryBId));
  }

  /** Si el negocio no declaró ninguna regla. Nada se paraleliza. */
  get isEmpty(): boolean {
    return this.keys.size === 0;
  }
}
