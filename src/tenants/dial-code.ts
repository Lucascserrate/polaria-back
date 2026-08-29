/**
 * Prefijo telefónico del país del negocio, deducido de su zona horaria.
 *
 * Hace falta porque el teléfono es la identidad del cliente: el que llega por
 * WhatsApp se guarda con el `wa_id` de Meta —país incluido, sin `+`— y el que
 * reserva desde la página escribe su número local, "70123456". Sin prefijo, la
 * misma persona quedaría como dos clientes distintos y perdería su historial.
 *
 * Se deduce de la zona horaria y no de un campo propio porque el negocio ya
 * cargó su zona en la configuración inicial, y pedirle el país otra vez sería
 * pedir dos veces el mismo dato. Cuando haga falta —una cadena con locales en
 * dos países, un número que no es del país del negocio— el campo propio gana, y
 * este módulo pasa a ser sólo el valor por defecto del formulario.
 */

/**
 * Sólo América Latina: es donde Polaria opera. Una zona que no está acá cae al
 * valor por defecto, que es peor que acertar pero mejor que dejar al cliente
 * sin poder escribir su número.
 */
const DIAL_CODE_BY_TIME_ZONE: Record<string, string> = {
  'America/La_Paz': '591',
  'America/Argentina/Buenos_Aires': '54',
  'America/Argentina/Cordoba': '54',
  'America/Argentina/Mendoza': '54',
  'America/Argentina/Salta': '54',
  'America/Argentina/Tucuman': '54',
  'America/Montevideo': '598',
  'America/Asuncion': '595',
  'America/Santiago': '56',
  'America/Lima': '51',
  'America/Bogota': '57',
  'America/Guayaquil': '593',
  'America/Caracas': '58',
  'America/Sao_Paulo': '55',
  'America/Mexico_City': '52',
  'America/Monterrey': '52',
  'America/Guatemala': '502',
  'America/San_Salvador': '503',
  'America/Tegucigalpa': '504',
  'America/Managua': '505',
  'America/Costa_Rica': '506',
  'America/Panama': '507',
  'America/Santo_Domingo': '1',
};

/** Bolivia: es donde están los primeros negocios. */
export const DEFAULT_DIAL_CODE = '591';

export function dialCodeForTimeZone(timeZone?: string | null): string {
  if (!timeZone) return DEFAULT_DIAL_CODE;

  /*
   * Las zonas de Argentina son una familia entera —una por provincia— y todas
   * comparten prefijo. Se resuelve por prefijo de la zona para no listar las
   * veintitantas ni quedar corto cuando aparezca otra.
   */
  if (timeZone.startsWith('America/Argentina/')) return '54';

  return DIAL_CODE_BY_TIME_ZONE[timeZone] ?? DEFAULT_DIAL_CODE;
}
