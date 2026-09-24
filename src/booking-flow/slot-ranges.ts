/**
 * Cómo se presentan los horarios de un día cuando son demasiados para una
 * pantalla.
 *
 * El problema es del canal y no del dominio: una lista nativa de WhatsApp tiene
 * diez filas, y una jornada de doce horas no entra. Hasta ahora se resolvía
 * paginando —"Ver más opciones", otra vez, otra vez— y llegar a las 17:00 desde
 * las 9:00 costaba dos toques con paso de media hora y cinco con paso de cuarto.
 * Ese costo crece con el largo del día, así que el negocio que más horarios
 * tiene para ofrecer es al que peor se le ofrecen.
 *
 * La salida es agrupar en **rangos**: "13:00 a 15:30 · 6 horarios". Con eso
 * llegar a cualquier hora del día cuesta un toque, sin importar cuántos haya.
 *
 * Rangos y no Mañana / Tarde / Noche, que es lo primero que uno piensa: una
 * franja semántica no garantiza nada sobre su tamaño —un local de 9 a 13 tiene
 * todo en "Mañana" y no partió nada— y encima hay que inventar dónde empieza la
 * noche para un negocio que cierra a las 18:15. Los rangos se calculan de la
 * disponibilidad real, así que se adaptan a cualquier horario y, sobre todo,
 * **pueden garantizar que cada uno entre en una pantalla**, que es para lo que
 * se los hace.
 *
 * Todo acá es puro y no conoce WhatsApp: recibe cuántas filas hay y devuelve
 * cómo repartirlas. Los dos límites entran por parámetro justamente para que no
 * queden escritos a mano en un cálculo que después nadie revisa contra el
 * componente real.
 */

/** Lo mínimo que se necesita de un horario para agruparlo. */
export type TimedSlot = { startTime: Date };

export type SlotScreen<T extends TimedSlot> =
  /**
   * Mostrar los horarios tal cual, con la paginación de siempre.
   *
   * Es la respuesta para la mayoría de los días: con pocos horarios agrupar no
   * ahorra nada y cobra un toque a quien quería el primero de la lista.
   */
  | { kind: 'all' }
  /**
   * Los próximos horarios sueltos y el resto agrupado en rangos.
   *
   * Los sueltos están arriba para que "lo antes posible" —el pedido más común en
   * una barbería— siga costando cero toques. Los rangos cubren lo que queda, y
   * ningún horario aparece en los dos lados.
   */
  | { kind: 'grouped'; next: T[]; ranges: T[][] };

export type PlanSlotScreenInput<T extends TimedSlot> = {
  /** Los horarios disponibles del día, en orden. */
  slots: T[];
  /**
   * Filas de **contenido** de la pantalla inicial: las que quedan después de las
   * fijas del paso. Los sueltos y los rangos se reparten este presupuesto.
   */
  screenRows: number;
  /**
   * Horarios que entran en la pantalla de **un** rango, ya descontadas sus
   * propias filas fijas —volver a los rangos, cancelar—.
   *
   * Es un límite distinto del anterior y por eso entra aparte: confundirlos
   * produce una especificación que cierra en el papel y no se puede dibujar.
   */
  rangeCapacity: number;
  /**
   * A partir de cuántos horarios conviene agrupar.
   *
   * Por debajo, la paginación de siempre llega al último con un solo toque, así
   * que agrupar no ahorra nada y encima se lo cobra a todos. El valor por
   * defecto sale de esa cuenta: con `screenRows` filas, la primera página
   * muestra `screenRows` y cada "ver más" agrega `screenRows - 1`.
   */
  threshold?: number;
  /** Cuántos horarios sueltos mostrar arriba, como mucho. */
  maxNext?: number;
  /**
   * Cuántos sueltos hacen falta para que valga la pena mostrarlos.
   *
   * Por debajo de esto no se muestra ninguno. Un horario suelto arriba de siete
   * rangos no se lee como un atajo: se lee como una inconsistencia —"¿y éste por
   * qué está afuera?"— y encima sólo le sirve a quien quería justo esa hora.
   * Como bloque de tres sí se entienden, y son los próximos.
   */
  minNext?: number;
};

/** Sueltos de más no ayudan: dejan de ser un atajo y son media lista. */
const DEFAULT_MAX_NEXT = 3;

/** Menos que esto no forma un bloque. Ver `minNext`. */
const DEFAULT_MIN_NEXT = 3;

