import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

import { TenantsModule } from './tenants/tenants.module';
import { StaffModule } from './staff/staff.module';
import { ServicesModule } from './services/services.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { ClientsModule } from './clients/clients.module';
import { ConversationsModule } from './conversations/conversations.module';
import { BusinessHoursModule } from './business_hours/business_hours.module';
import { AIModule } from './ai/ai.module';
import { AssistantModule } from './assistant/assistant.module';
import { MessagesModule } from './messages/messages.module';
import { dbConfig } from './config/data-source';
import { AuthModule } from './auth/auth.module';
import { AvailabilityModule } from './availability/availability.module';
import { SettingsModule } from './settings/settings.module';
import { WebhookController } from './webhook/webhook.controller';
import { WebhookService } from './webhook/webhook.service';
import { WebhookModule } from './webhook/webhook.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [dbConfig],
    }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        configService.getOrThrow('database'),
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
    }),

    TenantsModule,
    StaffModule,
    ServicesModule,
    AppointmentsModule,
    ClientsModule,
    ConversationsModule,
    MessagesModule,
    BusinessHoursModule,
    AIModule,
    AssistantModule,
    AuthModule,
    AvailabilityModule,
    SettingsModule,
    WebhookModule,
  ],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class AppModule {}
