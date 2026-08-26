/**
 * Colores con los que se distingue a cada profesional en la agenda.
 *
 * Se guarda un **token** (`blue`, `blood-orange`) y no un hexadecimal. La agenda
 * se dibuja en tema claro y oscuro, así que cada color son en realidad varios
 * —el relleno, el tinte de fondo y el texto que tiene que contrastar contra los
 * dos fondos—, y eso no cabe en una columna. Con el token, la paleta se ajusta
 * desplegando el cliente; con un hex guardado, los profesionales cargados antes
 * del ajuste se quedarían con el tono viejo para siempre.
 *
 * Acá vive qué valores son válidos, y el orden en que se ofrecen: recorre el
 * círculo de tonos, del celeste al cian. Cómo se ve cada uno vive en el cliente,
 * que es quien pinta.
 *
 * El token más largo es `blood-orange`, de 12 caracteres. La columna es
 * `varchar(16)`: un nombre más largo se guardaría truncado y al volver no
 * coincidiría con ninguno de la paleta.
 */
export const STAFF_CALENDAR_COLORS = [
  'blue',
  'dark-blue',
  'jordy-blue',
  'indigo',
  'lavender',
  'wisteria',
  'pink',
  'coral',
  'blood-orange',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'teal',
  'cyan',
] as const;

export type StaffCalendarColor = (typeof STAFF_CALENDAR_COLORS)[number];

/**
 * Un color para quien todavía no tiene, estable a partir de su id.
 *
 * Derivarlo del id y no sortearlo tiene una razón concreta: el color se elige al
 * crear, pero el equipo existente quedó sin ninguno tras la migración, y un color
 * al azar cambiaría en cada render. Con el id, la misma persona es siempre del
 * mismo color aunque nadie lo haya elegido.
 */
export const fallbackCalendarColor = (seed: string): StaffCalendarColor => {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 100_000;
  }

  return STAFF_CALENDAR_COLORS[hash % STAFF_CALENDAR_COLORS.length];
};
