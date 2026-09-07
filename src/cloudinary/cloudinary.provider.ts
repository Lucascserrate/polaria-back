import { Logger, Provider } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';

/**
 * Token de inyección del SDK ya configurado.
 *
 * El SDK de Cloudinary guarda las credenciales en un singleton global
 * (`cloudinary.config()`), así que en rigor cualquier archivo que lo importe
 * queda configurado por efecto de borde. Aun así se inyecta: es lo que hace que
 * Nest construya esto **al arrancar** y no en la primera subida. La diferencia
 * es dónde se entera uno de que falta una variable —en el log de bootstrap, o
 * seis meses después en el error de un negocio subiendo su logo—.
 */
export const CLOUDINARY = 'CLOUDINARY';

export type CloudinaryClient = typeof cloudinary;

const logger = new Logger('Cloudinary');

export const cloudinaryProvider: Provider = {
  provide: CLOUDINARY,
  useFactory: (): CloudinaryClient => {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    const missing = [
      ['CLOUDINARY_CLOUD_NAME', cloudName],
      ['CLOUDINARY_API_KEY', apiKey],
      ['CLOUDINARY_API_SECRET', apiSecret],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missing.length > 0) {
      throw new Error(
        `Cloudinary sin configurar: falta ${missing.join(', ')} en el entorno.`,
      );
    }

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });

    logger.log(`Cloudinary configurado. cloudName=${cloudName}`);

    return cloudinary;
  },
};
