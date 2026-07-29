import { Injectable } from '@nestjs/common';
import { WhatsappInteractiveMessage } from './whatsapp-interactive.types';

@Injectable()
export class WhatsappInteractiveMessageService {
  buildPayload(to: string, message: WhatsappInteractiveMessage) {
    if (message.kind === 'buttons') {
      return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: message.text },
          action: {
            buttons: message.buttons.slice(0, 3).map((button) => ({
              type: 'reply',
              reply: { id: button.id, title: button.title },
            })),
          },
        },
      };
    }

    if (message.kind === 'list') {
      return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: message.text },
          action: {
            button: message.buttonText,
            sections: message.sections.map((section) => ({
              title: section.title,
              rows: section.rows.slice(0, 10).map((row) => ({
                id: row.id,
                title: row.title,
                description: row.description,
              })),
            })),
          },
        },
      };
    }

    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'flow',
        body: { text: message.text },
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            flow_token: message.flowToken,
            flow_id: message.flowId,
            flow_cta: message.flowCta,
            flow_action: message.flowAction ?? 'navigate',
          },
        },
      },
    };
  }
}
