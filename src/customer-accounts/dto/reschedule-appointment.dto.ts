import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601 } from 'class-validator';

/**
 * El nuevo horario de un turno que se está moviendo.
 *
 * Es lo único que viaja: qué turno se mueve lo dice la URL, de quién es lo dice
 * la sesión, y **qué servicios lleva no se manda**. Los servicios salen del
 * turno que ya existe, y eso es lo que separa "cambiar la hora" de "reservar de
 * nuevo": si el cliente pudiera mandar otros servicios, esto sería una reserva
 * disfrazada de edición y habría dos caminos para lo mismo.
 */
export class RescheduleAppointmentDto {
  @ApiProperty({ example: '2026-10-08T13:00:00.000Z' })
  @IsISO8601()
  startTime!: string;
}
