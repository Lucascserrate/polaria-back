import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message, MessageRole } from '../../messages/entities/message.entity';

@Injectable()
export class ConversationMessagesService {
  constructor(
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
  ) {}

  // Carga el historial reciente (solo user/assistant) para la IA.
  async getRecentMessages(
    conversationId: string,
    limit: number,
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    const items = await this.messageRepository.find({
      where: { conversationId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return items
      .reverse()
      .filter((item) => item.role !== MessageRole.SYSTEM)
      .map((item) => ({
        role: item.role as 'user' | 'assistant',
        content: item.content,
      }));
  }

  // Persiste un mensaje en la tabla messages.
  async saveMessage(input: {
    tenantId: string;
    conversationId: string;
    clientId: string;
    role: MessageRole;
    content: string;
  }) {
    const record = this.messageRepository.create(input);
    await this.messageRepository.save(record);
  }
}
