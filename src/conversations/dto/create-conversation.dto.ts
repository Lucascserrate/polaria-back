import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ConversationState } from '../entities/conversation.entity';

export class CreateConversationDto {
  @ApiProperty()
  @IsUUID()
  tenantId: string;

  @ApiProperty()
  @IsUUID()
  clientId: string;

  @ApiPropertyOptional({ enum: ConversationState })
  @IsOptional()
  @IsEnum(ConversationState)
  currentState?: ConversationState;

  @ApiPropertyOptional()
  @IsOptional()
  contextJson?: any;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  lastMessageAt?: Date;
}
