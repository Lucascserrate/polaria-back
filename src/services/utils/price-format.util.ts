/**
 * Formateo de precios para mostrar al cliente.
 *
 * `services.price` es un decimal sin moneda; la moneda vive en el tenant. Estas
 * dos piezas siempre viajan juntas hasta acá.
 */

import { CURRENCY_LOCALES, DEFAULT_CURRENCY } from '../../tenants/currency';
import { QUOTED_PRICE_LABEL, toPrice } from '../quoted-price';

/** Moneda de reserva cuando el tenant no tiene una configurada. */
const FALLBACK_CURRENCY: string = DEFAULT_CURRENCY;

const FALLBACK_LOCALE = 'es';

/**
 * Devuelve el precio con su símbolo: `Bs 80`, `$ 8.000`.
 *
 * TypeORM entrega las columnas `decimal` de MySQL como string, así que el valor
 * se normaliza antes de formatear. Si no es un número, se devuelve `null` en vez
 * de mostrar `NaN` en una lista de servicios.
 */
export function formatPrice(
  value: number | string | null | undefined,
  currency?: string | null,
): string | null {
  const amount = toPrice(value);
  if (amount === null) {
    return null;
  }

  const code = normalizeCurrency(currency);

  try {
    return new Intl.NumberFormat(CURRENCY_LOCALES[code] ?? FALLBACK_LOCALE, {
      style: 'currency',
      currency: code,
      // Los precios de una barbería son redondos; los centavos solo agregan ruido.
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // Un código de moneda inválido no debe romper la lista de servicios.
    return `${code} ${Math.round(amount)}`;
  }
}

/**
 * El precio de un servicio tal como se le muestra al cliente: el importe, o el
 * aviso de que se cotiza.
 *
 * Es la forma que usan los canales —la lista de WhatsApp, el Flow, la página—,
 * porque ahí no hay dónde poner un hueco: una fila sin precio se lee como un
 * error de la aplicación, no como un servicio que se cotiza. `formatPrice` sigue
 * devolviendo `null` para quien necesite decidir otra cosa.
 */
export function formatServicePrice(
  value: number | string | null | undefined,
  currency?: string | null,
): string {
  return formatPrice(value, currency) ?? QUOTED_PRICE_LABEL;
}

function normalizeCurrency(currency?: string | null): string {
  const trimmed = currency?.trim().toUpperCase();
  return trimmed && /^[A-Z]{3}$/.test(trimmed) ? trimmed : FALLBACK_CURRENCY;
}
