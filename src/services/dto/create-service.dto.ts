import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

import { ServiceBookingPolicy } from '../booking-policy';

export class CreateServiceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty()
  @IsNumber()
  price: number;

  @ApiProperty()
  @IsString()
  timezone: string;

  @ApiProperty()
  @IsInt()
  durationMinutes: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /**
   * Quién puede reservarlo. Ausente es `CLIENT_BOOKS`, el comportamiento de
   * siempre: un cliente viejo del API que no manda el campo sigue creando
   * servicios reservables.
   */
  @ApiPropertyOptional({ enum: ServiceBookingPolicy })
  @IsOptional()
  @IsEnum(ServiceBookingPolicy)
  bookingPolicy?: ServiceBookingPolicy;
}
