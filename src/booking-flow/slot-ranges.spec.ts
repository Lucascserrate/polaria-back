import { planSlotScreen, type SlotScreen } from './slot-ranges';

/**
 * Cómo se reparten los horarios de un día en la pantalla de WhatsApp.
 *
 * Los dos límites se pasan siempre explícitos porque son distintos y confundirlos
 * es el error que esta especificación viene a evitar: uno es cuántas filas de
 * contenido tiene la pantalla inicial, el otro cuántos horarios entran en la
 * pantalla de un rango.
 */

/** Lo que deja una lista nativa de 10 filas menos "Ver otros días" y "Cancelar". */
const SCREEN_ROWS = 8;
/** Los que entran en un rango, menos "Ver otros horarios" y "Cancelar". */
const RANGE_CAPACITY = 8;

/** Horarios de un día, cada `step` minutos desde `from`. */
const grid = (from: string, count: number, step = 30) => {
  const [hour, minute] = from.split(':').map(Number);
  return Array.from({ length: count }, (_, i) => ({
    startTime: new Date(Date.UTC(2026, 8, 24, hour, minute + i * step)),
  }));
};

const hhmm = (slot: { startTime: Date }) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(slot.startTime);

/** El rango como lo vería el cliente: "09:00 a 12:30". */
const label = (range: Array<{ startTime: Date }>) =>
  `${hhmm(range[0])} a ${hhmm(range[range.length - 1])}`;

const plan = (slots: Array<{ startTime: Date }>) =>
  planSlotScreen({
    slots,
    screenRows: SCREEN_ROWS,
    rangeCapacity: RANGE_CAPACITY,
  });

const grouped = <T extends { startTime: Date }>(screen: SlotScreen<T>) => {
  if (screen.kind !== 'grouped') throw new Error('se esperaba agrupado');
  return screen;
};

