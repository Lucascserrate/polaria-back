import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import type {
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
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
    });

    return response.choices[0].message;
  }
}
