import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConversationEngineService } from './conversation_engine.service';
import { ChatMessageDto } from './dto/chat-message.dto';

@ApiTags('chat')
@Controller('chat')
export class ConversationEngineController {
  constructor(
    private readonly conversationEngineService: ConversationEngineService,
  ) {}

  @Post('message')
  async handleMessage(@Body() body: ChatMessageDto) {
    return this.conversationEngineService.handleMessage(body);
  }
}
