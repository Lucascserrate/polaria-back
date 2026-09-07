/**
 * Dónde vive cada imagen dentro de la cuenta de Cloudinary.
 *
 * Está aparte del servicio porque es una convención, no una operación: es lo
 * que hace que la carpeta de un negocio se pueda listar, auditar y borrar
 * completa el día que se dé de baja, en lugar de tener imágenes sueltas en la
 * raíz sin forma de saber de quién eran.
 */
const ROOT_FOLDER = 'polaria';

/**
 * Separa desarrollo de producción dentro de la misma cuenta.
 *
 * No es un detalle de orden. Los identificadores son deterministas
 * (`.../logo`) y se suben con `overwrite`, así que sin este segmento el logo
 * que alguien prueba en su máquina reemplazaría el logo real del mismo negocio
 * en producción, sin error y sin aviso. Una cuenta de Cloudinary por entorno
 * sería más prolijo todavía, pero el plan gratuito da una sola.
 */
function environmentFolder(): string {
  return process.env.NODE_ENV === 'production' ? 'prod' : 'dev';
}

/** `polaria/dev/tenants/<tenantId>/<segmentos>` */
export function tenantAssetPath(
  tenantId: string,
  ...segments: string[]
): string {
  return [ROOT_FOLDER, environmentFolder(), 'tenants', tenantId, ...segments]
    .filter((segment) => segment.length > 0)
    .join('/');
}
