import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { AppointmentStatus } from '../entities/appointment.entity';

export class CreateAppointmentDto {
  @ApiProperty()
  @IsUUID()
  tenantId: string;

  @ApiProperty()
  @IsUUID()
  staffId: string;

  @ApiProperty()
  @IsUUID()
  clientId: string;

  @ApiProperty({
    type: [String],
    description: 'Lista de IDs de servicios incluidos en la cita.',
  })
  @IsArray()
  @IsUUID('4', { each: true })
  serviceIds: string[];

  @ApiPropertyOptional({
    description: 'Compatibilidad: ID de un solo servicio.',
  })
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString()
  startTime: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString()
  endTime: Date;

  @ApiPropertyOptional({ enum: AppointmentStatus })
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  googleEventId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  reminderSent?: boolean;
}
