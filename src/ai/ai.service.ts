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

  async chatRaw(
    messages: ChatCompletionMessageParam[],
  ): Promise<ChatCompletion> {
    void messages;
    return {
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
    } as ChatCompletion;
  }
}
