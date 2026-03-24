import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';

import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
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
  app.useStaticAssets(join(__dirname, '..', 'public'));

  await app.listen(3001);
}

bootstrap();
