import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

/**
 * La reserva que pide alguien desde la página pública.
 *
 * No trae ni `endTime` ni precio: los dos salen del servicio del lado del
 * servidor. Un formulario público que pudiera proponer su propia duración
 * podría reservar diez minutos y ocupar dos horas, o al revés.
 */
export class CreatePublicBookingDto {
  @ApiProperty()
  @IsUUID()
  serviceId!: string;

  @ApiPropertyOptional({
    description: 'Profesional elegido. Omitirlo es "sin preferencia".',
  })
  @IsOptional()
  @IsUUID()
  staffId?: string;

  @ApiProperty({
    description: 'Inicio del turno, en ISO 8601 con zona.',
    example: '2026-08-29T13:00:00.000Z',
  })
  @IsISO8601()
  startTime!: string;

  @ApiProperty({ example: 'Lucas' })
  @IsString()
  @Length(2, 120)
  customerName!: string;

  /**
   * Teléfono tal como lo escribe el cliente. Se normaliza del lado del servidor
   * al mismo formato con el que WhatsApp guarda a esta persona, para que no
   * quede duplicada. Ver `normalizeClientPhone`.
   */
  @ApiProperty({ example: '70123456' })
  @IsString()
  @Length(6, 25)
  customerPhone!: string;
}
