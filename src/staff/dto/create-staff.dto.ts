import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { StaffScheduleDto } from './staff-schedule.dto';

export class CreateStaffDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  tenantId!: string;

  @ApiProperty()
  @IsString()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  calendarId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Comisión en porcentaje sobre lo facturado (0-100)',
    example: 40,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commissionRate?: number;

  @ApiPropertyOptional({
    type: [String],
    description: 'Service IDs assigned to this staff member',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  serviceIds?: string[];

  @ApiPropertyOptional({
    description:
      'Si es true, la jornada del profesional es `schedules` y no el horario del negocio.',
  })
  @IsOptional()
  @IsBoolean()
  usesCustomSchedule?: boolean;

  @ApiPropertyOptional({
    type: [StaffScheduleDto],
    description:
      'Jornada semanal completa. Reemplaza a la anterior; solo se aplica si usesCustomSchedule es true.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StaffScheduleDto)
  schedules?: StaffScheduleDto[];
}
