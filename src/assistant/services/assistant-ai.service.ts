import { Injectable } from '@nestjs/common';
import type {
  ChatCompletion,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { AIService } from '../../ai/ai.service';
import { buildAssistantSystemPrompt } from '../prompts/assistant.system';
import type { AssistantPromptContext } from '../prompts/assistant.system';
import { parseAssistantResponse } from '../utils/assistant-response-parser';

/**
 * Llamada al modelo para la parte conversacional.
 *
 * Devuelve texto y nada más. `retryWhenEntitiesMissing` se eliminó junto con las
 * entidades: existía para volver a pedirle al modelo los datos de la reserva que
 * no había logrado extraer.
 */
@Injectable()
export class AssistantAIService {
  constructor(private readonly aiService: AIService) {}

  private readonly jsonOnlyReminder =
    'Responde SOLO con JSON válido en el formato indicado. No incluyas texto adicional.';

  executeChat(params: {
    promptContext: AssistantPromptContext;
    historyMessages: ChatCompletionMessageParam[];
  }): Promise<{ response: ChatCompletion; parsed: { reply: string } }> {
    return this.run([
      {
        role: 'system',
        content: buildAssistantSystemPrompt(params.promptContext),
      },
      ...params.historyMessages,
      { role: 'system', content: this.jsonOnlyReminder },
    ]);
  }

  executeChatWithSystemAddon(params: {
    promptContext: AssistantPromptContext;
    historyMessages: ChatCompletionMessageParam[];
    systemAddon: string;
  }): Promise<{ response: ChatCompletion; parsed: { reply: string } }> {
    return this.run([
      {
        role: 'system',
        content: buildAssistantSystemPrompt(params.promptContext),
      },
      ...params.historyMessages,
      { role: 'system', content: params.systemAddon },
      { role: 'system', content: this.jsonOnlyReminder },
    ]);
  }

  private async run(
    messages: ChatCompletionMessageParam[],
  ): Promise<{ response: ChatCompletion; parsed: { reply: string } }> {
    const response: ChatCompletion = await this.aiService.chatRaw(messages);
    const message: Pick<ChatCompletionMessage, 'content'> = response.choices[0]
      ?.message ?? { content: '' };

    return { response, parsed: parseAssistantResponse(message) };
  }
}
