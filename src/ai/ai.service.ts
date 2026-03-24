import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

type ChatOptions = {
  response_format?: OpenAI.ChatCompletionCreateParams['response_format'];
};

@Injectable()
export class AIService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async chat(messages: ChatCompletionMessageParam[], options?: ChatOptions) {
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      ...(options?.response_format
        ? { response_format: options.response_format }
        : {}),
    });

    return response.choices[0].message;
  }
}
