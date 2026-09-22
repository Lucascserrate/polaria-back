import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';
import { ServiceIdsParam, StaffIdsParam } from './booking-selection';

/**
 * Horarios de una reserva para una fecha.
 *
 * El negocio no viaja acá: sale del slug de la ruta. Y no hay `scope`: desde
 * afuera siempre se pregunta como cliente, con la anticipación mínima puesta.
 * Que la regla no sea expresable desde el request es lo que la hace una regla.
 *
 * La reserva puede llevar varios servicios, y entonces el horario que se
 * devuelve es el del **bloque entero**: la suma de las duraciones, encadenadas.
 */
export class PublicSlotsQueryDto {
  @ApiProperty({ example: '2026-08-29', description: 'YYYY-MM-DD' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date debe tener formato YYYY-MM-DD',
  })
  date!: string;

  @ServiceIdsParam()
  serviceIds!: string[];

  @StaffIdsParam()
  staffIds?: string[];
}