/**
 * Cuánto se puede correr un corte para hacerlo coincidir con un hueco del día.
 *
 * Dos posiciones alcanzan para caer en el almuerzo o en un rato ya reservado sin
 * desbalancear los rangos. Más que eso empieza a producir uno de dos horarios al
 * lado de otro de ocho.
 */
const CUT_TOLERANCE = 2;

/**
 * Cómo mostrar los horarios de un día.
 *
 * Devuelve `all` cuando la lista de siempre alcanza, y `grouped` cuando hay que
 * repartir. Nunca devuelve algo que no entre: si los rangos no alcanzaran para
 * cubrir todo sin paginar, se prefiere mostrar menos sueltos antes que producir
 * una pantalla imposible.
 */
export function planSlotScreen<T extends TimedSlot>(
  input: PlanSlotScreenInput<T>,
): SlotScreen<T> {
  const {
    slots,
    screenRows,
    rangeCapacity,
    maxNext = DEFAULT_MAX_NEXT,
    minNext = DEFAULT_MIN_NEXT,
    threshold = twoPagesFit(screenRows),
  } = input;

  if (slots.length < threshold) return { kind: 'all' };

  /*
   * Se prueban primero los repartos con sueltos, del más grande al mínimo, y si
   * ninguno entra se cae directo a cero. Nunca queda un bloque de uno o dos: o
   * son suficientes para leerse como "los próximos", o la pantalla es sólo de
   * rangos y tiene una intención sola.
   */
  const candidates = [
    ...Array.from(
      { length: Math.max(0, Math.min(maxNext, slots.length) - minNext + 1) },
      (_, i) => Math.min(maxNext, slots.length) - i,
    ),
    0,
  ];

  for (const next of candidates) {
    const rest = slots.slice(next);
    const room = screenRows - next;
    if (room < 1) continue;

    const ranges = splitIntoRanges(rest, rangeCapacity, room);
    if (
      ranges.length <= room &&
      ranges.every((r) => r.length <= rangeCapacity)
    ) {
      return { kind: 'grouped', next: slots.slice(0, next), ranges };
    }
  }

  /*
   * Ni sin sueltos entran todos los rangos sin paginar: el día tiene más
   * horarios que `screenRows * rangeCapacity`. Se reparte igual en las filas que
   * hay y alguno pagina por dentro, que sigue siendo un toque menos que la
   * lista sin agrupar.
   */
  return {
    kind: 'grouped',
    next: [],
    ranges: splitIntoRanges(slots, rangeCapacity, screenRows),
  };
}

/**
 * Hasta cuántos horarios la paginación de siempre llega al último con un toque.
 *
 * La primera página muestra `rows`; si hay más, entra la fila de "ver más" y
 * cada página pasa a mostrar `rows - 1`. Con dos páginas se cubren
 * `2 * rows - 1`, y a partir del siguiente ya hacen falta dos toques: ése es el
 * punto en que agrupar empieza a ganar.
 */
function twoPagesFit(rows: number): number {
  return 2 * rows;
}

/**
 * Parte los horarios en rangos que entren en una pantalla.
 *
 * Primero por los **cortes del día**: donde el negocio cierra al mediodía, o
 * donde hay un rato largo ya reservado, el día ya viene partido y el rango tiene
 * que respetarlo. Un local de 09:00 a 13:00 y de 15:00 a 20:00 tiene que
 * ofrecer "09:00 a 12:30" y "15:00 a 19:30", no un rango que cruce el almuerzo:
 * esa etiqueta nombra un rato que el negocio no atiende.
 *
 * Después, cada pedazo que no entre en una pantalla se subdivide por cantidad.
 * Se usa la menor cantidad posible —`ceil(n / capacidad)`— para que los rangos
 * sean lo más grandes que quepan: con muchos rangos chicos, elegir uno deja de
 * ahorrar y la pantalla se vuelve una lista de listas.
 */
function splitIntoRanges<T extends TimedSlot>(
  slots: T[],
  capacity: number,
  maxRanges: number,
): T[][] {
  if (slots.length === 0) return [];

  const ranges = splitByDayGaps(slots).flatMap((piece) =>
    splitByCount(piece, capacity),
  );

  return ranges.length <= maxRanges ? ranges : mergeUntil(ranges, maxRanges);
}

/**
 * Parte donde el día se interrumpe de verdad.
 *
 * Un corte es un salto **atípicamente grande** respecto de los demás: con
 * horarios cada media hora, el hueco del almuerzo son dos horas y media y se
 * distingue solo. Se mide contra la mediana y no contra un número fijo de
 * minutos porque el paso cambia por canal —media hora en WhatsApp, un cuarto en
 * la web— y porque los horarios que arrancan al terminar una cita no caen en
 * ninguna grilla.
 *
 * Sin al menos tres horarios no hay de qué sacar una mediana, y tampoco hay nada
 * que partir.
 */
