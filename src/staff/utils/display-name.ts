/**
 * Cómo se escribe el nombre de un miembro del equipo.
 *
 * El formulario tiene nombre y apellido separados, pero `staff.name` sigue
 * existiendo y sigue siendo lo que leen los reportes, los avisos de WhatsApp, los
 * prompts del asistente y las columnas de la agenda. Se mantiene escrito por el
 * servicio en cada guardado en lugar de eliminarse: son una docena de consumidores
 * que no ganan nada con recomponer dos campos cada vez, y varios de ellos son
 * consultas SQL que ordenan por esa columna.
 *
 * Así que `name` no es un dato que el negocio cargue: es una proyección de
 * `firstName` y `lastName`, y esta función es la única que la produce.
 */
export const displayNameOf = (member: {
  firstName: string;
  lastName?: string | null;
}): string =>
  [member.firstName, member.lastName].map(clean).filter(Boolean).join(' ');

const clean = (value?: string | null) => value?.trim() ?? '';

/**
 * Parte un nombre completo en nombre y apellido.
 *
 * Solo para migrar lo que ya está cargado, donde `staff.name` es el único dato
 * que hay. El primer token es el nombre y el resto el apellido: con "Juan Carlos
 * Pérez" no hay forma de saber si Carlos es segundo nombre o primer apellido, y
 * cualquier regla más elaborada acierta menos que dejar que el negocio lo corrija.
 */
export const splitFullName = (
  name: string,
): { firstName: string; lastName: string | null } => {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  return {
    firstName: parts[0] ?? '',
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : null,
  };
};
