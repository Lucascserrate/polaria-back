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
import { buildAssistantSystemPrompt } from './prompts/assistant.system';
import { AssistantPromptContextService } from './services/assistant-prompt-context.service';
import { buildTempName } from './utils/assistant-utils';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

@Injectable()
export class AssistantService {
  constructor(
    private readonly aiService: AIService,
    private readonly conversationsService: ConversationsService,
    private readonly messagesService: MessagesService,
    private readonly clientsService: ClientsService,
    private readonly promptContextService: AssistantPromptContextService,
  ) {}

  async chat(
    input: AssistantChatDto,
  ): Promise<{ reply: string; conversationId: string; clientId: string }> {
    let client: Client | null = await this.clientsService.findByTenantAndPhone(
      input.tenantId,
      input.phone,
    );
    if (!client) {
      const tempName = buildTempName(input.phone);
      client = await this.clientsService.create({
        tenantId: input.tenantId,
        phone: input.phone,
        name: tempName,
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

    const promptContext = await this.promptContextService.build(input.tenantId);
    const history = await this.messagesService.findRecentByConversation(
      conversation.id,
      12,
    );
    const historyMessages: ChatCompletionMessageParam[] = history
      .slice()
      .reverse()
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));

    const response = await this.aiService.chat([
      { role: 'system', content: buildAssistantSystemPrompt(promptContext) },
      ...historyMessages,
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
    const promptContext = await this.promptContextService.build();
    const response = await this.aiService.chat([
      { role: 'system', content: buildAssistantSystemPrompt(promptContext) },
      { role: 'user', content: input.messageText },
    ]);

    return { reply: response.content ?? 'Sin respuesta' };
  }
}
