import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class AssistantSimpleDto {
  @ApiProperty()
  @IsString()
  messageText: string;
}
