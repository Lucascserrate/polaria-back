import { Injectable } from '@nestjs/common';
import { AIService } from '../ai/ai.service';
import { ConversationsService } from '../conversations/conversations.service';
import { MessagesService } from '../messages/messages.service';
import { MessageRole } from '../messages/entities/message.entity';
import { AssistantChatDto } from './dto/assistant-chat.dto';
import { AssistantSimpleDto } from './dto/assistant-simple.dto';
import { ClientsService } from '../clients/clients.service';
import { ConversationState } from '../conversations/entities/conversation.entity';
import type { Client } from '../clients/entities/client.entity';
import type { Conversation } from '../conversations/entities/conversation.entity';
import {
  AssistantPromptContext,
  buildAssistantSystemPrompt,
} from './prompts/assistant.system';
import { BusinessHoursService } from '../business_hours/business_hours.service';
import { ServicesService } from '../services/services.service';
import { StaffService } from '../staff/staff.service';
import type { BusinessHour } from '../business_hours/entities/business_hour.entity';
import type { Service } from '../services/entities/service.entity';
import type { Staff } from '../staff/entities/staff.entity';
import { TenantsService } from '../tenants/tenants.service';
import type { Tenant } from '../tenants/entities/tenant.entity';

@Injectable()
export class AssistantService {
  constructor(
    private readonly aiService: AIService,
    private readonly conversationsService: ConversationsService,
    private readonly messagesService: MessagesService,
    private readonly clientsService: ClientsService,
    private readonly businessHoursService: BusinessHoursService,
    private readonly servicesService: ServicesService,
    private readonly staffService: StaffService,
    private readonly tenantsService: TenantsService,
  ) {}

  async chat(
    input: AssistantChatDto,
  ): Promise<{ reply: string; conversationId: string; clientId: string }> {
    let client: Client | null = await this.clientsService.findByTenantAndPhone(
      input.tenantId,
      input.phone,
    );
    if (!client) {
      client = await this.clientsService.create({
        tenantId: input.tenantId,
        phone: input.phone,
        name: undefined,
      });
    }

    let conversation: Conversation | null =
      await this.conversationsService.findByTenantAndClient(
        input.tenantId,
        client.id,
      );
    if (!conversation) {
      conversation = await this.conversationsService.create({
        tenantId: input.tenantId,
        clientId: client.id,
        currentState: ConversationState.IDLE,
        contextJson: {},
      });
    }
    await this.messagesService.create({
      tenantId: input.tenantId,
      conversationId: conversation.id,
      clientId: client.id,
      role: MessageRole.USER,
      content: input.messageText,
    });

    const promptContext = await this.buildPromptContext(input.tenantId);
    const response = await this.aiService.chat([
      { role: 'system', content: buildAssistantSystemPrompt(promptContext) },
      { role: 'user', content: input.messageText },
    ]);

    const reply = response.content ?? 'Sin respuesta';

    await this.messagesService.create({
      tenantId: input.tenantId,
      conversationId: conversation.id,
      clientId: client.id,
      role: MessageRole.ASSISTANT,
      content: reply,
      rawJson: response,
    });

    await this.conversationsService.update(conversation.id, {
      lastMessageAt: new Date(),
    });

    return { reply, conversationId: conversation.id, clientId: client.id };
  }

  async simpleChat(input: AssistantSimpleDto): Promise<{ reply: string }> {
    const promptContext = await this.buildPromptContext();
    const response = await this.aiService.chat([
      { role: 'system', content: buildAssistantSystemPrompt(promptContext) },
      { role: 'user', content: input.messageText },
    ]);

    return { reply: response.content ?? 'Sin respuesta' };
  }

  private async buildPromptContext(
    tenantId?: string,
  ): Promise<AssistantPromptContext> {
    let timezone = 'America/Bogota';
    const currentDateTime = new Date().toISOString();

    if (!tenantId) {
      return {
        timezone,
        currentDateTime,
        businessHours: [],
        services: [],
        staff: [],
      };
    }

    const tenant: Tenant | null = await this.tenantsService.findOne(tenantId);
    if (tenant?.timezone) {
      timezone = tenant.timezone;
    }

    const [businessHours, services, staff]: [
      BusinessHour[],
      Service[],
      Staff[],
    ] = await Promise.all([
      this.businessHoursService.findByTenant(tenantId),
      this.servicesService.findByTenant(tenantId),
      this.staffService.findByTenant(tenantId),
    ]);

    const businessHoursText = businessHours.map(
      (item) => `Dia ${item.dayOfWeek}: ${item.startTime}-${item.endTime}`,
    );
    const serviceNames = services.map((item) => item.name);
    const staffNames = staff.map((item) => item.name);

    return {
      timezone,
      currentDateTime,
      businessHours: businessHoursText,
      services: serviceNames,
      staff: staffNames,
    };
  }
}
