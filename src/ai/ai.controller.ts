import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AIService } from './ai.service';
import { ApiProperty } from '@nestjs/swagger';

export class AiTestDto {
  @ApiProperty({
    example: 'hola',
  })
  message: string;
}

@ApiTags('ai')
@Controller('ai')
export class AIController {
  constructor(private readonly aiService: AIService) {}

  @Post('test')
  async test(@Body() body: AiTestDto) {
    const response = await this.aiService.chat([
      {
        role: 'system',
        content: 'You are a helpful assistant',
      },
      {
        role: 'user',
        content: body.message,
      },
    ]);

    return response;
  }
}
