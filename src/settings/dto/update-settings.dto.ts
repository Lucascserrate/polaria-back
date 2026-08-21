import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { WeeklyRangeDto } from '../../schedule/weekly-range.dto';

/** Anticipaciones ofrecidas: 1, 3, 6, 12 y 24 horas, en minutos. */
export const REMINDER_LEAD_OPTIONS = [60, 180, 360, 720, 1440];

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
  @IsBoolean()
  remindersEnabled?: boolean;

  /**
   * Anticipación en minutos, restringida a las opciones que ofrece el panel.
   *
   * La lista cerrada no es una limitación arbitraria: un valor libre habilitaría
   * "2 minutos antes", que produce un aviso inútil, y valores raros que después
   * hay que soportar para siempre.
   */
  @IsOptional()
  @IsInt()
  @IsIn(REMINDER_LEAD_OPTIONS)
  reminderLeadMinutes?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => WhatsappConnectionDto)
  whatsappConnection?: WhatsappConnectionDto;
}
