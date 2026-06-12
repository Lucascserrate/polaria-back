import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateTenantDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  businessType?: string;

  @ApiProperty()
  @IsString()
  whatsappPhoneNumber!: string;

  @ApiProperty()
  @IsString()
  whatsappPhoneId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  whatsappAccessToken?: string;

  @ApiProperty()
  @IsString()
  timezone!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  googleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  googleRefreshToken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;
}
