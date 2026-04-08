import { IsArray, IsOptional, IsString, ArrayNotEmpty } from 'class-validator';

export class FindAvailableSlotsDto {
  @IsString()
  tenantId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  serviceIds!: string[];

  @IsString()
  desiredDate!: string; // YYYY-MM-DD

  @IsString()
  desiredTime!: string; // HH:mm

  @IsOptional()
  @IsString()
  staffId?: string;
}
