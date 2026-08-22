import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsISO8601,
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
 * Edición de una reserva existente.
 *
 * Es el **estado deseado completo** de lo que se puede editar, no un parche: los
 * servicios que se manden son los que la reserva va a tener, con su profesional
 * y en ese orden. Un parche por campo obligaría a adivinar cómo se reacomodan
 * los horarios de los tramos que no vinieron.
 *
 * El cliente no viaja: cambiar de quién es la cita no es editarla. Tampoco el
 * estado, que se resuelve desde la agenda con sus propias acciones.
 */
export class EditBookingDto {
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
