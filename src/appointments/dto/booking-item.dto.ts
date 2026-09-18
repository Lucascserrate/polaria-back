import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * Un servicio dentro de una reserva.
 *
 * Es el mismo en crear y en editar porque crear y editar reciben el mismo estado
 * deseado; tenerlo escrito dos veces era lo que dejaba que un campo nuevo llegara
 * sólo a una de las dos.
 *
 * El precio no entra acá: lo que se cobra en una cita se escribe por
 * `PATCH :id/prices`, que no reacomoda nada. Ver `set-segment-prices.dto.ts`.
 */
export class BookingItemDto {
  @ApiProperty()
  @IsUUID()
  serviceId!: string;

  @ApiProperty({ description: 'Profesional de este servicio.' })
  @IsUUID()
  staffId!: string;
}
