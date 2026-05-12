import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';

@Injectable()
export class AIService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async chat(
    messages: ChatCompletionMessageParam[],
  ): Promise<ChatCompletionMessage> {
    const response = await this.chatRaw(messages);
    const message = response.choices[0]?.message;
    if (!message) {
      throw new Error('OpenAI response had no message in choices[0]');
    }

    return message;
  }

  async chatRaw(
    messages: ChatCompletionMessageParam[],
  ): Promise<ChatCompletion> {
    const response: ChatCompletion = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      max_tokens: 300,
      temperature: 0.6,
      n: 1,
    });

    return response;
  }
}
