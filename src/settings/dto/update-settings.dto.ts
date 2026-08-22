import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { WeeklyRangeDto } from '../../schedule/weekly-range.dto';
import { BUSINESS_TYPES } from '../../tenants/business-type';

/** Anticipaciones ofrecidas: 1, 3, 6, 12 y 24 horas, en minutos. */
export const REMINDER_LEAD_OPTIONS = [60, 180, 360, 720, 1440];

class LocationDto {
  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;
}

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
  @IsIn(BUSINESS_TYPES)
  businessType?: string;

  /**
   * Zona horaria del negocio, en formato IANA.
   *
   * Se acepta desde la configuración inicial porque el negocio nace con la de
   * Bolivia —Google no informa la del usuario— y el horario de atención se
   * interpreta en esta zona: una zona equivocada corre toda la agenda.
   */
  @IsOptional()
  @IsString()
  timezone?: string;

  /**
   * Coordenadas del local. Ambas o ninguna: media coordenada no ubica nada.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  location?: LocationDto | null;

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
