import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { WeeklyRangeDto } from '../../schedule/weekly-range.dto';

class WhatsappConnectionDto {
  @IsString()
  code!: string;

  @IsOptional()
  @IsString()
  businessId?: string;

  @IsOptional()
  @IsString()
  wabaId?: string;

  @IsOptional()
  @IsString()
  phoneNumberId?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  systemUserAccessToken?: string;
}

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  polariaName?: string;

  /**
   * Horario semanal completo. Reemplaza al anterior: un día que no viene es un
   * día cerrado. Admite varias franjas por día para el turno partido.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WeeklyRangeDto)
  businessHours?: WeeklyRangeDto[];

  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => WhatsappConnectionDto)
  whatsappConnection?: WhatsappConnectionDto;
}
