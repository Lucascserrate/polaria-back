/**
 * Lo que ve alguien que todavía no eligió un negocio: el listado del buscador.
 *
 * Es un contrato aparte del perfil (`PublicBusinessProfile`) y no un `Pick` de
 * él, por la misma razón que aquél no es un `Pick` del tenant: acá adentro no
 * puede colarse nada que el negocio no haya decidido publicar. Y además son dos
 * respuestas con presupuestos distintos —el perfil lo pide una página para un
 * negocio; esto lo pide una página para todos—, así que lo que no se dibuja en
 * una tarjeta no viaja: ni equipo, ni servicios, ni horarios, ni el estado de
 * apertura, que obligaría a recalcular la agenda de cada negocio para una
 * pantalla donde nadie reserva.
 */
export type PublicBusinessSummary = {
  /** A dónde lleva la tarjeta: `polariahq.com/[slug]`. */
  slug: string;
  name: string;
  /** Ver `BUSINESS_TYPES`. `null` mientras el negocio no lo cargó. */
  businessType: string | null;
  /** Lo que se lee debajo del nombre. `null` en los que no reciben en local. */
  address: string | null;
  /**
   * Dónde cae en el mapa, o `null`.
   *
   * `null` es normal y no excluye al negocio del listado: aparece en la lista
   * sin marcador. Sacarlo sería esconder un negocio que existe porque le falta
   * un dato que a la lista no le hace falta.
   */
  location: { latitude: number; longitude: number } | null;
  /**
   * La portada, que es la primera foto de la galería.
   *
   * Con sus medidas para que la tarjeta reserve el espacio antes de que la
   * imagen cargue: sin eso, una grilla de veinte tarjetas salta entera mientras
   * bajan las fotos.
   */
  coverPhoto: { url: string; width: number; height: number } | null;
  /**
   * El logo, que la tarjeta usa **sólo si no hay portada**.
   *
   * La mayoría de los negocios no subió fotos del local pero sí tiene logo, y
   * un logo centrado se lee mucho mejor que un cuadro con iniciales. Viaja
   * aparte de `coverPhoto` y no como un "usá esto" ya resuelto porque son dos
   * imágenes distintas y se dibujan distinto: la foto se recorta a sangre, el
   * logo se apoya centrado sobre el fondo.
   */
  logoUrl: string | null;
};

/**
 * Un objeto y no el arreglo pelado.
 *
 * Hoy adentro hay una sola clave. El día que haga falta paginar, filtrar por
 * zona o devolver cuántos quedaron afuera, esos campos se agregan sin que
 * ninguna versión ya desplegada del sitio deje de leer la respuesta.
 */
export type PublicBusinessDirectory = {
  businesses: PublicBusinessSummary[];
};
