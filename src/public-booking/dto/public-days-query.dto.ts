import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ServiceIdsParam, StaffIdsParam } from './booking-selection';

/**
 * Qué días de acá en adelante atiende el negocio, para no ofrecer una fecha que
 * no lleva a ninguna parte.
 */
export class PublicDaysQueryDto {
  @ServiceIdsParam()
  serviceIds!: string[];

  @StaffIdsParam()
  staffIds?: string[];

  /**
   * Cuántos días mirar hacia adelante, contando hoy.
   *
   * Con tope: la consulta resuelve todas las fechas en memoria, pero pedirle
   * dos años de calendario a una página pública es una invitación a que alguien
   * lo pruebe.
   */
  @ApiPropertyOptional({ default: 30, maximum: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;
}
