/**
 * Los servicios que no publican precio.
 *
 * Hay rubros donde el precio no se puede escribir de antemano: una coloración
 * depende del largo y del estado del pelo, un tratamiento de piel de lo que se
 * vea en la consulta. El negocio no está escondiendo el precio —lo cotiza cuando
 * ve a la persona— y obligarlo a inventar un número le hace prometer algo que
 * después no va a cumplir.
 *
 * Eso se guarda como `price = NULL`, y no como una bandera al lado del precio,
 * porque `NULL` es lo único que atraviesa sin ayuda todo lo que ya existe: un
 * `SUM` lo saltea, `Number()` lo delata y cualquier pantalla que no lo contemple
 * muestra vacío. Con una bandera, todo lo que no la mire sigue leyendo el `0` que
 * quedó abajo y muestra un servicio gratis.
 *
 * `NULL` no es `0`. El cero es un precio: significa que no se cobra —una primera
 * consulta, una seña bonificada— y suma como cero a la facturación. `NULL` es la
 * ausencia de precio, y lo que suma es nada.
 *
 * Es distinto de `CONSULTATION_FIRST` (ver `booking-policy.ts`), que responde
 * otra pregunta: **quién** puede reservarlo. Un servicio se puede cotizar y ser
 * reservable —el cliente agenda y el precio sale en el momento—, o tener precio
 * fijo y aun así necesitar que lo agende el negocio. Se combinan las cuatro.
 *
 * Todo lo de este archivo es puro.
 */

/**
 * Lo que se muestra donde iría el precio.
 *
 * Una sola frase para todos los canales —el panel, la página, WhatsApp, el
 * asistente—: si cada uno eligiera la suya, el mismo servicio diría tres cosas
 * distintas según dónde lo mire el cliente.
 *
 * Dice qué falta y no "a consultar", que se lee como si el precio existiera y no
 * lo quisieran publicar. Entra entera en la fila de una lista de WhatsApp, que es
 * el lugar más angosto donde aparece.
 */
export const QUOTED_PRICE_LABEL = 'Requiere diagnóstico';

/**
 * El precio como número, o `null` si no hay.
 *
 * Existe porque `Number(null)` es `0`, y ese `0` no falla en ningún lado: se
 * guarda, se suma y se muestra como un servicio gratis. Cada vez que un precio
 * sale de la base pasa por acá.
 *
 * TypeORM entrega las columnas `decimal` de MySQL como string, así que también se
 * encarga de eso. Un valor que no es un número —una columna corrupta, un `NaN`
 * que viajó en un JSON— se trata como ausente: mostrar "sin precio" es peor que
 * mostrar `NaN` solo si el dato existía, y acá no existe.
 */
export const toPrice = (
  value: number | string | null | undefined,
): number | null => {
  if (value === null || value === undefined || value === '') return null;

  const amount = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(amount) ? amount : null;
};

/** Si el servicio publica un precio. `0` publica uno: es gratis. */
export const hasPrice = (value: number | string | null | undefined): boolean =>
  toPrice(value) !== null;
