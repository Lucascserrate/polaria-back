/**
 * Anticipaciones con las que se puede avisar una cita, en minutos.
 *
 * Un negocio puede tener varias activas a la vez: el aviso del día anterior y el
 * de un rato antes son dos recordatorios distintos de la misma cita, no un
 * ajuste de uno solo. La tabla `appointment_reminders` ya lo soportaba —su clave
 * única incluye `offsetMinutes`— así que lo único que faltaba era que el negocio
 * pudiera configurar más de uno.
 *
 * La lista de aceptados es más larga que la que expone el panel a propósito:
 * agregar "6 horas antes" a la interfaz no debería requerir una migración.
 */
export const SUPPORTED_REMINDER_OFFSETS = [1440, 720, 360, 180, 60];

/** Lo que trae un negocio nuevo: el aviso del día anterior. */
export const DEFAULT_REMINDER_OFFSETS = [1440];

/**
 * Deja la lista guardada en una forma con la que se pueda trabajar.
 *
 * La columna es JSON, así que su contenido no está garantizado por el esquema:
 * puede venir con repetidos, con valores que ya no se soportan o directamente
 * con algo que no es una lista. Se descarta lo que no sirve en lugar de confiar,
 * porque un valor raro acá no produce un error visible: produce un recordatorio
 * a una hora absurda.
 *
 * Se ordena de mayor a menor —del más lejano al más cercano a la cita—, que es
 * el orden en que los recordatorios van a salir.
 */
export function normalizeReminderOffsets(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];

  const valid = raw
    .map((value) => Number(value))
    .filter(
      (value) =>
        Number.isInteger(value) && SUPPORTED_REMINDER_OFFSETS.includes(value),
    );

  return [...new Set(valid)].sort((a, b) => b - a);
}
