/**
 * El identificador del negocio en la URL pública (`polariahq.com/royal-barber`).
 *
 * Es lo único que hace direccionable a un negocio desde afuera, así que tiene
 * que sobrevivir a lo que la gente escribe de verdad: acentos, `&`, emojis,
 * nombres repetidos entre dos locales de la misma cadena.
 *
 * Funciones puras: no tocan la base. Quién decide cuándo se asigna y qué hace
 * con las colisiones es `TenantsService`.
 */

/** Tope de la columna. Un slug largo no sirve para compartir por WhatsApp. */
export const MAX_SLUG_LENGTH = 60;

/**
 * Palabras que no pueden ser un slug de negocio porque ya son rutas del sitio.
 *
 * `polariahq.com/[businessSlug]` convive con la landing en el mismo dominio: si
 * un negocio se llamara "Privacy", su página taparía —o quedaría tapada por— la
 * política de privacidad. Next resuelve el estático antes que el dinámico, así
 * que el negocio sería inalcanzable sin ningún error visible.
 */
export const RESERVED_SLUGS = new Set([
  'api',
  'privacy',
  'terms',
  'app',
  'admin',
  'dashboard',
  'login',
  'signup',
  'sitemap',
  'robots',
  '_next',
  'static',
  'public',
  'polaria',
]);

/**
 * Convierte un nombre en un slug, o devuelve cadena vacía si no queda nada.
 *
 * Vacío es un resultado legítimo y no un error: un negocio llamado "刈り上げ" o
 * "★★★" no tiene forma ASCII, y quien llama decide con qué reemplazarlo. Devolver
 * un slug inventado acá escondería el caso.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
}

/**
 * El primer slug libre para un nombre, dados los que ya existen.
 *
 * Desempata con un sufijo numérico —`royal-barber-2`— y no con el id del tenant:
 * un uuid en la URL la vuelve incompartible, que es justamente lo contrario de
 * para qué existe el slug. La segunda sucursal de una cadena es el caso normal,
 * no la excepción.
 *
 * @param taken Slugs ya usados, en minúsculas. Incluir los reservados no hace
 * falta: se comprueban aparte.
 */
export function buildUniqueSlug(
  name: string,
  taken: Iterable<string>,
  fallback = 'negocio',
): string {
  const base = slugify(name) || fallback;
  const used = new Set(taken);

  const isFree = (candidate: string) =>
    !used.has(candidate) && !RESERVED_SLUGS.has(candidate);

  if (isFree(base)) return base;

  /*
   * Sin tope de intentos: el bucle termina siempre porque `used` es finito y
   * cada vuelta prueba un sufijo nuevo. Un tope sólo agregaría una rama de
   * error que nunca se alcanza.
   */
  for (let suffix = 2; ; suffix += 1) {
    const tail = `-${suffix}`;
    const candidate = `${base.slice(0, MAX_SLUG_LENGTH - tail.length).replace(/-+$/g, '')}${tail}`;
    if (isFree(candidate)) return candidate;
  }
}
