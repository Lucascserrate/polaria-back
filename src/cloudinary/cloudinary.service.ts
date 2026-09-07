import { Inject, Injectable, Logger } from '@nestjs/common';
import type { UploadApiOptions, UploadApiResponse } from 'cloudinary';
import { CLOUDINARY, type CloudinaryClient } from './cloudinary.provider';
import { assertUploadedImage, type UploadedImageFile } from './image-upload';

/**
 * Lo que hay que guardar en la base después de subir.
 *
 * `url` es lo que se muestra y `publicId` lo que permite borrar o reemplazar
 * después. Guardar las dos cosas es redundante solo en apariencia: la URL
 * incluye la versión (`/v1712.../`), que es lo que hace que al reemplazar una
 * imagen el navegador y el CDN vean una dirección nueva en lugar de servir la
 * anterior desde caché. Esa versión no se puede derivar del `publicId`.
 */
export interface UploadedImage {
  url: string;
  publicId: string;
  width: number;
  height: number;
  bytes: number;
  format: string;
}

export interface UploadImageOptions {
  /**
   * Identificador completo, carpeta incluida (ver `tenantAssetPath`). Para
   * imágenes que son una sola por dueño —el logo de un negocio, el avatar de
   * un profesional—: el identificador se puede reconstruir siempre, y volver a
   * subir reemplaza en lugar de acumular una copia huérfana por cada cambio.
   */
  publicId?: string;

  /**
   * Carpeta, dejando que Cloudinary invente el identificador. Para las que son
   * varias por dueño —las fotos de un servicio—, donde un identificador fijo
   * haría que la segunda foto borrara la primera.
   */
  folder?: string;

  /** Reemplaza el recorte por defecto. Ver `DEFAULT_TRANSFORMATION`. */
  transformation?: UploadApiOptions['transformation'];
}

/**
 * Techo de tamaño de lo que se guarda, no de lo que se muestra.
 *
 * `limit` reduce si excede y no toca lo que ya entra, así que no agranda ni
 * deforma nada. Existe porque el original de una cámara moderna son 6000px de
 * ancho que ninguna pantalla usa: guardarlos hace que cada transformación
 * posterior parta de una imagen enorme, y el ancho real se pide igual en la
 * URL de entrega.
 */
const DEFAULT_TRANSFORMATION: UploadApiOptions['transformation'] = [
  { width: 2000, height: 2000, crop: 'limit' },
];

/**
 * El SDK declara `any` el retorno de `destroy` y de
 * `delete_resources_by_prefix`, así que estas formas son lo que hace falta para
 * leerlos sin que el tipado se apague justo en el borde de la librería. Solo
 * los campos que se usan.
 */
interface DestroyResponse {
  result: string;
}

interface DeleteByPrefixResponse {
  deleted?: Record<string, string>;
  next_cursor?: string;
}

/**
 * El callback del SDK entrega un `UploadApiErrorResponse`, que no es un
 * `Error`: rechazar con eso deja un `catch` sin stack y sin nada que loguear.
 */
