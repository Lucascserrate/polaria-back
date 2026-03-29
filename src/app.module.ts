import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { TenantsModule } from './tenants/tenants.module';
import { StaffModule } from './staff/staff.module';
import { ServicesModule } from './services/services.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { ClientsModule } from './clients/clients.module';
import { ConversationsModule } from './conversations/conversations.module';
import { BusinessHoursModule } from './business_hours/business_hours.module';
import { AIModule } from './ai/ai.module';
import { MessagesModule } from './messages/messages.module';
import { dbConfig } from './config/data-source';
import { AuthModule } from './auth/auth.module';

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

    TenantsModule,
    StaffModule,
    ServicesModule,
    AppointmentsModule,
    ClientsModule,
    ConversationsModule,
    MessagesModule,
    BusinessHoursModule,
    AIModule,
    AuthModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
