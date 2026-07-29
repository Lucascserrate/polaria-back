import { Injectable } from '@nestjs/common';
import { BookingReplyAction } from './booking-flow.types';

@Injectable()
export class WhatsappInteractiveAdapter {
  toWhatsAppPayload(to: string, action: BookingReplyAction) {
    if (action.kind === 'buttons') {
      return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: action.text },
          action: {
            buttons: action.buttons.slice(0, 3).map((button) => ({
              type: 'reply',
              reply: { id: button.id, title: button.title },
            })),
          },
        },
      };
    }

    if (action.kind === 'list') {
      return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: action.text },
          action: {
            button: action.buttonText,
            sections: action.sections.map((section) => ({
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
      type: 'text',
      text: { preview_url: false, body: action.text },
    };
  }
}
