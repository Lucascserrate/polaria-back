/**
 * Normaliza el teléfono de un cliente al formato con el que ya está guardado.
 *
 * El formato de referencia lo fija WhatsApp, no Polaria: el `wa_id` que manda
 * Meta son dígitos con código de país y sin `+` (`59170123456`), y así se guarda
 * el cliente que llega por el asistente. Cualquier otro canal que quiera
 * reconocer a la misma persona tiene que escribir igual, o el índice único
 * `(tenantId, phone)` la duplica y la reserva nueva queda huérfana de historial.
 *
 * Por eso vive en `clients` y no en el módulo que lo llama: la forma del
 * teléfono es una regla del cliente, y la próxima puerta de entrada —una página
 * pública, un formulario web, una app— tiene que encontrarla acá y no
 * reinventarla.
 */

/** Un número sin código de país, tal como lo escribe alguien de su propio país. */
const MIN_LOCAL_DIGITS = 6;

/** Tope de E.164. Más que esto no es un teléfono, es un error de tipeo. */
const MAX_DIGITS = 15;

/**
 * Devuelve el número en formato `wa_id`, o `null` si no es utilizable.
 *
 * `null` es la respuesta ante cualquier duda: guardar un teléfono inventado es
 * peor que rechazar el formulario, porque el recordatorio de la cita se va a un
 * número que no existe y nadie se entera hasta que el cliente no aparece.
 *
 * @param dialCode Prefijo del país del negocio, sin `+`. Se antepone sólo
 * cuando el número parece local. Ver `dialCodeForTimeZone`.
 */
export function normalizeClientPhone(
  raw: string,
  dialCode: string,
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  /*
   * `00` es el prefijo internacional de la marcación tradicional y equivale al
   * `+`. Se saca antes de quedarse con los dígitos porque después es
   * indistinguible del número.
   */
  const withoutIddPrefix = trimmed.replace(/^\s*(?:\+|00)/, '+');
  const isExplicitlyInternational = withoutIddPrefix.startsWith('+');
  const digits = withoutIddPrefix.replace(/\D/g, '');

  if (!digits) return null;
  if (digits.length > MAX_DIGITS) return null;

  /*
   * Ya trae país: se respeta tal cual. Es el caso del cliente que está de viaje
   * o cuyo número no es del país del negocio, y anteponerle el prefijo local le
   * rompería el número.
   */
  if (isExplicitlyInternational || digits.startsWith(dialCode)) {
    return digits.length >= MIN_LOCAL_DIGITS ? digits : null;
  }

  if (digits.length < MIN_LOCAL_DIGITS) return null;

  const withDialCode = `${dialCode}${digits}`;
  return withDialCode.length <= MAX_DIGITS ? withDialCode : null;
}

/**
 * Valida un teléfono que ya viene en el formato de referencia.
 *
 * Es el `wa_id` de Meta: E.164 sin `+`, con el país del cliente, no el del
 * negocio. Sólo se comprueba que sea un teléfono; **no** se le antepone ningún
 * prefijo, y ahí está toda la razón de que esta función exista aparte.
 *
 * Pasar un `wa_id` por `normalizeClientPhone` rompe a cualquier cliente que no
 * sea del país del negocio, de dos maneras y las dos malas. Al argentino que le
 * escribe a una barbería boliviana —`5491123456789`, que no empieza con `591`—
 * se le anteponía el prefijo, el resultado pasaba de quince dígitos y el número
 * se descartaba entero. Al colombiano —`573001234567`, más corto— el resultado
 * entraba justo en el límite y se guardaba `591573001234567`: un número que no
 * existe, en un cliente que parece normal, y con un recordatorio en camino a
 * ninguna parte.
 */
export function canonicalizeWhatsAppPhone(waId: string): string | null {
  const digits = waId.trim().replace(/\D/g, '');

  if (digits.length < MIN_LOCAL_DIGITS) return null;
  if (digits.length > MAX_DIGITS) return null;

  return digits;
}

/**
 * De dónde salió el teléfono, que es lo que decide cómo se lee.
 *
 * La distinción es del canal, no del número: los mismos dígitos significan una
 * cosa viniendo de Meta y otra viniendo de un formulario. Se declara en el
 * llamador porque es el único que lo sabe, y se declara explícitamente porque la
 * alternativa —adivinarlo mirando el número— es justamente lo que corrompía
 * datos en silencio.
 */
export type ClientPhoneInput =
  /** El `wa_id` de Meta. Ya es canónico: se valida y se usa tal cual. */
  | { kind: 'whatsapp'; value: string }
  /**
   * Lo escribió una persona en un formulario. Se normaliza contra el prefijo
   * del país del negocio, porque casi siempre va a escribir su número local.
   */
  | { kind: 'typed'; value: string; dialCode: string };

/** El teléfono listo para guardar, o `null` si no es utilizable. */
export function resolveClientPhone(input: ClientPhoneInput): string | null {
  return input.kind === 'whatsapp'
    ? canonicalizeWhatsAppPhone(input.value)
    : normalizeClientPhone(input.value, input.dialCode);
}
