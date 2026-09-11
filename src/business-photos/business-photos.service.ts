import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  BusinessPhoto,
  type BusinessPhotoKind,
} from './entities/business-photo.entity';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { tenantAssetPath } from '../cloudinary/asset-path';
import {
  assertUploadedImage,
  type UploadedImageFile,
} from '../cloudinary/image-upload';

/**
 * Cuántas fotos puede tener un negocio.
 *
 * No es un límite técnico: es lo que alguien mira. Una galería de treinta fotos
 * de la misma sala no ayuda a decidir si reservar, y en la página se cargan
 * todas. Diez deja lugar al local, a dos o tres trabajos y a la fachada, que es
 * lo que se busca antes de ir por primera vez.
 */
export const MAX_BUSINESS_PHOTOS = 10;

/**
 * Cuántos trabajos puede mostrar un negocio.
 *
 * Más alto que la galería del local porque responde otra pregunta: el local se
 * muestra con cuatro o cinco fotos y no cambia, y los trabajos se acumulan. Y
 * más bajo de lo que un negocio subiría si no hubiera tope, a propósito: treinta
 * obliga a elegir, y un portfolio elegido vende más que uno exhaustivo. También
 * es lo que mantiene acotado el almacenamiento, que se paga por cuenta.
 */
export const MAX_PORTFOLIO_PHOTOS = 30;

/** El tope que rige según para qué se sube la foto. */
export const maxPhotosOf = (kind: BusinessPhotoKind): number =>
  kind === 'portfolio' ? MAX_PORTFOLIO_PHOTOS : MAX_BUSINESS_PHOTOS;

/**
 * La carpeta de Cloudinary de cada uso.
 *
 * Separadas para que se puedan auditar y borrar por su cuenta, y porque el día
 * que el portfolio necesite otra transformación —recortes verticales, digamos—
 * no haya que distinguir archivos dentro de la misma carpeta.
 */
const folderOf = (kind: BusinessPhotoKind): string =>
  kind === 'portfolio' ? 'portfolio' : 'photos';

/** Lo que viaja al panel y a la página pública. */
export interface BusinessPhotoView {
  id: string;
  url: string;
  width: number;
  height: number;
}

/**
 * La galería tal como la recibe el panel.
 *
 * El máximo viaja con las fotos en lugar de estar escrito en el navegador, por
 * lo mismo que el largo del mensaje de bienvenida: una segunda copia del límite
 * se desactualizaría sola, y el panel terminaría deshabilitando el botón en un
 * número que el backend ya no aplica —o dejándolo activo para una subida que va
 * a fallar—.
 *
 * La página pública no lo recibe: ahí el límite no significa nada, y por eso
 * `list` sigue devolviendo el arreglo pelado.
 */
export interface BusinessGalleryResponse {
  photos: BusinessPhotoView[];
  maxPhotos: number;
}

const toView = (photo: BusinessPhoto): BusinessPhotoView => ({
  id: photo.id,
  url: photo.url,
  width: photo.width,
  height: photo.height,
});

@Injectable()
export class BusinessPhotosService {
  private readonly logger = new Logger(BusinessPhotosService.name);

