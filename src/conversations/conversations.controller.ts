import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConversationControlService } from './conversation-control.service';
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';

@ApiTags('conversations')
@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly conversationControl: ConversationControlService,
  ) {}

  @Get('handed-off/:tenantId')
  @ApiOperation({
    summary: 'Conversaciones esperando atención humana, más antigua primero',
  })
  findHandedOff(@Param('tenantId') tenantId: string) {
    return this.conversationControl.findHandedOff(tenantId);
  }

  @Post(':id/resume')
  @ApiOperation({
    summary:
      'Devuelve la conversación a Polaria. No avisa al cliente: volver en silencio evita hablar por encima de quien venía atendiendo.',
  })
  resume(@Param('id') id: string) {
    return this.conversationControl.resumeById(id);
  }

  @Post()
  create(@Body() createConversationDto: CreateConversationDto) {
    return this.conversationsService.create(createConversationDto);
  }

  @Get()
  findAll() {
    return this.conversationsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.conversationsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateConversationDto: UpdateConversationDto,
  ) {
    return this.conversationsService.update(id, updateConversationDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.conversationsService.remove(id);
  }
}
