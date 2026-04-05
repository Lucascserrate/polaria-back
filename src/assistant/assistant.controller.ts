import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AssistantService } from './assistant.service';
import { AssistantChatDto } from './dto/assistant-chat.dto';
import { AssistantSimpleDto } from './dto/assistant-simple.dto';

@ApiTags('assistant')
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  @Post('chat')
  async chat(@Body() body: AssistantChatDto) {
    return this.assistantService.chat(body);
  }

  @Post('chat-simple')
  async chatSimple(@Body() body: AssistantSimpleDto) {
    return this.assistantService.simpleChat(body);
  }
}
