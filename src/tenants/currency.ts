/**
 * Moneda del negocio, deducida de su zona horaria.
 *
 * Hace falta porque `services.price` es un decimal sin unidad: la moneda vive en
 * el tenant y viaja aparte hasta la pantalla que muestra el precio. Mientras la
 * columna se quedaba en su valor por defecto, un negocio colombiano publicaba
 * sus precios en bolivianos.
 *
 * Se deduce de la zona horaria por la misma razón que el prefijo telefónico —ver
 * `dial-code`—: el negocio ya cargó su zona en la configuración inicial, y
 * preguntarle el país otra vez sería pedir dos veces el mismo dato.
 *
 * Deducir es acertar casi siempre, no siempre: un boliviano puede cobrar en
 * dólares, y un dueño puede configurar todo desde un viaje. Por eso esto es el
 * **valor por defecto** y no la verdad: la moneda se guarda como columna propia y
 * se corrige desde el precio del servicio, que es el único lugar donde una
 * moneda equivocada se ve.
 */

/**
 * Monedas que Polaria sabe escribir.
 *
 * Cerrada y no un campo libre de tres letras porque cada código necesita su
 * locale acá abajo para imprimirse con el símbolo que el cliente espera. Un
 * código sin locale imprime "COP 45.000" en vez de "$ 45.000", que es la mitad
 * del problema que este módulo viene a resolver.
 */
export const CURRENCIES = [
  'BOB',
  'ARS',
  'BRL',
  'CLP',
  'COP',
  'CRC',
  'DOP',
  'EUR',
  'GTQ',
  'HNL',
  'MXN',
  'NIO',
  'PEN',
  'PYG',
  'USD',
  'UYU',
  'VES',
] as const;

export type Currency = (typeof CURRENCIES)[number];

/**
 * Locale con el que se formatea cada moneda.
 *
 * El símbolo lo elige el locale, no la moneda: `es-AR` con BOB imprime
 * "BOB 8.000", mientras que `es-BO` imprime "Bs 8.000". Formatear cada moneda con
 * el locale de su país es lo que hace que el precio se vea como el cliente
 * espera.
 */
export const CURRENCY_LOCALES: Record<string, string> = {
  BOB: 'es-BO',
  ARS: 'es-AR',
  BRL: 'pt-BR',
  CLP: 'es-CL',
  COP: 'es-CO',
  CRC: 'es-CR',
  DOP: 'es-DO',
  EUR: 'es-ES',
  GTQ: 'es-GT',
  HNL: 'es-HN',
  MXN: 'es-MX',
  NIO: 'es-NI',
  PEN: 'es-PE',
  PYG: 'es-PY',
  USD: 'en-US',
  UYU: 'es-UY',
  VES: 'es-VE',
};

/**
 * Mismo criterio que `DIAL_CODE_BY_TIME_ZONE`: sólo las zonas donde Polaria
 * opera. Una zona que no está acá cae al valor por defecto.
 *
 * No están todas las zonas de cada país —Brasil y México tienen más de diez cada
 * uno— sino las que concentran la población. Las que faltan caen al default, que
 * es lo mismo que pasaba antes de que este módulo existiera.
 */
const CURRENCY_BY_TIME_ZONE: Record<string, Currency> = {
  'America/La_Paz': 'BOB',
  'America/Montevideo': 'UYU',
  'America/Asuncion': 'PYG',
  'America/Santiago': 'CLP',
  'America/Punta_Arenas': 'CLP',
  'America/Lima': 'PEN',
  'America/Bogota': 'COP',
  // Ecuador, El Salvador y Panamá cobran en dólares: no tienen moneda propia.
  'America/Guayaquil': 'USD',
  'America/San_Salvador': 'USD',
  'America/Panama': 'USD',
  'America/Caracas': 'VES',
  'America/Sao_Paulo': 'BRL',
  'America/Bahia': 'BRL',
  'America/Fortaleza': 'BRL',
  'America/Recife': 'BRL',
  'America/Manaus': 'BRL',
  'America/Belem': 'BRL',
  'America/Cuiaba': 'BRL',
  'America/Campo_Grande': 'BRL',
  'America/Mexico_City': 'MXN',
  'America/Monterrey': 'MXN',
  'America/Cancun': 'MXN',
  'America/Merida': 'MXN',
  'America/Chihuahua': 'MXN',
  'America/Mazatlan': 'MXN',
  'America/Tijuana': 'MXN',
  'America/Hermosillo': 'MXN',
  'America/Guatemala': 'GTQ',
  'America/Tegucigalpa': 'HNL',
  'America/Managua': 'NIO',
  'America/Costa_Rica': 'CRC',
  'America/Santo_Domingo': 'DOP',
  'Europe/Madrid': 'EUR',
};

/** Bolivia: es donde están los primeros negocios. */
export const DEFAULT_CURRENCY: Currency = 'BOB';

export function currencyForTimeZone(timeZone?: string | null): Currency {
  if (!timeZone) return DEFAULT_CURRENCY;

  /*
   * Las zonas de Argentina son una familia entera —una por provincia— y todas
   * comparten moneda. Se resuelve por prefijo de la zona para no listar las
   * veintitantas ni quedar corto cuando aparezca otra.
   */
  if (timeZone.startsWith('America/Argentina/')) return 'ARS';

  return CURRENCY_BY_TIME_ZONE[timeZone] ?? DEFAULT_CURRENCY;
}

/** `true` si el código es una moneda que Polaria sabe escribir. */
export function isSupportedCurrency(value?: string | null): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value ?? '');
}
