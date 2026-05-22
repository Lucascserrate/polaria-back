import { Injectable } from '@nestjs/common';
import { ConversationsService } from '../../conversations/conversations.service';
import { MessagesService } from '../../messages/messages.service';
import { MessageRole } from '../../messages/entities/message.entity';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

@Injectable()
export class AssistantMessagingService {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly conversationsService: ConversationsService,
  ) {}

  async saveUserMessage(params: {
    tenantId: string;
    conversationId: string;
    clientId: string;
    content: string;
  }): Promise<void> {
    const { tenantId, conversationId, clientId, content } = params;
    await this.messagesService.create({
      tenantId,
      conversationId,
      clientId,
      role: MessageRole.USER,
      content,
    });
  }

  async saveAssistantMessage(params: {
    tenantId: string;
    conversationId: string;
    clientId: string;
    content: string;
    rawJson: unknown;
  }): Promise<void> {
    const { tenantId, conversationId, clientId, content, rawJson } = params;
    await this.messagesService.create({
      tenantId,
      conversationId,
      clientId,
      role: MessageRole.ASSISTANT,
      content,
      rawJson,
    });
  }

  async touchConversationLastMessageAt(conversationId: string): Promise<void> {
    await this.conversationsService.update(conversationId, {
      lastMessageAt: new Date(),
    });
  }

  async getConversationHistory(params: {
    conversationId: string;
    limit: number;
  }): Promise<ChatCompletionMessageParam[]> {
    const { conversationId, limit } = params;
    const history = await this.messagesService.findRecentByConversation(
      conversationId,
      limit,
    );
    return history
      .slice()
      .reverse()
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));
  }
}
