import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

/**
 * Rango de días de la agenda, con los dos extremos incluidos.
 *
 * Misma forma que `AppointmentsRangeQueryDto` porque la agenda pide las dos
 * cosas para el mismo rango: si los formatos difirieran, el día en que una de
 * las dos consultas cambie de criterio la grilla mostraría citas de una semana
 * y bloqueos de otra.
 */
export class ScheduleBlocksRangeQueryDto {
  @ApiProperty({ example: '2026-09-07', description: 'YYYY-MM-DD, inclusive' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'from debe tener formato YYYY-MM-DD',
  })
  from!: string;

  @ApiProperty({ example: '2026-09-13', description: 'YYYY-MM-DD, inclusive' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'to debe tener formato YYYY-MM-DD',
  })
  to!: string;
}
