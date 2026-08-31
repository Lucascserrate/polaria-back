import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsISO8601, IsOptional, IsString } from 'class-validator';

/**
 * El alta de un cliente desde el panel.
 *
 * El teléfono es obligatorio y ésa es la decisión de fondo del módulo: es lo
 * único con lo que se puede reconocer a la misma persona cuando vuelva por
 * WhatsApp o por la página. Un cliente sin teléfono no se puede reconocer nunca
 * más, y aceptarlo acá sería sembrar duplicados de a uno.
 *
 * Llega tal como lo escribió el negocio; normalizarlo es trabajo del servidor.
 *
 * No lleva `tenantId`: sale del token. Declararlo acá lo volvía obligatorio en
 * el cuerpo —con `forbidNonWhitelisted`, omitirlo era un 400— para un dato que
 * el controlador ni siquiera lee.
 */
export class CreateClientDto {
  @ApiProperty({
    description: 'Como lo escribió el negocio. Se normaliza acá.',
  })
  @IsString()
  phone!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    example: '1994-03-17',
    description: 'Sólo el día: un cumpleaños no tiene hora ni zona.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  birthDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
