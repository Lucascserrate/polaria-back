import { BadRequestException } from '@nestjs/common';
import { memoryStorage } from 'multer';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

/**
 * Un logo, un avatar o la foto de un servicio no llegan ni cerca de esto: 5 MB
 * es la foto sin recortar que sale de un teléfono. El tope no está para ahorrar
 * espacio en Cloudinary sino para que una subida grande no ocupe memoria del
 * proceso ni lo deje esperando: el archivo entra completo en RAM antes de
 * reenviarse.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * `image/svg+xml` queda afuera a propósito. Un SVG es un documento que puede
 * traer `<script>`, y servido desde nuestro dominio se ejecutaría con sus
 * permisos. Los formatos de acá son datos, no código.
 */
export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const;

/** Lo único que se necesita de un archivo de multer para subirlo. */
export interface UploadedImageFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

/**
 * Opciones para el `FileInterceptor` de cualquier endpoint que reciba una imagen.
 *
 * `memoryStorage` y no disco: el archivo se reenvía a Cloudinary y no se
 * conserva, así que escribirlo antes solo agrega un temporal que hay que
 * borrar —también cuando la subida falla, que es justo cuando uno se olvida—.
 * Además el disco del contenedor es efímero: un archivo ahí no sobrevive al
 * próximo deploy, con lo cual no serviría ni como respaldo.
 */
export const IMAGE_UPLOAD_OPTIONS: MulterOptions = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
};

/**
 * Valida lo que llegó antes de gastar una llamada a Cloudinary.
 *
 * El `mimetype` lo declara el cliente y no se puede confiar en él, así que esto
 * no es una garantía de que el contenido sea una imagen: es el filtro que
 * devuelve un error entendible en el 99% de los casos —alguien arrastró un PDF—
 * en lugar del error de la API remota. La garantía real la da Cloudinary, que
 * rechaza lo que no puede decodificar como imagen.
 */
export function assertUploadedImage(
  file: UploadedImageFile | undefined,
): UploadedImageFile {
  if (!file) {
    throw new BadRequestException('No se recibió ningún archivo.');
  }

  if (
    !(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(file.mimetype)
  ) {
    throw new BadRequestException(
      `Formato no admitido (${file.mimetype}). Se aceptan JPG, PNG, WEBP y AVIF.`,
    );
  }

  if (file.size > MAX_IMAGE_BYTES) {
    throw new BadRequestException(
      `La imagen supera el máximo de ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB.`,
    );
  }

  if (file.size === 0) {
    throw new BadRequestException('El archivo está vacío.');
  }

  return file;
}
