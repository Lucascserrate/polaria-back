import type { ValidationPipeOptions } from '@nestjs/common';

/**
 * Cómo se valida todo lo que entra por HTTP.
 *
 * Vive acá, y no dentro de `main.ts`, para que los tests puedan validar un DTO
 * exactamente como lo hace la app. Con `forbidNonWhitelisted`, un campo que el
 * DTO no declara no se ignora: devuelve 400. Es lo que se quiere —el cliente se
 * entera de que mandó algo que no existe— pero significa que sacarle una
 * propiedad a un DTO rompe a quien la enviaba, aunque nadie toque esa ruta.
 */
export const VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = {
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
};
