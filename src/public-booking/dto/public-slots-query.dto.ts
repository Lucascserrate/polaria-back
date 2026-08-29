import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, Matches } from 'class-validator';

/**
 * Horarios de un servicio para una fecha.
 *
 * El negocio no viaja acá: sale del slug de la ruta. Y no hay `scope`: desde
 * afuera siempre se pregunta como cliente, con la anticipación mínima puesta.
 * Que la regla no sea expresable desde el request es lo que la hace una regla.
 */
export class PublicSlotsQueryDto {
  @ApiProperty({ example: '2026-08-29', description: 'YYYY-MM-DD' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date debe tener formato YYYY-MM-DD',
  })
  date!: string;

  @ApiProperty()
  @IsUUID()
  serviceId!: string;

  @ApiPropertyOptional({
    description: 'Profesional elegido. Omitirlo es "sin preferencia".',
  })
  @IsOptional()
  @IsUUID()
  staffId?: string;
}
