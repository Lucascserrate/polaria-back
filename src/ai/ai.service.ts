import { Injectable } from '@nestjs/common';
// import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';

@Injectable()
export class AIService {
  //  private openai: OpenAI;

  // constructor() {
  //   this.openai = new OpenAI({
  //     apiKey: process.env.OPENAI_API_KEY,
  //   });
  // }

  async chat(
    messages: ChatCompletionMessageParam[],
  ): Promise<ChatCompletionMessage> {
    const response = await this.chatRaw(messages);
    return response.choices[0]?.message ?? { content: '' };
  }

  /**
   * Respuesta simulada: el cliente de OpenAI está comentado más arriba.
   *
   * No es `async` porque no espera nada. Marcarla así solo para devolver una
   * promesa escondía que acá no hay ninguna llamada real, y es lo que hace que
   * el asistente conteste vacío.
   */
  chatRaw(messages: ChatCompletionMessageParam[]): Promise<ChatCompletion> {
    void messages;
    return Promise.resolve({
      id: 'stub-chat-completion',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'disabled-openai',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: '',
          },
          logprobs: null,
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    } as ChatCompletion);
  }
}