function splitByDayGaps<T extends TimedSlot>(slots: T[]): T[][] {
  if (slots.length < 3) return [slots];

  const gaps = slots.slice(1).map((slot, i) => minutesBetween(slots[i], slot));

  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median <= 0) return [slots];

  const pieces: T[][] = [];
  let from = 0;

  gaps.forEach((gap, i) => {
    if (gap < median * 2) return;
    pieces.push(slots.slice(from, i + 1));
    from = i + 1;
  });

  pieces.push(slots.slice(from));
  return pieces.filter((piece) => piece.length > 0);
}

/** Subdivide un tramo continuo hasta que cada pedazo entre en una pantalla. */
function splitByCount<T extends TimedSlot>(
  slots: T[],
  capacity: number,
): T[][] {
  const parts = Math.max(1, Math.ceil(slots.length / capacity));
  if (parts === 1) return [slots];

  const cuts = chooseCuts(slots, parts, capacity);

  const ranges: T[][] = [];
  let from = 0;
  for (const cut of [...cuts, slots.length]) {
    if (cut > from) ranges.push(slots.slice(from, cut));
    from = cut;
  }

  return ranges;
}

/**
 * Dónde cortar: repartido parejo, pero corrido hacia los huecos del día.
 *
 * El corte ideal es el que deja los rangos del mismo tamaño. Se lo mueve hasta
 * `CUT_TOLERANCE` posiciones si con eso cae en una discontinuidad —el hueco del
 * almuerzo, un rato que alguien ya reservó—, porque ahí el rango coincide con la
 * forma real del día y la etiqueta se lee como algo que existe y no como una
 * división arbitraria.
 *
 * Nunca a costa de que un pedazo se pase de la pantalla: si correrlo lo
 * provocaría, el corte se queda donde estaba. Sin esa atadura los cortes se van
 * hacia adelante y el último rango se lleva todo lo que sobró.
 */
function chooseCuts<T extends TimedSlot>(
  slots: T[],
  parts: number,
  capacity: number,
): number[] {
  const target = slots.length / parts;
  const cuts: number[] = [];

  for (let k = 1; k < parts; k += 1) {
    const ideal = Math.round(k * target);
    const previous = cuts[cuts.length - 1] ?? 0;
    const partsLeft = parts - k;

    // El corte tiene que dejar un pedazo que entre y un resto repartible.
    const lo = Math.max(
      previous + 1,
      ideal - CUT_TOLERANCE,
      slots.length - partsLeft * capacity,
    );
    const hi = Math.min(
      previous + capacity,
      slots.length - partsLeft,
      ideal + CUT_TOLERANCE,
    );

    if (lo > hi) {
      cuts.push(
        Math.max(1, Math.min(previous + capacity, slots.length - partsLeft)),
      );
      continue;
    }

    let best = Math.min(Math.max(ideal, lo), hi);
    let bestGap = -1;

    for (let i = lo; i <= hi; i += 1) {
      const gap = minutesBetween(slots[i - 1], slots[i]);

      /*
       * A igualdad de salto gana el corte más parejo. Sin este desempate, en una
       * agenda vacía —donde todos los saltos son iguales— gana siempre el
       * extremo de la ventana y quedan rangos de tres y de siete.
       */
      const better =
        gap > bestGap ||
        (gap === bestGap && Math.abs(i - ideal) < Math.abs(best - ideal));

      if (better) {
        bestGap = gap;
        best = i;
      }
    }

    cuts.push(best);
  }

  return cuts;
}

/** Junta los rangos más chicos hasta que entren en las filas disponibles. */
function mergeUntil<T extends TimedSlot>(
  ranges: T[][],
  maxRanges: number,
): T[][] {
  const merged = [...ranges];

  while (merged.length > maxRanges) {
    let best = 0;
    for (let i = 1; i < merged.length - 1; i += 1) {
      if (
        merged[i].length + merged[i + 1].length <
        merged[best].length + merged[best + 1].length
      ) {
        best = i;
      }
    }
    merged.splice(best, 2, [...merged[best], ...merged[best + 1]]);
  }

  return merged;
}

function minutesBetween(a: TimedSlot, b: TimedSlot): number {
  return (b.startTime.getTime() - a.startTime.getTime()) / 60_000;
}
