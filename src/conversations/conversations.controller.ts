import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Req,
  UseGuards,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminOnly, RolesGuard } from '../auth/guards/roles.guard';
import type { Request } from 'express';
import { ConversationControlService } from './conversation-control.service';
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';

/**
 * Todo el controlador va detrás del guard y todo se acota al negocio del token.
 *
 * Una conversación es el hilo de WhatsApp de una persona con un negocio: sin
 * acotar, `GET /conversations` devolvería los hilos de todos los negocios y
 * `POST /:id/resume` dejaría reactivar el bot en una conversación ajena.
 */
@ApiTags('conversations')
@UseGuards(AuthGuard('jwt'))
@UseGuards(AuthGuard('jwt'), RolesGuard)
@AdminOnly()
@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly conversationControl: ConversationControlService,
  ) {}

  @Get('handed-off')
  @ApiOperation({
    summary: 'Conversaciones esperando atención humana, más antigua primero',
  })
  findHandedOff(@Req() req: Request) {
    return this.conversationControl.findPendingHandoffs(this.tenantId(req));
  }

  @Post(':id/resume')
  @ApiOperation({
    summary:
      'Devuelve la conversación a Polaria. No avisa al cliente: volver en silencio evita hablar por encima de quien venía atendiendo.',
  })
  async resume(@Req() req: Request, @Param('id') id: string) {
    const conversation = await this.conversationControl.resumeById({
      id,
      tenantId: this.tenantId(req),
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    return conversation;
  }

  @Post()
  create(
    @Req() req: Request,
    @Body() createConversationDto: CreateConversationDto,
  ) {
    // El tenant sale del token, no del cuerpo: si no, cualquiera podría crear
    // conversaciones en el negocio de otro.
    createConversationDto.tenantId = this.tenantId(req);
    return this.conversationsService.create(createConversationDto);
  }

  @Get()
  findAll(@Req() req: Request) {
    return this.conversationsService.findByTenant(this.tenantId(req));
  }

  @Get(':id')
  async findOne(@Req() req: Request, @Param('id') id: string) {
    return this.ownedOrFail(id, this.tenantId(req));
  }

  @Patch(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() updateConversationDto: UpdateConversationDto,
  ) {
    await this.ownedOrFail(id, this.tenantId(req));
    // El tenant nunca se reasigna desde el cuerpo: mover una conversación a otro
    // negocio no es una edición, es una fuga.
    delete updateConversationDto.tenantId;
    return this.conversationsService.update(id, updateConversationDto);
  }

  @Delete(':id')
  async remove(@Req() req: Request, @Param('id') id: string) {
    await this.ownedOrFail(id, this.tenantId(req));
    return this.conversationsService.remove(id);
  }

  private tenantId(req: Request): string {
    const tenantId = (req.user as { sub?: string }).sub;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant id');
    }
    return tenantId;
  }

  /**
   * Una conversación de otro negocio responde igual que una inexistente, para no
   * confirmar qué ids existen.
   */
  private async ownedOrFail(id: string, tenantId: string) {
    const conversation = await this.conversationsService.findOne(id);
    if (!conversation || conversation.tenantId !== tenantId) {
      throw new NotFoundException('Conversation not found');
    }
    return conversation;
  }
}
