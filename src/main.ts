import cookieParser from 'cookie-parser';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { NestApplication, NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

import 'dotenv/config';
const { CLIENT_BASE_URL, ADMIN_CLIENT_BASE_URL } = process.env;
const logger = new Logger('Bootstrap');

async function bootstrap() {
  const keyPath = resolve(
    process.cwd(),
    '..',
    'polaria-front',
    'certificates',
    'localhost-key.pem',
  );
  const certPath = resolve(
    process.cwd(),
    '..',
    'polaria-front',
    'certificates',
    'localhost.pem',
  );

  logger.log(
    `Bootstrapping HTTPS server keyPath=${keyPath} certPath=${certPath}`,
  );

  const app: NestApplication = await NestFactory.create(AppModule, {
    httpsOptions: {
      key: readFileSync(keyPath),
      cert: readFileSync(certPath),
    },
  });

  const allowedOrigins = [CLIENT_BASE_URL, ADMIN_CLIENT_BASE_URL].filter(
    (origin): origin is string => Boolean(origin),
  );

  logger.log(
    `CORS enabled. allowedOrigins=${JSON.stringify(allowedOrigins)} credentials=true`,
  );

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      const isAllowed = !origin || allowedOrigins.includes(origin);
      logger.log(
        `CORS check origin=${origin ?? 'undefined'} allowed=${isAllowed}`,
      );
      callback(null, isAllowed);
    },
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

  logger.log(
    `Bootstrap complete. NODE_ENV=${process.env.NODE_ENV ?? 'undefined'} CLIENT_BASE_URL=${CLIENT_BASE_URL ?? 'undefined'}`,
  );

  await app.listen(3001);
}

void bootstrap();
