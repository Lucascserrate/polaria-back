import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class AssistantChatDto {
  @ApiProperty()
  @IsUUID()
  tenantId!: string;

  @ApiProperty()
  @IsString()
  phone!: string;

  @ApiProperty()
  @IsString()
  messageText!: string;

  @ApiPropertyOptional({
    description: 'Client action to control assistant flow',
  })
  @IsOptional()
  @IsString()
  action?: string;
}
