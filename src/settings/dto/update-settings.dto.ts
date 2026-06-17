import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class OpeningHoursDto {
  @IsString()
  from!: string;

  @IsString()
  to!: string;
}

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  polariaName?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(7)
  @ArrayMaxSize(7)
  @IsBoolean({ each: true })
  workingDays?: boolean[];

  @IsOptional()
  @ValidateNested()
  @Type(() => OpeningHoursDto)
  openingHours?: OpeningHoursDto;

  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;
}
