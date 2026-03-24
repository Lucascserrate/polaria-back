import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from '../../clients/entities/client.entity';
import {
  Conversation,
  ConversationState,
} from '../../conversations/entities/conversation.entity';

@Injectable()
export class ConversationIdentityService {
  constructor(
    @InjectRepository(Client)
    private readonly clientRepository: Repository<Client>,
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
  ) {}

  // Crea o recupera el cliente por telefono y su conversacion principal.
  async resolveClientAndConversation(
    tenantId: string,
    phone: string,
  ): Promise<{ client: Client; conversation: Conversation }> {
    let client = await this.clientRepository.findOneBy({ tenantId, phone });
    if (!client) {
      client = this.clientRepository.create({ tenantId, phone });
      client = await this.clientRepository.save(client);
    }

    let conversation = await this.conversationRepository.findOneBy({
      tenantId,
      clientId: client.id,
    });
    if (!conversation) {
      conversation = this.conversationRepository.create({
        tenantId,
        clientId: client.id,
        contextJson: {},
      });
      conversation = await this.conversationRepository.save(conversation);
    }

    return { client, conversation };
  }

  // Actualiza el estado y la ultima actividad de la conversacion.
  async touchConversation(
    conversationId: string,
    state: ConversationState = ConversationState.IDLE,
  ): Promise<void> {
    await this.conversationRepository.update(conversationId, {
      currentState: state,
      lastMessageAt: new Date(),
    });
  }

  // Actualiza el nombre del cliente si llega desde la IA.
  async updateClientName(clientId: string, name: string): Promise<void> {
    await this.clientRepository.update(clientId, { name });
  }

  // Actualiza el contexto de la conversacion.
  async updateConversationContext(
    conversationId: string,
    context: Record<string, unknown>,
  ): Promise<void> {
    await this.conversationRepository.update(conversationId, {
      contextJson: context as unknown as object,
      lastMessageAt: new Date(),
    });
  }
}
