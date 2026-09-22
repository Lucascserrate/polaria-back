/**
 * Cómo se nombra una cita de varios servicios cuando hay una sola línea para
 * decirla.
 *
 * Existe porque una reserva dejó de ser un servicio. Un turno de corte y barba
 * se guarda como dos tramos, y los lugares que lo resumen —el recordatorio de
 * WhatsApp, el menú de "ya tenés un turno", el aviso de la página pública—
 * tomaban el primero y nombraban sólo ése. El cliente leía "Corte" para un turno
 * de dos horas que incluye la barba, y con dos profesionales distintos ni
 * siquiera aparecía el segundo.
 *
 * Puro y separado de los servicios a propósito: son tres canales que tienen que
 * decir lo mismo, y tres redacciones distintas del mismo turno son tres formas
 * de que uno quede desactualizado.
 */

/** Lo mínimo que hace falta de un tramo para poder nombrarlo. */
export type NamedSegment = {
  service?: { name?: string | null } | null;
  staff?: { name?: string | null } | null;
};

/**
 * Cuántos servicios se nombran antes de resumir el resto.
 *
 * Tres y no todos porque esto va, entre otros lugares, en la descripción de una
 * fila de lista de WhatsApp, que se corta a los 72 caracteres. "Corte, Barba y 2
 * más" dice cuántos hay sin arriesgarse a que el texto se corte a la mitad de
 * una palabra, que es la única forma de quedar peor que resumiendo.
 */
const MAX_NAMED = 3;

/** El texto que se usa cuando el tramo no trajo el nombre del servicio. */
const FALLBACK = 'Turno';

/**
 * Los servicios de la cita, en orden y escritos para leer.
 *
 * "Corte", "Corte y Barba", "Corte, Barba y Perfilado", "Corte, Barba,
 * Perfilado y 2 más". La `y` antes del último es lo que lo hace una frase y no
 * un listado de sistema.
 */
export function describeServices(segments: NamedSegment[]): string {
  const names = segments
    .map((segment) => segment.service?.name?.trim())
    .filter((name): name is string => Boolean(name));

  if (names.length === 0) return FALLBACK;
  if (names.length <= MAX_NAMED) return joinWithAnd(names);

  const rest = names.length - MAX_NAMED;
  return `${names.slice(0, MAX_NAMED).join(', ')} y ${rest} más`;
}

/**
 * Quién atiende, o `null` si el dato no vino.
 *
 * Los nombres se de-duplican: lo normal es que el corte y la barba los haga la
 * misma persona, y "Con Fernando y Fernando" sería un error de lectura, no un
 * detalle. Con dos personas distintas se nombran las dos, porque el cliente
 * necesita saber que lo van a atender dos.
 */
export function describeStaff(segments: NamedSegment[]): string | null {
  const names = [
    ...new Set(
      segments
        .map((segment) => segment.staff?.name?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ];

  if (names.length === 0) return null;
  if (names.length <= MAX_NAMED) return joinWithAnd(names);

  const rest = names.length - MAX_NAMED;
  return `${names.slice(0, MAX_NAMED).join(', ')} y ${rest} más`;
}

/** "a", "a y b", "a, b y c". */
function joinWithAnd(names: string[]): string {
  if (names.length === 1) return names[0];

  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}
