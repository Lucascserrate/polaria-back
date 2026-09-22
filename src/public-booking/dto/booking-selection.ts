import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsOptional,
  IsUUID,
} from 'class-validator';

/**
 * Lo que la página elige antes de preguntar horarios: qué servicios y, si ya se
 * decidió, con quién cada uno.
 *
 * Vive en un archivo propio porque lo comparten las tres consultas del flujo
 * —días, horarios y la reserva— y las tres tienen que leer la selección igual.
 * Dos copias de este parseo serían dos formas de entender la misma URL.
 */

/**
 * Cuántos servicios entran en una misma reserva.
 *
 * El tope no es un límite de producto sino de lo que una consulta puede costar:
 * cada servicio agrega una consulta de profesionales y un tramo que revisar en
 * cada horario candidato. Cinco servicios encadenados son media jornada; más que
 * eso es alguien probando la URL, no alguien reservando.
 */
export const MAX_SERVICES_PER_BOOKING = 5;

/**
 * Parte una lista escrita en la URL como `a,b,c`.
 *
 * Se usa la coma y no un parámetro repetido porque la URL de la reserva la lee
 * gente —y se comparte por chat—, y `?servicios=a,b` se entiende de un vistazo.
 * El orden es el de ejecución y **no se reordena**: es el que el cliente vio en
 * el resumen.
 */
export const splitList = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;

  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
};

/** Los servicios de la reserva, en orden de atención. */
export function ServiceIdsParam(): PropertyDecorator {
  return applyAll(
    ApiProperty({
      description: 'Ids de servicio separados por coma, en orden de atención.',
      example: '5f0e…,7a21…',
    }),
    Transform(splitList),
    ArrayMinSize(1),
    ArrayMaxSize(MAX_SERVICES_PER_BOOKING),
    IsUUID(undefined, { each: true }),
  );
}

/**
 * Los profesionales, **uno por servicio y en el mismo orden**.
 *
 * Omitirlo es "sin preferencia", y entonces lo resuelve el servidor: uno solo
 * para toda la reserva, por menor carga de trabajo. Presente, tiene que tener
 * exactamente tantos ids como servicios —lo comprueba el servicio, que es el
 * único que ve las dos listas a la vez—, y repetir el mismo id en todas las
 * posiciones es como se pide "esta persona para todo".
 */
export function StaffIdsParam(): PropertyDecorator {
  return applyAll(
    ApiPropertyOptional({
      description:
        'Ids de profesional separados por coma, uno por servicio y en el mismo orden.',
    }),
    IsOptional(),
    Transform(splitList),
    ArrayMinSize(1),
    ArrayMaxSize(MAX_SERVICES_PER_BOOKING),
    IsUUID(undefined, { each: true }),
  );
}

const applyAll =
  (...decorators: PropertyDecorator[]): PropertyDecorator =>
  (target, key) => {
    for (const decorate of decorators) decorate(target, key);
  };
