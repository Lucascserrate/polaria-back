import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';
import { DATE_PATTERN, REPORT_PRESETS } from '../utils/report-range.util';
import type { ReportPreset } from '../utils/report-range.util';

export class ReportQueryDto {
  @ApiPropertyOptional({
    enum: REPORT_PRESETS,
    default: 'today',
    description: 'Período a reportar. Con "custom" se exigen "from" y "to".',
  })
  @IsOptional()
  @IsIn(REPORT_PRESETS)
  preset?: ReportPreset;

  @ApiPropertyOptional({
    example: '2026-01-01',
    description: 'Primer día del rango personalizado (YYYY-MM-DD), inclusive.',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'from debe tener formato YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-01-31',
    description: 'Último día del rango personalizado (YYYY-MM-DD), inclusive.',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'to debe tener formato YYYY-MM-DD' })
  to?: string;
}
