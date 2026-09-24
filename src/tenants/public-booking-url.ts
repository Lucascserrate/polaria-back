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

/**
 * El enlace que lleva directo a elegir servicio, no a la ficha del negocio.
 *
 * Es a donde manda "Agendar cita" cuando el negocio eligió el enlace: quien
 * tocó ese botón ya decidió, y dejarlo en la portada le cobra un toque más para
 * volver a decir lo mismo. La ficha sigue siendo el enlace que el negocio
 * comparte, porque ahí sí se viene a mirar antes de elegir.
 */
export function buildBookingFlowUrl(
  slug: string | null | undefined,
  baseUrl?: string | null,
): string | null {
  const page = buildPublicBookingUrl(slug, baseUrl);
  return page && `${page}/reservar`;
}

/**
 * El enlace que adopta los turnos de un cliente y lo lleva a verlos.
 *
 * No depende del negocio: los turnos son de una persona y la pantalla es la de
 * su cuenta, así que esta dirección es del sitio y no de un local. El token va
 * en la URL porque es lo único que puede viajar en un mensaje de WhatsApp, y no
 * da acceso a nada por su cuenta. Ver `signForLink`.
 */
export function buildClaimUrl(token: string, baseUrl?: string | null): string {
  const base = (baseUrl || DEFAULT_PUBLIC_SITE_BASE_URL).replace(/\/+$/, '');
  return `${base}/historial/abrir?t=${encodeURIComponent(token)}`;
}
