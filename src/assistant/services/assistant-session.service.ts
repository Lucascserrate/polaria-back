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
    clientName?: string;
  }): Promise<Client> {
    const { tenantId, phone, clientName } = params;

    let client = await this.clientsService.findByTenantAndPhone(
      tenantId,
      phone,
    );
    if (client) {
      const trimmedIncomingName = clientName?.trim();
      if (trimmedIncomingName) {
        const existingName = (client.name ?? '').trim();
        const looksTemporary = existingName.startsWith('Usuario ');
        if (looksTemporary && existingName !== trimmedIncomingName) {
          const updated = await this.clientsService.update(client.id, {
            name: trimmedIncomingName,
          });
          if (updated) client = updated;
        }
      }
      return client;
    }

    const trimmedIncomingName = clientName?.trim();
    const tempName = trimmedIncomingName || buildTempName(phone);
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
    clientName?: string;
  }): Promise<{ client: Client; conversation: Conversation }> {
    const client = await this.getOrCreateClient(params);
    const conversation = await this.getOrCreateConversation({
      tenantId: params.tenantId,
      clientId: client.id,
    });
    return { client, conversation };
  }
}
