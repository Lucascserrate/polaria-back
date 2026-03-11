import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Conversation } from './entities/conversation.entity';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';

@Injectable()
export class ConversationsService {
  constructor(
    @InjectRepository(Conversation)
    private conversationRepository: Repository<Conversation>,
  ) {}

  create(createConversationDto: CreateConversationDto) {
    const conversation =
      this.conversationRepository.create(createConversationDto);
    return this.conversationRepository.save(conversation);
  }

  findAll() {
    return this.conversationRepository.find();
  }

  findOne(id: string) {
    return this.conversationRepository.findOneBy({ id });
  }

  async update(id: string, updateConversationDto: UpdateConversationDto) {
    await this.conversationRepository.update(id, updateConversationDto);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.conversationRepository.delete(id);
    return { deleted: true };
  }
}
