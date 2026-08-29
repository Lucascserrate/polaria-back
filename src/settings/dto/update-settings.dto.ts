import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { WeeklyRangeDto } from '../../schedule/weekly-range.dto';
import { BUSINESS_TYPES } from '../../tenants/business-type';
import { SUPPORTED_REMINDER_OFFSETS } from '../../reminders/reminder-offsets';

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

  /**
   * Dirección del local en texto, para la página pública de reservas.
   *
   * `null` la borra; ausente la deja como está. La cadena vacía se guarda como
   * `null`, así que no hay forma de dejar una dirección en blanco que la página
   * tenga que salir a distinguir de "sin dirección".
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string | null;

  /**
   * Con cuánta anticipación avisar cada cita, en minutos.
   *
   * Una lista vacía apaga los recordatorios: es una configuración válida, no un
   * campo sin completar. Los valores están restringidos porque uno libre
   * habilitaría "2 minutos antes", que produce un aviso inútil.
   */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @IsIn(SUPPORTED_REMINDER_OFFSETS, { each: true })
  reminderOffsets?: number[];

  @IsOptional()
  @ValidateNested()
  @Type(() => WhatsappConnectionDto)
  whatsappConnection?: WhatsappConnectionDto;
}
