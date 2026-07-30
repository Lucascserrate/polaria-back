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

  async sendText(params: {
    to: string;
    text: string;
    accessToken?: string | null;
    phoneNumberId?: string | null;
  }): Promise<boolean> {
    const { to, text, accessToken, phoneNumberId } = params;
    if (!accessToken || !phoneNumberId) return false;

    const graphVersion =
      this.configService.get<string>('WHATSAPP_GRAPH_VERSION') ?? 'v21.0';
    const url = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(phoneNumberId)}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: text },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const responseBody = await response.text();
    this.debugLog(
      `[WhatsApp] Graph API response status=${response.status} ok=${response.ok} phoneNumberId=${phoneNumberId} to=${to} body=${responseBody}`,
    );

    if (!response.ok) {
      throw new Error(
        `WhatsApp Cloud API text send failed: HTTP ${response.status} ${responseBody}`,
      );
    }

    return true;
  }

  private debugLog(message: string): void {
    // Keep diagnostic logging localized to this service without changing behavior.
    console.log(message);
  }
}
