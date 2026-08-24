import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';

/**
 * Consulta de horarios para la creación manual desde el panel.
 *
 * El tenant no viaja acá: sale del token. Los horarios de un negocio revelan
 * cuándo está ocupado y cuándo no, así que no puede pedirlos cualquiera.
 */
export class BookingSlotsQueryDto {
  @ApiProperty({ example: '2026-08-19', description: 'YYYY-MM-DD' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date debe tener formato YYYY-MM-DD',
  })
  date!: string;

  @ApiProperty()
  @IsUUID()
  serviceId!: string;

  @ApiPropertyOptional({
    description:
      'Profesional. El panel siempre lo manda; omitirlo devuelve la unión del equipo.',
  })
  @IsOptional()
  @IsUUID()
  staffId?: string;

  @ApiPropertyOptional({
    description:
      'Cita que se está editando: sus minutos no cuentan como ocupados.',
  })
  @IsOptional()
  @IsUUID()
  excludeAppointmentId?: string;

  @ApiPropertyOptional({
    enum: ['client', 'panel'],
    description:
      'Quién pregunta. `panel` no aplica la anticipación mínima y, en fechas pasadas, no pone piso.',
  })
  @IsOptional()
  @IsIn(['client', 'panel'])
  scope?: 'client' | 'panel';
}
