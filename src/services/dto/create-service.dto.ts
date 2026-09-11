import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { ServiceBookingPolicy } from '../booking-policy';

/**
 * Lo que aguanta la columna, que es `varchar(255)` en las dos.
 *
 * El tope se declara acá y no solo en la base porque sin esto un texto más largo
 * llegaba entero a MySQL, que lo rechazaba con `ER_DATA_TOO_LONG`, y eso salía
 * como un 500 sin decir qué campo ni por qué. Un límite que el cliente no puede
 * conocer es un error de servidor disfrazado de error de datos.
 *
 * No es el largo *útil*: en una lista de WhatsApp el nombre se recorta a 24
 * caracteres y la descripción a 72 (ver `WHATSAPP_LIMITS`). Eso es del canal y
 * se recorta al enviar; esto es lo que se puede guardar.
 */
const TEXT_MAX_LENGTH = 255;

export class CreateServiceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @ApiProperty({ maxLength: TEXT_MAX_LENGTH })
  @IsString()
  @MaxLength(TEXT_MAX_LENGTH, {
    message: `El nombre no puede tener más de ${TEXT_MAX_LENGTH} caracteres`,
  })
  name: string;

  @ApiPropertyOptional({ maxLength: TEXT_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_MAX_LENGTH, {
    message: `La descripción no puede tener más de ${TEXT_MAX_LENGTH} caracteres`,
  })
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
