import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsISO8601,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';

class BookingItemDto {
  @ApiProperty()
  @IsUUID()
  serviceId!: string;

  @ApiProperty({ description: 'Profesional de este servicio.' })
  @IsUUID()
  staffId!: string;
}

/**
 * Creación de una reserva desde el panel.
 *
 * Es el **mismo estado deseado** que recibe la edición: cuándo empieza y qué
 * servicios tiene, cada uno con su profesional. Crear y editar son la misma
 * operación con distinto punto de partida, y describirlas con dos formas
 * distintas era lo que hacía que sus reglas se separaran.
 *
 * No viaja `endTime`: se deriva de las duraciones vigentes de los servicios. Que
 * lo mandara el cliente obligaba a validar que coincidiera, o sea a mantener dos
 * versiones de la misma cuenta.
 *
 * Tampoco viaja el estado: lo decide el backend según la fecha. Registrar algo
 * que ya pasó nace atendido; lo de hoy en adelante, pendiente.
 */
export class CreateAppointmentDto {
  /** Sale del token. Se acepta en el DTO porque el controlador lo inyecta. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  tenantId!: string;

  @ApiProperty()
  @IsUUID()
  clientId!: string;

  @ApiProperty({
    example: '2026-08-24T13:00:00.000Z',
    description:
      'Inicio de la reserva, en ISO. El primer servicio arranca acá.',
  })
  @IsISO8601()
  startTime!: string;

  @ApiProperty({
    type: [BookingItemDto],
    description:
      'Servicios en orden de ejecución, cada uno con su profesional.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => BookingItemDto)
  items!: BookingItemDto[];
}
