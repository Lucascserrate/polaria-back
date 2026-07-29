import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsappInteractiveMessageService } from './whatsapp-interactive-message.service';
import { WhatsappInteractiveMessage } from './whatsapp-interactive.types';

@Injectable()
export class WhatsappMessageSenderService {
  constructor(
    private readonly configService: ConfigService,
    private readonly interactiveMessageService: WhatsappInteractiveMessageService,
  ) {}

  async sendInteractive(params: {
    to: string;
    message: WhatsappInteractiveMessage;
    accessToken?: string | null;
    phoneNumberId?: string | null;
  }): Promise<boolean> {
    const { to, message, accessToken, phoneNumberId } = params;
    if (!accessToken || !phoneNumberId) return false;
    const payload = this.interactiveMessageService.buildPayload(to, message);
    const graphVersion =
      this.configService.get<string>('WHATSAPP_GRAPH_VERSION') ?? 'v21.0';
    const url = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(phoneNumberId)}/messages`;
    await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return true;
  }
}