describe('planSlotScreen', () => {
  describe('cuando no hace falta agrupar', () => {
    it('con pocos horarios los muestra tal cual', () => {
      expect(plan(grid('16:00', 4)).kind).toBe('all');
    });

    it('con los justos para llenar la pantalla, tampoco agrupa', () => {
      expect(plan(grid('09:00', 8)).kind).toBe('all');
    });

    /*
     * Hasta acá la paginación de siempre llega al último horario con un solo
     * toque. Agrupar costaría ese mismo toque pero se lo cobraría también a
     * quien quería el primero de la lista.
     */
    it('con quince tampoco: un "ver más" alcanza', () => {
      expect(plan(grid('09:00', 15)).kind).toBe('all');
    });

    it('con dieciséis ya conviene agrupar', () => {
      expect(plan(grid('09:00', 16)).kind).toBe('grouped');
    });
  });

  describe('la pantalla agrupada', () => {
    const screen = grouped(plan(grid('09:00', 20)));

    it('deja los próximos horarios sueltos arriba', () => {
      expect(screen.next.map(hhmm)).toEqual(['09:00', '09:30', '10:00']);
    });

    it('entra en las filas disponibles', () => {
      expect(screen.next.length + screen.ranges.length).toBeLessThanOrEqual(
        SCREEN_ROWS,
      );
    });

    it('ningún rango se pasa de una pantalla', () => {
      for (const range of screen.ranges) {
        expect(range.length).toBeLessThanOrEqual(RANGE_CAPACITY);
      }
    });

    it('no repite ningún horario entre los sueltos y los rangos', () => {
      const todos = [...screen.next, ...screen.ranges.flat()].map(hhmm);
      expect(new Set(todos).size).toBe(todos.length);
    });

    it('no pierde ninguno', () => {
      expect(screen.next.length + screen.ranges.flat().length).toBe(20);
    });

    it('los rangos van en orden y sin solaparse', () => {
      const ordenados = screen.ranges.flat().map((s) => s.startTime.getTime());
      expect(ordenados).toEqual([...ordenados].sort((a, b) => a - b));
    });
  });

  describe('los rangos siguen la forma del día', () => {
    /*
     * Turno partido: de 09:00 a 13:00 y de 15:00 a 20:00. El corte tiene que
     * caer en el hueco del mediodía, para que la etiqueta coincida con el
     * horario que el negocio reconoce como suyo.
     */
    it('corta en el hueco del almuerzo', () => {
      const { ranges } = grouped(
        plan([...grid('09:00', 8), ...grid('15:00', 10)]),
      );

      const etiquetas = ranges.map(label);
      expect(etiquetas.some((e) => e.endsWith('a 12:30'))).toBe(true);
      expect(etiquetas.some((e) => e.startsWith('15:00'))).toBe(true);
    });

    /*
     * Con la agenda vacía todos los saltos son iguales, así que no hay hueco al
     * que correrse y los rangos tienen que quedar parejos. Sin desempatar por
     * cercanía al corte ideal quedaban de tres y de siete.
     */
    it('con saltos uniformes los deja parejos', () => {
      const { ranges } = grouped(plan(grid('09:00', 24)));
      const tamaños = ranges.map((r) => r.length);

      expect(Math.max(...tamaños) - Math.min(...tamaños)).toBeLessThanOrEqual(
        1,
      );
    });
  });

  describe('días muy largos', () => {
    /*
     * Doce horas con paso de quince minutos. Es el caso que hoy cuesta cinco
     * toques de "ver más" y el que justifica todo esto.
     */
    const screen = grouped(plan(grid('09:00', 48, 15)));

    it('entra en la pantalla igual', () => {
      expect(screen.next.length + screen.ranges.length).toBeLessThanOrEqual(
        SCREEN_ROWS,
      );
    });

    it('sin que ningún rango tenga que paginar', () => {
      for (const range of screen.ranges) {
        expect(range.length).toBeLessThanOrEqual(RANGE_CAPACITY);
      }
    });

    it('cubre el día entero', () => {
      expect(screen.next.length + screen.ranges.flat().length).toBe(48);
    });

    /*
     * Con 48 horarios ya no alcanzan tres sueltos: se muestran menos para que
     * los rangos entren. Es la variable de ajuste de la pantalla.
     */
    /*
     * Con 48 horarios no entran tres sueltos, y uno o dos no forman bloque: la
     * pantalla queda sólo de rangos, con una intención sola.
     */
    it('se queda sin sueltos antes que dejar un bloque de uno', () => {
      expect(screen.next).toHaveLength(0);
    });
  });

  describe('límites', () => {
    it('sin horarios no hay nada que mostrar', () => {
      expect(plan([]).kind).toBe('all');
    });

    /*
     * Más horarios que `filas * capacidad`. No se puede evitar que algún rango
     * pagine, pero la pantalla tiene que seguir siendo dibujable.
     */
    it('con un día imposible reparte igual sin pasarse de las filas', () => {
      const screen = grouped(plan(grid('00:00', 90, 10)));

      expect(screen.ranges.length).toBeLessThanOrEqual(SCREEN_ROWS);
      expect(screen.next.length + screen.ranges.flat().length).toBe(90);
    });

    it('respeta un tope de sueltos distinto', () => {
      const screen = planSlotScreen({
        slots: grid('09:00', 20),
        screenRows: SCREEN_ROWS,
        rangeCapacity: RANGE_CAPACITY,
        maxNext: 1,
        minNext: 1,
      });

      expect(grouped(screen).next).toHaveLength(1);
    });

    it('respeta un umbral distinto', () => {
      const screen = planSlotScreen({
        slots: grid('09:00', 10),
        screenRows: SCREEN_ROWS,
        rangeCapacity: RANGE_CAPACITY,
        threshold: 10,
      });

      expect(screen.kind).toBe('grouped');
    });

    /*
     * Los dos límites son distintos y el algoritmo tiene que respetar cada uno
     * por separado: una pantalla angosta con rangos grandes, y al revés.
     */
    it('con una pantalla más angosta usa menos rangos', () => {
      const screen = grouped(
        planSlotScreen({
          slots: grid('09:00', 20),
          screenRows: 4,
          rangeCapacity: RANGE_CAPACITY,
        }),
      );

      expect(screen.next.length + screen.ranges.length).toBeLessThanOrEqual(4);
    });

    it('con rangos más chicos usa más rangos', () => {
      const screen = grouped(
        planSlotScreen({
          slots: grid('09:00', 20),
          screenRows: SCREEN_ROWS,
          rangeCapacity: 4,
        }),
      );

      for (const range of screen.ranges) {
        expect(range.length).toBeLessThanOrEqual(4);
      }
    });
  });

  /**
   * Un horario suelto arriba de siete rangos no se lee como atajo sino como un
   * error de la pantalla. O son un bloque, o no están.
   */
  describe('el bloque de horarios sueltos', () => {
    it('no deja nunca uno o dos sueltos', () => {
      for (let n = 16; n <= 60; n += 1) {
        const screen = plan(grid('09:00', n, 15));
        if (screen.kind !== 'grouped') continue;

        expect([0, 3]).toContain(screen.next.length);
      }
    });

    it('con un día corto sí los muestra, porque son tres', () => {
      const screen = grouped(plan(grid('09:00', 20)));

      expect(screen.next).toHaveLength(3);
    });
  });
});
