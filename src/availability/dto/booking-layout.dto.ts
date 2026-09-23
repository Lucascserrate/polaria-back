import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';

/** Un servicio de la reserva que se está armando. */
export class BookingLayoutItemDto {
  @ApiProperty()
  @IsUUID()
  serviceId!: string;

  /**
   * Profesional de este servicio. Omitirlo es "todavía sin asignar".
   *
   * Es opcional porque el drawer pregunta mientras la reserva se arma, y ahí un
   * servicio recién agregado puede no tener a nadie todavía. Ver
   * `pickPlanForAssignment`: sin profesional no choca con nadie.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  staffId?: string;
}

/**
 * Cómo se acomodan en el tiempo los servicios de una reserva.
 *
 * El tenant sale del token. El tope es el mismo que el de una reserva.
 */
export class BookingLayoutDto {
  @ApiProperty({ type: [BookingLayoutItemDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => BookingLayoutItemDto)
  items!: BookingLayoutItemDto[];
}
