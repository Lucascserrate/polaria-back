import cookieParser from 'cookie-parser';
import { NestApplication, NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

import 'dotenv/config';
const { CLIENT_BASE_URL, ADMIN_CLIENT_BASE_URL } = process.env;

async function bootstrap() {
  const app: NestApplication = await NestFactory.create(AppModule);
  app.enableCors({
    origin: [CLIENT_BASE_URL, ADMIN_CLIENT_BASE_URL],
    credentials: true,
  });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Polaria API')
    .setDescription('API for appointment booking system')
    .setVersion('1.0')
    .addTag('polaria')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('api', app, document);

  await app.listen(3001);
}

void bootstrap();