  constructor(
    @InjectRepository(BusinessPhoto)
    private readonly photosRepository: Repository<BusinessPhoto>,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  /**
   * La galería con el límite, que es lo que el panel necesita para dibujar.
   *
   * Envuelve a `list` en lugar de reemplazarla: la página pública sigue
   * pidiendo el arreglo pelado, y así hay un solo lugar donde se decide el
   * orden de las fotos.
   */
  async gallery(
    tenantId: string,
    kind: BusinessPhotoKind,
  ): Promise<BusinessGalleryResponse> {
    return {
      photos: await this.list(tenantId, kind),
      maxPhotos: maxPhotosOf(kind),
    };
  }

  /**
   * Las fotos de un uso, en orden. En la galería, la primera es la portada.
   *
   * `kind` no tiene valor por omisión a propósito: es lo único que separa las
   * fotos del local de las de trabajos, y un llamador que se lo olvidara
   * mezclaría las dos colecciones sin que nada fallara.
   */
  async list(
    tenantId: string,
    kind: BusinessPhotoKind,
  ): Promise<BusinessPhotoView[]> {
    const photos = await this.photosRepository.find({
      where: { tenantId, kind },
      order: { position: 'ASC' },
    });

    return photos.map(toView);
  }

  /**
   * La portada de varios negocios de una vez, para el buscador.
   *
   * Pide `position: 0` en lugar de traer las galerías y quedarse con la primera
   * de cada una: es una fila por negocio en vez de hasta diez, y el buscador
   * dibuja una sola foto por tarjeta. Que la posición 0 exista siempre que haya
   * fotos lo sostiene `reindex`, que renumera después de cada borrado —sin eso,
   * borrar la portada dejaría al negocio empezando en 1 y sin imagen acá—.
   *
   * Un `Map` y no un arreglo porque quien llama ya tiene su lista de negocios en
   * orden y sólo necesita cruzar; los que no subieron fotos simplemente no
   * están, que es el caso mayoritario.
   */
  async covers(tenantIds: string[]): Promise<Map<string, BusinessPhotoView>> {
    if (tenantIds.length === 0) return new Map();

    const photos = await this.photosRepository.find({
      // Acotado a la galería: la miniatura del buscador es el local, no un corte.
      where: { tenantId: In(tenantIds), kind: 'gallery', position: 0 },
    });

    return new Map(photos.map((photo) => [photo.tenantId, toView(photo)]));
  }

  /**
   * Agrega fotos al final de la galería.
   *
   * Sube y guarda **de a una**, en orden, y no en paralelo: si la tercera falla,
   * las dos primeras ya están guardadas y el negocio las ve al recargar. La
   * alternativa —subir todo y guardar al final— convertiría un fallo en el
   * último archivo en la pérdida de los anteriores, que es peor para quien está
   * cargando cinco fotos desde el teléfono.
   *
   * Por eso mismo no hay transacción: la parte que no se puede revertir es la
   * subida a Cloudinary, así que envolver los `INSERT` daría la ilusión de
   * atomicidad mientras los archivos quedan igual.
   */
  async addMany(
    tenantId: string,
    kind: BusinessPhotoKind,
    files: UploadedImageFile[] | undefined,
  ): Promise<BusinessGalleryResponse> {
    if (!files?.length) {
      throw new BadRequestException('No se recibió ninguna imagen.');
    }

    const maxPhotos = maxPhotosOf(kind);

    const existing = await this.photosRepository.count({
      where: { tenantId, kind },
    });

    const remaining = maxPhotos - existing;

    /*
     * Se rechaza el lote completo en lugar de guardar las que entran y descartar
     * el resto en silencio: quien eligió seis fotos tiene que poder saber cuáles
     * quedaron afuera, y la única respuesta honesta es que decida él.
     */
    if (files.length > remaining) {
      throw new BadRequestException(
        remaining === 0
          ? `Ya tenés el máximo de ${maxPhotos} fotos. Borrá alguna para subir otra.`
          : `Podés subir ${remaining} foto${remaining === 1 ? '' : 's'} más: el máximo es ${maxPhotos}.`,
      );
    }

    /*
     * Se valida el lote completo antes de subir nada. Es la diferencia entre
     * "elegiste un PDF entre las seis fotos, corregilo" y haber subido tres
     * fotos, cobrado el tiempo de espera y fallado en la cuarta.
     */
    files.forEach((file) => assertUploadedImage(file));

    let position = existing;

    for (const file of files) {
      const image = await this.cloudinaryService.uploadImage(file, {
        folder: tenantAssetPath(tenantId, folderOf(kind)),

        /**
         * 1600px de lado alcanza para la foto grande de la galería en una
         * pantalla grande y con densidad doble. `limit` no agranda lo que ya
         * entra, así que una foto chica no se estira.
         */
        transformation: [{ width: 1600, height: 1600, crop: 'limit' }],
      });

      await this.photosRepository.save(
        this.photosRepository.create({
          tenantId,
          kind,
          url: image.url,
          publicId: image.publicId,
          width: image.width,
          height: image.height,
          position,
        }),
      );

      position += 1;
    }

    this.logger.log(
      `Fotos agregadas tenantId=${tenantId} kind=${kind} cantidad=${files.length} total=${position}`,
    );

    return this.gallery(tenantId, kind);
  }

  /**
   * Borra una foto: el archivo y la fila.
   *
   * Primero el archivo remoto. Si eso falla, la fila sigue apuntando a una
   * imagen que existe y se puede reintentar; en el otro orden el archivo
   * quedaría sin nadie que lo mencione, ocupando cuota para siempre.
   */
  async remove(
    tenantId: string,
    kind: BusinessPhotoKind,
    photoId: string,
  ): Promise<BusinessGalleryResponse> {
    const photo = await this.photosRepository.findOne({
      where: { id: photoId, tenantId, kind },
    });

    /*
     * Filtrado por `tenantId` y no solo por `id`: sin eso, el id de una foto de
     * otro negocio alcanzaría para borrarla.
     *
     * Y por `kind`, para que cada endpoint sólo alcance su propia colección: el
     * del portfolio no puede borrar una foto del local aunque le pasen su id.
     */
    if (!photo) {
      throw new NotFoundException('La foto no existe.');
    }

    await this.cloudinaryService.deleteImage(photo.publicId);
    await this.photosRepository.delete({ id: photo.id });
    await this.reindex(tenantId, kind);

    this.logger.log(
      `Foto borrada tenantId=${tenantId} kind=${kind} photoId=${photoId}`,
    );

    return this.gallery(tenantId, kind);
  }

  /**
   * Pone una foto como portada, es decir, primera.
   *
   * Es lo mínimo para elegir qué se ve grande en la página sin arrastrar y
   * soltar, que en un teléfono es la interacción más difícil de acertar. El
   * resto conserva su orden relativo: mover una foto al frente no reordena las
   * demás entre sí.
   */
  async setCover(
    tenantId: string,
    photoId: string,
  ): Promise<BusinessGalleryResponse> {
    /*
     * Solo la galería tiene portada. El portfolio no: ahí no hay una foto que
     * represente al resto, son treinta trabajos y ninguno es "el principal".
     */
    const photos = await this.photosRepository.find({
      where: { tenantId, kind: 'gallery' },
      order: { position: 'ASC' },
    });

    const cover = photos.find((photo) => photo.id === photoId);
    if (!cover) {
      throw new NotFoundException('La foto no existe.');
    }

    const ordered = [cover, ...photos.filter((photo) => photo.id !== photoId)];

    await this.photosRepository.manager.transaction(async (manager) => {
      for (const [index, photo] of ordered.entries()) {
        await manager.update(
          BusinessPhoto,
          { id: photo.id },
          { position: index },
        );
      }
    });

    this.logger.log(`Portada cambiada tenantId=${tenantId} photoId=${photoId}`);

    return this.gallery(tenantId, 'gallery');
  }

  /**
   * Vuelve a numerar las posiciones de 0 en adelante, conservando el orden.
   *
   * Hace falta después de borrar: sin esto las posiciones quedan con huecos
   * —0, 2, 3— y agregar una foto nueva al final calculando por cantidad
   * generaría una posición repetida, con lo cual el orden de la galería pasaría
   * a depender de cómo MySQL desempata. La portada dejaría de ser estable.
   */
  private async reindex(
    tenantId: string,
    kind: BusinessPhotoKind,
  ): Promise<void> {
    const photos = await this.photosRepository.find({
      // Por uso: renumerar las dos colecciones juntas les daría posiciones
      // entremezcladas y la galería se quedaría sin su `position: 0`.
      where: { tenantId, kind },
      order: { position: 'ASC' },
      select: { id: true },
    });

    // De a una, por lo mismo que en `setCover`.
    await this.photosRepository.manager.transaction(async (manager) => {
      for (const [index, photo] of photos.entries()) {
        await manager.update(
          BusinessPhoto,
          { id: photo.id },
          { position: index },
        );
      }
    });
  }
}
