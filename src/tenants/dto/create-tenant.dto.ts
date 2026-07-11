import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { AuthProvider } from '../../auth/domain/enums/auth.enum';

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  whatsappPhoneId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  whatsappAccessToken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  whatsappBusinessId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  whatsappWabaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  whatsappSystemUserAccessToken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  whatsappVerifiedName?: string;

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

  @ApiPropertyOptional({ enum: AuthProvider })
  @IsOptional()
  @IsString()
  provider?: AuthProvider;

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
