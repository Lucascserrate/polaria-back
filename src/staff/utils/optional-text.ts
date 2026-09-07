/**
 * Cómo se lee un campo de texto opcional que llega en un patch.
 *
 * Los tres valores de entrada son tres intenciones distintas, y confundirlas es
 * lo que hacía imposible **vaciar** un campo desde el panel:
 *
 * - `undefined`: no se tocó. Es lo que `merge` saltea, así que la columna queda
 *   como estaba.
 * - `''`: se borró el contenido. Tiene que llegar a la base como `NULL`.
 * - texto: el valor nuevo, sin espacios en los extremos.
 *
 * `NULL` y no cadena vacía porque son dos formas de escribir lo mismo, y con
 * las dos conviviendo cada lector tiene que acordarse de preguntar por ambas:
 * `if (!staff.lastName)` acierta, pero `staff.lastName !== null` no. Una sola
 * forma posible en la columna es lo que hace que "sin apellido" se pueda
 * comprobar de una manera. Es el mismo criterio que `normalizeStaffPhone`, que
 * además normaliza el formato del número.
 */
export function normalizeOptionalText(
  value: string | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  return value.trim() || null;
}
