import { Injectable } from '@nestjs/common';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { AIService } from '../../ai/ai.service';
import { buildAssistantSystemPrompt } from '../prompts/assistant.system';
import type { AssistantPromptContext } from '../prompts/assistant.system';
import { parseAssistantResponse } from '../utils/assistant-response-parser';
import type { AssistantParsedResponse } from '../utils/assistant-response-parser';

@Injectable()
export class AssistantAIService {
  constructor(private readonly aiService: AIService) {}

  private readonly jsonOnlyReminder =
    'Responde SOLO con JSON válido en el formato indicado. No incluyas texto adicional.';

  async executeChat(params: {
    promptContext: AssistantPromptContext;
    historyMessages: ChatCompletionMessageParam[];
  }): Promise<{
    response: unknown;
    parsed: {
      reply: string;
      entities?: AssistantParsedResponse['entities'];
      action?: string;
    };
  }> {
    const { promptContext, historyMessages } = params;
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: buildAssistantSystemPrompt(promptContext) },
      ...historyMessages,
      { role: 'system', content: this.jsonOnlyReminder },
    ];
    const response = await this.aiService.chat(messages);
    const parsed = parseAssistantResponse(response);
    return { response, parsed };
  }

  async executeChatWithSystemAddon(params: {
    promptContext: AssistantPromptContext;
    historyMessages: ChatCompletionMessageParam[];
    systemAddon: string;
  }): Promise<{
    response: unknown;
    parsed: {
      reply: string;
      entities?: AssistantParsedResponse['entities'];
      action?: string;
    };
  }> {
    const { promptContext, historyMessages, systemAddon } = params;
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: buildAssistantSystemPrompt(promptContext) },
      ...historyMessages,
      { role: 'system', content: systemAddon },
      { role: 'system', content: this.jsonOnlyReminder },
    ];
    const response = await this.aiService.chat(messages);
    const parsed = parseAssistantResponse(response);
    return { response, parsed };
  }

  async retryWhenEntitiesMissing(params: {
    promptContext: AssistantPromptContext;
    historyMessages: ChatCompletionMessageParam[];
  }): Promise<{
    correctionResponse: unknown;
    parsed: {
      reply: string;
      entities?: AssistantParsedResponse['entities'];
      action?: string;
    };
  }> {
    const { promptContext, historyMessages } = params;
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: buildAssistantSystemPrompt(promptContext) },
      ...historyMessages,
      {
        role: 'system',
        content: this.jsonOnlyReminder,
      },
    ];
    const correctionResponse = await this.aiService.chat(messages);
    const parsed = parseAssistantResponse(correctionResponse);
    return { correctionResponse, parsed };
  }
}