function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  const message = (error as { message?: unknown } | null)?.message;

  return new Error(
    typeof message === 'string' ? message : 'Cloudinary rechazó la subida.',
  );
}

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor(
    @Inject(CLOUDINARY) private readonly cloudinary: CloudinaryClient,
  ) {}

  /**
   * Sube una imagen y devuelve lo que hay que persistir.
   *
   * Quien llama decide **dónde** va (`publicId` o `folder`, ver
   * `tenantAssetPath`); este servicio no sabe qué es un logo ni un avatar. Es a
   * propósito: el día que se suba la foto de un servicio no hay que tocar nada
   * de acá.
   */
  async uploadImage(
    file: UploadedImageFile | undefined,
    options: UploadImageOptions,
  ): Promise<UploadedImage> {
    const image = assertUploadedImage(file);

    const response = await this.uploadBuffer(image.buffer, {
      public_id: options.publicId,
      folder: options.folder,

      /**
       * Explícito y no `auto`: con `auto`, Cloudinary acepta un PDF o un video
       * y lo guarda como lo que sea. Declarando `image` es la propia API la
       * que rechaza lo que no puede decodificar como imagen, que es la única
       * verificación real del contenido —el `mimetype` que valida
       * `assertUploadedImage` lo declara el cliente—.
       */
      resource_type: 'image',

      /**
       * Con `publicId` determinista, subir de nuevo es reemplazar: sin
       * `overwrite` la API responde el recurso viejo y el cambio se pierde en
       * silencio. `invalidate` purga la copia del CDN, necesario porque la
       * dirección sin versión (`.../logo.jpg`) sigue siendo la misma.
       */
      overwrite: true,
      invalidate: true,

      transformation: options.transformation ?? DEFAULT_TRANSFORMATION,
    });

    this.logger.log(
      `Imagen subida publicId=${response.public_id} bytes=${response.bytes} originalName=${image.originalname}`,
    );

    return {
      url: response.secure_url,
      publicId: response.public_id,
      width: response.width,
      height: response.height,
      bytes: response.bytes,
      format: response.format,
    };
  }

  /**
   * Borra una imagen. No falla si ya no está.
   *
   * Se llama al reemplazar o al dar de baja al dueño de la imagen, y en los dos
   * casos lo que importa es el estado final. Que la imagen ya no exista es
   * exactamente lo que se venía a conseguir: convertirlo en excepción haría
   * fallar el borrado de un profesional por una imagen que alguien ya limpió a
   * mano desde el panel de Cloudinary.
   */
  async deleteImage(publicId: string): Promise<void> {
    const response = (await this.cloudinary.uploader.destroy(publicId, {
      resource_type: 'image',
      invalidate: true,
    })) as DestroyResponse;

    if (response.result !== 'ok' && response.result !== 'not found') {
      this.logger.warn(
        `Cloudinary no borró publicId=${publicId} result=${response.result}`,
      );
      return;
    }

    this.logger.log(
      `Imagen borrada publicId=${publicId} result=${response.result}`,
    );
  }

  /**
   * Borra todo lo que hay bajo un prefijo (ver `tenantAssetPath`).
   *
   * Es la contraparte de tener carpeta por negocio: sin esto, dar de baja un
   * negocio con veinte servicios con foto obligaría a recorrer la base
   * juntando identificadores, y lo que no esté en la base —una subida que
   * falló a mitad de camino— quedaría pagándose para siempre.
   *
   * Cloudinary borra hasta 1000 recursos por llamada; el bucle es para las
   * carpetas que pasen de eso.
   */
  async deleteFolder(prefix: string): Promise<void> {
    let nextCursor: string | undefined;
    let deleted = 0;

    do {
      const response = (await this.cloudinary.api.delete_resources_by_prefix(
        prefix,
        { resource_type: 'image', invalidate: true, next_cursor: nextCursor },
      )) as DeleteByPrefixResponse;

      deleted += Object.keys(response.deleted ?? {}).length;
      nextCursor = response.next_cursor;
    } while (nextCursor);

    this.logger.log(`Carpeta borrada prefix=${prefix} recursos=${deleted}`);
  }

  /**
   * El SDK sube desde un buffer solo por stream y con callback; esto es lo
   * único que hace falta para poder usarlo con `await`.
   */
  private uploadBuffer(
    buffer: Buffer,
    options: UploadApiOptions,
  ): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const stream = this.cloudinary.uploader.upload_stream(
        options,
        (error, result) => {
          if (error) {
            reject(toError(error));
            return;
          }

          if (!result) {
            reject(new Error('Cloudinary no devolvió resultado de la subida.'));
            return;
          }

          resolve(result);
        },
      );

      stream.end(buffer);
    });
  }
}
