import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
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
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  tenantId!: string;

  @ApiProperty()
  @IsUUID()
  @IsOptional()
  staffId?: string;

  @ApiProperty()
  @IsUUID()
  clientId!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  serviceIds!: string[];

  @ApiPropertyOptional({
    description:
      'Optional multi-staff plan. If provided, booking will be validated using availability and segments will be derived from availability response.',
    type: [Object],
  })
  @IsOptional()
  @IsArray()
  segments?: Array<{
    serviceId: string;
    staffId: string;
  }>;

  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString()
  startTime!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString()
  endTime!: Date;

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
