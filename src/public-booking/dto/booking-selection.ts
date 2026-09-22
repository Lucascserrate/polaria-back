import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsOptional,
  IsUUID,
  Matches,
} from 'class-validator';

/**
 * "Cualquier profesional", en una posición de `staffIds`.
 *
 * Existe porque repartir una reserva no obliga a elegir a alguien para cada
 * servicio: quien quiere el corte con Jose puede no tener preferencia para la
 * barba. Sin este valor, esa posición tendría que viajar vacía, y una lista con
 * huecos es indistinguible de una lista a medio llenar.
 *
 * Es la misma palabra que usa la URL del sitio, y a propósito: ese parámetro se
 * lee en la barra de direcciones de un cliente.
 */
export const ANY_STAFF = 'cualquiera';

/** Una posición de `staffIds`: un id, o `cualquiera`. */
const STAFF_ID_OR_ANY =
  /^(cualquiera|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

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
 * Cada posición es un id o `cualquiera`. Tiene que traer exactamente tantas
 * entradas como servicios —lo comprueba el servicio, que es el único que ve las
 * dos listas a la vez— y repetir el mismo id en todas es como se pide "esta
 * persona para todo".
 *
 * **Omitirlo no es lo mismo que llenarlo de `cualquiera`**, y la diferencia es
 * la que separa los dos modos de la pantalla:
 *
 * - Ausente: "cualquier profesional" para toda la reserva. El servidor resuelve
 *   **una sola persona** que pueda con todo, por menor carga de trabajo.
 * - `cualquiera,cualquiera`: el cliente pidió repartirla y no tiene preferencia
 *   en ninguno de los dos. Cada tramo se resuelve por su cuenta, y pueden
 *   tocarle dos personas distintas.
 */
export function StaffIdsParam(): PropertyDecorator {
  return applyAll(
    ApiPropertyOptional({
      description:
        'Ids de profesional (o "cualquiera") separados por coma, uno por servicio y en el mismo orden.',
    }),
    IsOptional(),
    Transform(splitList),
    ArrayMinSize(1),
    ArrayMaxSize(MAX_SERVICES_PER_BOOKING),
    Matches(STAFF_ID_OR_ANY, {
      each: true,
      message: 'staffIds debe traer un id de profesional o "cualquiera"',
    }),
  );
}

const applyAll =
  (...decorators: PropertyDecorator[]): PropertyDecorator =>
  (target, key) => {
    for (const decorate of decorators) decorate(target, key);
  };
