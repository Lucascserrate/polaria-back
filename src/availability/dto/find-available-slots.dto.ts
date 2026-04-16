import { IsArray, IsOptional, IsString, ArrayNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FindAvailableSlotsDto {
  @ApiProperty({
    description: 'ID del tenant',
    example: 'tenant_123',
  })
  @IsString()
  tenantId!: string;

  @ApiProperty({
    description: 'IDs de los servicios que se quieren consultar',
    example: ['service_1', 'service_2'],
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  serviceIds!: string[];

  @ApiProperty({
    description: 'Fecha deseada para la cita en formato YYYY-MM-DD',
    example: '2026-04-07',
  })
  @IsString()
  desiredDate!: string;

  @ApiProperty({
    description: 'Hora deseada para la cita en formato HH:mm',
    example: '09:00',
  })
  @IsString()
  desiredTime!: string;

  @ApiPropertyOptional({
    description:
      'ID del staff, opcional si no se quiere asignar un staff específico',
    example: 'staff_456',
  })
  @IsOptional()
  @IsString()
  staffId?: string;
}
