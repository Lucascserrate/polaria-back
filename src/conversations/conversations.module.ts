import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Conversation } from './entities/conversation.entity';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { ConversationControlService } from './conversation-control.service';
import { ConversationHandoffCleanupJob } from './conversation-handoff-cleanup.job';

@Module({
  imports: [TypeOrmModule.forFeature([Conversation])],
  controllers: [ConversationsController],
  providers: [
    ConversationsService,
    ConversationControlService,
    ConversationHandoffCleanupJob,
  ],
  exports: [ConversationsService, ConversationControlService],
})
export class ConversationsModule {}
