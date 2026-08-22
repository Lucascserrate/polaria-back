import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

/**
 * Rango de días de la agenda, con los dos extremos incluidos.
 *
 * Acá solo se valida la forma. Que la fecha exista, que `to` no sea anterior a
 * `from` y el tope de días los resuelve el servicio, que es quien conoce la zona
 * horaria del negocio y el costo de la consulta.
 */
export class AppointmentsRangeQueryDto {
  @ApiProperty({ example: '2026-08-17', description: 'YYYY-MM-DD, inclusive' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'from debe tener formato YYYY-MM-DD',
  })
  from!: string;

  @ApiProperty({ example: '2026-08-23', description: 'YYYY-MM-DD, inclusive' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'to debe tener formato YYYY-MM-DD',
  })
  to!: string;
}
