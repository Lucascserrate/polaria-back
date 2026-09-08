import { Injectable } from '@nestjs/common';

import { BusinessPhotosService } from '../business-photos/business-photos.service';
import type { BusinessPhotoView } from '../business-photos/business-photos.service';
import { ServicesService } from '../services/services.service';
import { TenantsService } from '../tenants/tenants.service';
import type { Tenant } from '../tenants/entities/tenant.entity';
import type {
  PublicBusinessDirectory,
  PublicBusinessSummary,
} from './public-directory.types';

/**
 * Tope de negocios por respuesta.
 *
 * No es una página: es un techo. Hoy el buscador no pagina porque no hay con
 * qué llenar dos pantallas, y devolver todo de una vez es lo que hace que el
 * mapa muestre a todos a la vez. El tope existe para que el día que sean
 * quinientos la respuesta no crezca sin que nadie lo decida: cuando este número
 * empiece a recortar de verdad, lo que hay que agregar es paginación y no un
 * número más grande.
 */
const DIRECTORY_LIMIT = 200;

/**
 * El directorio: qué negocios existen, para el buscador del marketplace.
 *
 * Vive aparte de `PublicBookingService` porque responde otra pregunta. Aquél
 * contesta "qué ofrece este negocio y cuándo puede atenderme", siempre bajo un
 * slug que el visitante ya tenía. Éste contesta "qué negocios hay", que es la
 * primera vez que la API dice algo sin que le pregunten por uno en particular.
 * Por eso el criterio de quién entra está escrito acá y en un solo lugar: es la
 * decisión de publicar un negocio, y no puede quedar repartida entre una
 * consulta y una pantalla.
 *
 * Como el módulo de reservas, no tiene repositorios propios: los tenants los
 * lista `TenantsService`, las portadas las da `BusinessPhotosService` y quién
 * tiene servicios activos lo sabe `ServicesService`. Si acá apareciera un
 * `forFeature`, sería una segunda versión de algo que ya existe.
 */
@Injectable()
export class PublicDirectoryService {
  constructor(
    private readonly tenantsService: TenantsService,
    private readonly servicesService: ServicesService,
    private readonly businessPhotosService: BusinessPhotosService,
  ) {}

  /**
   * Los negocios publicados.
   *
   * Publicado es tres cosas, y las tres son "la tarjeta lleva a algún lado":
   * tiene slug —sin él no hay página adónde ir—, la cuenta está activa, y
   * ofrece al menos un servicio. El tercero es el que más recorta, y es el que
   * importa: un negocio a medio configurar tiene página, pero es una página sin
   * nada para reservar, y mandarle gente desde el buscador es peor que no
   * listarlo.
   *
   * Lo que **no** filtra es la falta de fotos, de dirección o de coordenadas.
   * Ésos son los datos que casi nadie completó todavía, y esconder por eso a un
   * negocio que sí atiende sería vaciar el buscador para que se vea prolijo.
   */
  async list(): Promise<PublicBusinessDirectory> {
    const listable = await this.tenantsService.listPublic(DIRECTORY_LIMIT);

    const withServices = await this.servicesService.tenantIdsWithActiveServices(
      listable.map((tenant) => tenant.id),
    );

    const published = listable.filter((tenant) => withServices.has(tenant.id));

    const covers = await this.businessPhotosService.covers(
      published.map((tenant) => tenant.id),
    );

    return {
      businesses: published
        .map((tenant) => toSummary(tenant, toCover(covers.get(tenant.id))))
        .sort(byShowable),
    };
  }
}

/**
 * Primero los que tienen algo para mostrar, después por nombre.
 *
 * No es un ranking ni una promoción: es que una grilla que abre con cuatro
 * cuadros de iniciales se lee como un sitio vacío aunque haya veinte negocios
 * abajo. Un negocio sin foto ni logo no queda escondido —está en la misma
 * lista, unas filas más abajo— y sale de este grupo en cuanto sube una imagen.
 *
 * Es provisional a propósito: el día que el buscador ordene por cercanía o por
 * disponibilidad, este criterio se reemplaza entero.
 */
const byShowable = (a: PublicBusinessSummary, b: PublicBusinessSummary) => {
  const showable = (business: PublicBusinessSummary) =>
    business.coverPhoto || business.logoUrl ? 0 : 1;

  return (
    showable(a) - showable(b) ||
    a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
  );
};

/**
 * La portada, recortada a lo que dibuja una tarjeta.
 *
 * El `id` de la foto no viaja: sirve para editarla desde el panel, y en el
 * listado no hay nada que hacer con él. Es la misma regla que el resto del
 * archivo —se publica lo que se usa— aplicada a un campo inofensivo, porque la
 * regla vale por costumbre y no por caso.
 */
const toCover = (
  photo: BusinessPhotoView | undefined,
): PublicBusinessSummary['coverPhoto'] =>
  photo ? { url: photo.url, width: photo.width, height: photo.height } : null;

const toSummary = (
  tenant: Tenant,
  coverPhoto: PublicBusinessSummary['coverPhoto'],
): PublicBusinessSummary => ({
  // `listPublic` ya descartó los que no tienen slug; el `as` es por el tipo
  // nulable de la columna, no por una duda sobre el dato.
  slug: tenant.slug as string,
  name: tenant.name,
  businessType: tenant.businessType ?? null,
  address: tenant.address,
  location:
    typeof tenant.latitude === 'number' && typeof tenant.longitude === 'number'
      ? { latitude: tenant.latitude, longitude: tenant.longitude }
      : null,
  coverPhoto,
  logoUrl: tenant.logoUrl,
});
