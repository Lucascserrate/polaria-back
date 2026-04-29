import { Injectable } from '@nestjs/common';
import { ClientsService } from '../../clients/clients.service';
import { ConversationsService } from '../../conversations/conversations.service';
import { ConversationState } from '../../conversations/entities/conversation.entity';
import type { Client } from '../../clients/entities/client.entity';
import type { Conversation } from '../../conversations/entities/conversation.entity';
import { buildTempName } from '../utils/assistant-utils';

@Injectable()
export class AssistantSessionService {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly conversationsService: ConversationsService,
  ) {}

  async getOrCreateClient(params: {
    tenantId: string;
    phone: string;
  }): Promise<Client> {
    const { tenantId, phone } = params;

    let client = await this.clientsService.findByTenantAndPhone(
      tenantId,
      phone,
    );
    if (client) return client;

    const tempName = buildTempName(phone);
    client = await this.clientsService.create({
      tenantId,
      phone,
      name: tempName,
    });
    return client;
  }

  async getOrCreateConversation(params: {
    tenantId: string;
    clientId: string;
  }): Promise<Conversation> {
    const { tenantId, clientId } = params;

    let conversation = await this.conversationsService.findByTenantAndClient(
      tenantId,
      clientId,
    );
    if (conversation) return conversation;

    conversation = await this.conversationsService.create({
      tenantId,
      clientId,
      currentState: ConversationState.IDLE,
      contextJson: {},
    });
    return conversation;
  }

  async getOrCreateSession(params: {
    tenantId: string;
    phone: string;
  }): Promise<{ client: Client; conversation: Conversation }> {
    const client = await this.getOrCreateClient(params);
    const conversation = await this.getOrCreateConversation({
      tenantId: params.tenantId,
      clientId: client.id,
    });
    return { client, conversation };
  }
}
