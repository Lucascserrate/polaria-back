/**
 * Dónde vive la página pública de un negocio.
 *
 * El enlace se arma en el servidor y no en cada pantalla porque hay más de un
 * consumidor —el panel lo muestra para copiar, y el asistente va a querer
 * mandarlo por WhatsApp— y dos versiones del mismo enlace es una que apunta al
 * dominio viejo el día que cambie.
 */

/** Dominio público por defecto. `PUBLIC_SITE_BASE_URL` lo reemplaza. */
export const DEFAULT_PUBLIC_SITE_BASE_URL = 'https://polariahq.com';

export function buildPublicBookingUrl(
  slug: string | null | undefined,
  baseUrl?: string | null,
): string | null {
  // Sin slug no hay página: el negocio todavía no guardó su nombre.
  if (!slug) return null;

  const base = (baseUrl || DEFAULT_PUBLIC_SITE_BASE_URL).replace(/\/+$/, '');
  return `${base}/${slug}`;
}
