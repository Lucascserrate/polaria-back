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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql',
        host: config.get<string>('DB_HOST'),
        port: config.get<number>('DB_PORT'),
        username: config.get<string>('DB_USER'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_NAME'),
        autoLoadEntities: true,
        synchronize: true,
      }),
    }),

    TenantsModule,
    StaffModule,
    ServicesModule,
    AppointmentsModule,
    ClientsModule,
    ConversationsModule,
    BusinessHoursModule,
    AIModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
