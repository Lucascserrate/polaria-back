import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class WorkingStaffQueryDto {
  @ApiPropertyOptional({
    example: '2026-08-09',
    description:
      'Fecha a consultar (YYYY-MM-DD) en la zona horaria del negocio. Por defecto, hoy.',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'date debe tener formato YYYY-MM-DD' })
  date?: string;
}
