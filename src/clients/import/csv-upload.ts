import { BadRequestException } from '@nestjs/common';
import { memoryStorage } from 'multer';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

/**
 * Un CSV de contactos no pesa esto ni de lejos: cinco mil filas con nombre,
 * teléfono y email son unos 400 KB. El tope está para que un archivo equivocado
 * —un video, una base entera— no entre en memoria del proceso, porque multer lo
 * guarda completo en RAM antes de que nadie lo mire.
 */
export const MAX_CSV_BYTES = 2 * 1024 * 1024;

/** Lo único que se necesita de un archivo de multer para leerlo. */
export interface UploadedCsvFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

/**
 * Opciones del interceptor para los endpoints que reciben el CSV.
 *
 * `memoryStorage` porque el archivo se lee y se descarta: no hay nada que
 * conservar una vez que las fichas están en la base, y escribirlo a disco
 * dejaría la agenda de contactos de un negocio tirada en un contenedor efímero.
 *
 * El límite de multer es el doble del nuestro a propósito. Cuando multer corta
 * por tamaño devuelve "File too large" en inglés y sin contexto; dejándolo
 * pasar hasta acá, el mensaje que ve el negocio lo escribimos nosotros. Multer
 * queda de red de contención para lo absurdo.
 */
export const CSV_UPLOAD_OPTIONS: MulterOptions = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_CSV_BYTES * 2, files: 1 },
};

/**
 * Valida el archivo antes de gastar un parseo en él.
 *
 * Se mira la extensión y no el `mimetype`, que es lo que más sorprende de esto:
 * el navegador declara el tipo según lo que el sistema tenga asociado a `.csv`,
 * así que en una máquina con Excel instalado el mismo archivo llega como
 * `application/vnd.ms-excel`, y en otras como `text/plain` o vacío. Rechazar por
 * `mimetype` habría rechazado exactamente los archivos que este flujo existe
 * para recibir: los que salen de una computadora con Office.
 */
export function assertUploadedCsv(
  file: UploadedCsvFile | undefined,
): UploadedCsvFile {
  if (!file) {
    throw new BadRequestException('No se recibió ningún archivo.');
  }

  if (!file.originalname.toLowerCase().endsWith('.csv')) {
    throw new BadRequestException(
      'El archivo tiene que ser un CSV. En Google Contactos: Exportar → Google CSV.',
    );
  }

  if (file.size === 0) {
    throw new BadRequestException('El archivo está vacío.');
  }

  if (file.size > MAX_CSV_BYTES) {
    throw new BadRequestException(
      `El archivo supera el máximo de ${Math.round(MAX_CSV_BYTES / (1024 * 1024))} MB.`,
    );
  }

  return file;
}
