/**
 * Formateo de precios para mostrar al cliente.
 *
 * `services.price` es un decimal sin moneda; la moneda vive en el tenant. Estas
 * dos piezas siempre viajan juntas hasta acá.
 */

/** Moneda de reserva cuando el tenant no tiene una configurada. */
const FALLBACK_CURRENCY = 'BOB';

/**
 * Locale con el que se formatea cada moneda.
 *
 * El símbolo lo elige el locale, no la moneda: `es-AR` con BOB imprime
 * "BOB 8.000", mientras que `es-BO` imprime "Bs 8.000". Formatear cada moneda con
 * el locale de su país es lo que hace que el precio se vea como el cliente espera.
 */
const CURRENCY_LOCALES: Record<string, string> = {
  BOB: 'es-BO',
  ARS: 'es-AR',
  CLP: 'es-CL',
  COP: 'es-CO',
  MXN: 'es-MX',
  PEN: 'es-PE',
  UYU: 'es-UY',
  PYG: 'es-PY',
  USD: 'en-US',
  EUR: 'es-ES',
};

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
  const amount = typeof value === 'string' ? Number(value) : value;
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
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

function normalizeCurrency(currency?: string | null): string {
  const trimmed = currency?.trim().toUpperCase();
  return trimmed && /^[A-Z]{3}$/.test(trimmed) ? trimmed : FALLBACK_CURRENCY;
}
