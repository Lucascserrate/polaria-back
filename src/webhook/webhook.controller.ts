import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { WebhookService } from './webhook.service';

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly webhookService: WebhookService,
    private readonly configService: ConfigService,
  ) {}

  private get verifyToken(): string {
    return (
      this.configService.get<string>('WHATSAPP_VERIFY_TOKEN') ?? 'polaria123'
    );
  }

  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.challenge') challenge: string,
    @Query('hub.verify_token') token: string,
  ): string {
    this.logger.log(
      `Verify request received mode=${mode ?? 'null'} challenge=${Boolean(challenge)} tokenMatch=${token === this.verifyToken}`,
    );

    if (mode === 'subscribe' && token === this.verifyToken) {
      this.logger.log('Verify request accepted');
      return challenge;
    }

    this.logger.warn('Verify request rejected');
    throw new ForbiddenException();
  }

  @Post()
  receiveMessage(@Req() req: Request, @Body() body: unknown): Promise<void> {
    this.logger.log(
      `[Webhook] Incoming POST received method=${req.method} url=${req.originalUrl} contentType=${req.headers['content-type'] ?? 'unknown'} userAgent=${req.headers['user-agent'] ?? 'unknown'} xHubSignature=${req.headers['x-hub-signature-256'] ? 'present' : 'absent'} xHubSignature1=${req.headers['x-hub-signature'] ? 'present' : 'absent'}`,
    );
    this.logger.log(
      '[Webhook] Passing payload to WebhookService.handleIncomingWhatsAppWebhook',
    );
    return this.webhookService.handleIncomingWhatsAppWebhook(body);
  }
}
