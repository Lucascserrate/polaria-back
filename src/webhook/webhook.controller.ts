import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhookService } from './webhook.service';

@Controller('webhook')
export class WebhookController {
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
    if (mode === 'subscribe' && token === this.verifyToken) {
      return challenge;
    }

    throw new ForbiddenException();
  }

  @Post()
  receiveMessage(@Body() body: unknown): Promise<void> {
    return this.webhookService.handleIncomingWhatsAppWebhook(body);
  }
}
