import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AssistantSessionService } from '../assistant/services/assistant-session.service';
import { BookingFlowEngine } from '../booking-flow/booking-flow.engine';
import { WhatsappInteractiveAdapter } from '../booking-flow/whatsapp-interactive.adapter';
import { ProcessedWhatsappMessageEntity } from '../booking-flow/entities/processed-message.entity';
import {
  BookingChannelEvent,
  BookingReplyAction,
} from '../booking-flow/booking-flow.types';
import { ConversationsService } from '../conversations/conversations.service';
import { MessageRole } from '../messages/entities/message.entity';
import { MessagesService } from '../messages/messages.service';
import { TenantsService } from '../tenants/tenants.service';
import { WhatsappMessageSenderService } from '../whatsapp/whatsapp-message-sender.service';
import {
  asObject,
  getArrayField,
  getObjectField,
  getStringField,
  normalizePhoneNumber,
} from './webhook-meta.util';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly tenantsService: TenantsService,
    private readonly assistantSessionService: AssistantSessionService,
    private readonly conversationsService: ConversationsService,
    private readonly bookingFlowEngine: BookingFlowEngine,
    private readonly whatsappInteractiveAdapter: WhatsappInteractiveAdapter,
    private readonly whatsappMessageSenderService: WhatsappMessageSenderService,
    private readonly messagesService: MessagesService,
    @InjectRepository(ProcessedWhatsappMessageEntity)
    private readonly processedRepository: Repository<ProcessedWhatsappMessageEntity>,
  ) {}

  async handleIncomingWhatsAppWebhook(body: unknown): Promise<void> {
    const parsed = this.parseIncoming(body);
    if (!parsed) return;

    const {
      metaMessageId,
      from,
      contactName,
      phoneNumberId,
      displayPhoneNumber,
      event,
    } = parsed;

    const tenant = await this.tenantsService.findByWhatsappPhoneNumber(
      normalizePhoneNumber(displayPhoneNumber),
    );
    if (!tenant) return;

    if (metaMessageId) {
      const already = await this.processedRepository.findOneBy({
        message_id: metaMessageId,
      });
      if (already) return;
      await this.processedRepository.save({
        message_id: metaMessageId,
        user_phone: from,
        processed_at: new Date(),
      });
    }

    const { conversation, client } =
      await this.assistantSessionService.getOrCreateSession({
        tenantId: tenant.id,
        phone: from,
        clientName: contactName ?? undefined,
      });

    if (event.type === 'button' || event.type === 'list') {
      this.logger.log(
        `WhatsApp interactive reply received tenantId=${tenant.id} conversationId=${conversation.id} type=${event.type} value=${event.value}`,
      );
      await this.messagesService.create({
        tenantId: tenant.id,
        conversationId: conversation.id,
        clientId: client.id,
        role: MessageRole.USER,
        content: `${event.type}:${event.value}`,
        rawJson: { event, metaMessageId, source: 'whatsapp' },
      });
      return;
    }

    const recentMessages = await this.messagesService.findRecentByConversation(
      conversation.id,
      1,
    );

    await this.messagesService.create({
      tenantId: tenant.id,
      conversationId: conversation.id,
      clientId: client.id,
      role: MessageRole.USER,
      content: `${event.type}:${event.value}`,
      rawJson: { event, metaMessageId, source: 'whatsapp' },
    });

    if (recentMessages.length === 0) {
      await this.sendWelcomeMessage({
        to: from,
        businessName: tenant.name,
        accessToken:
          tenant.whatsappSystemUserAccessToken ?? tenant.whatsappAccessToken,
        phoneNumberId: tenant.whatsappPhoneId ?? phoneNumberId,
      });
      return;
    }

    const result = await this.bookingFlowEngine.handle(conversation, event);
    await this.conversationsService.update(conversation.id, {
      currentState: result.conversationState,
      contextJson: result.contextJson,
      lastMessageAt: new Date(),
    });

    const replyAction = result.reply;
    const replyText = result.reply.text;
    await this.messagesService.create({
      tenantId: tenant.id,
      conversationId: conversation.id,
      clientId: client.id,
      role: MessageRole.ASSISTANT,
      content: replyText,
      rawJson: replyAction ?? { booking: true },
    });

    await this.sendReply({
      to: from,
      replyText,
      replyAction,
      accessToken:
        tenant.whatsappSystemUserAccessToken ?? tenant.whatsappAccessToken,
      phoneNumberId: tenant.whatsappPhoneId ?? phoneNumberId,
    });
  }

  async handleLocalBookingTest(body: {
    tenantId: string;
    phone: string;
    event: BookingChannelEvent;
  }) {
    const tenant = await this.tenantsService.findOne(body.tenantId);
    if (!tenant) throw new Error('Tenant no encontrado');
    const { conversation } =
      await this.assistantSessionService.getOrCreateSession({
        tenantId: tenant.id,
        phone: body.phone,
      });
    const result = await this.bookingFlowEngine.handle(
      conversation,
      body.event,
    );
    console.log(JSON.stringify(result.reply, null, 2));
    return result;
  }

  private parseIncoming(body: unknown): null | {
    metaMessageId: string | null;
    from: string;
    contactName: string | null;
    phoneNumberId: string;
    displayPhoneNumber: string;
    event: BookingChannelEvent;
  } {
    const data = asObject(body);
    if (!data) return null;

    const entry0 = getArrayField(data, 'entry')?.[0];
    const entry0Obj = entry0 ? asObject(entry0) : null;
    const changes0 = entry0Obj ? getArrayField(entry0Obj, 'changes')?.[0] : null;
    const changes0Obj = changes0 ? asObject(changes0) : null;
    const value = changes0Obj ? getObjectField(changes0Obj, 'value') : null;
    if (!value) return null;

    const messageObj = asObject(getArrayField(value, 'messages')?.[0]);
    if (!messageObj) return null;

    const metaMessageId = getStringField(messageObj, 'id');
    const from = getStringField(messageObj, 'from');
    const contact0Obj = asObject(getArrayField(value, 'contacts')?.[0]);
    const contactProfile = contact0Obj
      ? getObjectField(contact0Obj, 'profile')
      : null;
    const contactName = contactProfile
      ? getStringField(contactProfile, 'name')
      : null;
    const metadata = getObjectField(value, 'metadata');
    const phoneNumberId = metadata
      ? getStringField(metadata, 'phone_number_id')
      : null;
    const displayPhoneNumber = metadata
      ? getStringField(metadata, 'display_phone_number')
      : null;

    if (!from || !phoneNumberId || !displayPhoneNumber) return null;

    const event = this.parseEvent(messageObj);
    if (!event) return null;

    return {
      metaMessageId,
      from,
      contactName,
      phoneNumberId,
      displayPhoneNumber,
      event,
    };
  }

  private parseEvent(
    messageObj: Record<string, unknown>,
  ): BookingChannelEvent | null {
    const textObj = getObjectField(messageObj, 'text');
    if (textObj) {
      return { type: 'text', value: getStringField(textObj, 'body') ?? '' };
    }

    const interactiveObj = getObjectField(messageObj, 'interactive');
    if (!interactiveObj) return null;

    const buttonReply = getObjectField(interactiveObj, 'button_reply');
    if (buttonReply) {
      return {
        type: 'button',
        value: getStringField(buttonReply, 'id') ?? '',
      };
    }

    const listReply = getObjectField(interactiveObj, 'list_reply');
    if (listReply) {
      return {
        type: 'list',
        value: getStringField(listReply, 'id') ?? '',
      };
    }

    // TODO: soportar interactive.nfm_reply / Flows.
    return null;
  }

  private async sendReply(params: {
    to: string;
    replyText: string;
    replyAction: BookingReplyAction | null;
    accessToken?: string | null;
    phoneNumberId?: string | null;
  }): Promise<void> {
    const { to, replyAction, replyText, accessToken, phoneNumberId } = params;
    if (!accessToken || !phoneNumberId) return;

    const payload = replyAction
      ? this.whatsappInteractiveAdapter.toWhatsAppPayload(to, replyAction)
      : {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { preview_url: false, body: replyText },
        };

    const graphVersion =
      this.configService.get<string>('WHATSAPP_GRAPH_VERSION') ?? 'v21.0';
    const url = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(phoneNumberId)}/messages`;
    await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  }

  private async sendWelcomeMessage(params: {
    to: string;
    businessName: string;
    accessToken?: string | null;
    phoneNumberId?: string | null;
  }): Promise<void> {
    const { to, businessName, accessToken, phoneNumberId } = params;
    await this.whatsappMessageSenderService.sendInteractive({
      to,
      accessToken,
      phoneNumberId,
      message: {
        kind: 'buttons',
        text: `👋 ¡Hola! Soy Polaria, el asistente virtual de ${businessName}.\nEstoy aquí para ayudarte de forma rápida y sencilla.`,
        buttons: [
          { id: 'welcome_booking', title: '📅 Reservar cita' },
          { id: 'welcome_info', title: 'ℹ️ Más información' },
        ],
      },
    });
  }
}
