import { parseIncomingWhatsAppMessage } from './incoming-message.parser';
import { IncomingMessageKind } from './types/incoming-message.type';

/** Envuelve un `message` en la estructura de webhook que manda Meta. */
function webhookWith(
  message: Record<string, unknown>,
  overrides: { contacts?: unknown[] } = {},
): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15550001111',
                phone_number_id: 'PHONE_NUMBER_ID',
              },
              contacts: overrides.contacts ?? [
                { profile: { name: 'Lucas' }, wa_id: '5490000000' },
              ],
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

describe('parseIncomingWhatsAppMessage', () => {
  it('parsea un mensaje de texto con sus metadatos', () => {
    const result = parseIncomingWhatsAppMessage(
      webhookWith({
        id: 'wamid.TEXT',
        from: '5490000000',
        timestamp: '1753900000',
        type: 'text',
        text: { body: 'Quiero reservar un turno' },
      }),
    );

    expect(result).toEqual({
      kind: IncomingMessageKind.TEXT,
      text: 'Quiero reservar un turno',
      metaMessageId: 'wamid.TEXT',
      from: '5490000000',
      contactName: 'Lucas',
      phoneNumberId: 'PHONE_NUMBER_ID',
      displayPhoneNumber: '15550001111',
      timestamp: '1753900000',
    });
  });

  it('expone el id de una fila de lista como selectionId', () => {
    const result = parseIncomingWhatsAppMessage(
      webhookWith({
        id: 'wamid.LIST',
        from: '5490000000',
        type: 'interactive',
        interactive: {
          type: 'list_reply',
          list_reply: {
            id: 'service:9f1c',
            title: 'Corte + Barba',
            description: '45 min',
          },
        },
      }),
    );

    expect(result).toMatchObject({
      kind: IncomingMessageKind.LIST_REPLY,
      selectionId: 'service:9f1c',
      title: 'Corte + Barba',
      description: '45 min',
    });
  });

  it('expone el id de un botón interactivo como selectionId', () => {
    const result = parseIncomingWhatsAppMessage(
      webhookWith({
        id: 'wamid.BUTTON',
        from: '5490000000',
        type: 'interactive',
        interactive: {
          type: 'button_reply',
          button_reply: { id: 'when:today', title: 'Hoy' },
        },
      }),
    );

    expect(result).toMatchObject({
      kind: IncomingMessageKind.BUTTON_REPLY,
      selectionId: 'when:today',
      title: 'Hoy',
    });
  });

  it('trata el botón de plantilla (type "button") como BUTTON_REPLY', () => {
    const result = parseIncomingWhatsAppMessage(
      webhookWith({
        id: 'wamid.TEMPLATE_BUTTON',
        from: '5490000000',
        type: 'button',
        button: { payload: 'booking:start', text: 'Reservar' },
      }),
    );

    expect(result).toMatchObject({
      kind: IncomingMessageKind.BUTTON_REPLY,
      selectionId: 'booking:start',
      title: 'Reservar',
    });
  });

  it('parsea el response_json de un Flow y extrae el flow_token', () => {
    const result = parseIncomingWhatsAppMessage(
      webhookWith({
        id: 'wamid.FLOW',
        from: '5490000000',
        type: 'interactive',
        interactive: {
          type: 'nfm_reply',
          nfm_reply: {
            name: 'flow',
            body: 'Enviado',
            response_json:
              '{"flow_token":"sess_123","service_id":"9f1c","slot":"2026-07-31T15:00:00Z"}',
          },
        },
      }),
    );

    expect(result).toMatchObject({
      kind: IncomingMessageKind.FLOW_REPLY,
      flowToken: 'sess_123',
      response: {
        flow_token: 'sess_123',
        service_id: '9f1c',
        slot: '2026-07-31T15:00:00Z',
      },
    });
  });

  it('parsea el response_json de un Flow cuando viene URL-encoded', () => {
    const result = parseIncomingWhatsAppMessage(
      webhookWith({
        id: 'wamid.FLOW_ENCODED',
        from: '5490000000',
        type: 'interactive',
        interactive: {
          type: 'nfm_reply',
          nfm_reply: {
            response_json: encodeURIComponent('{"flow_token":"sess_456"}'),
          },
        },
      }),
    );

    expect(result).toMatchObject({
      kind: IncomingMessageKind.FLOW_REPLY,
      flowToken: 'sess_456',
    });
  });

  it('no lanza cuando el response_json de un Flow es inválido y conserva el crudo', () => {
    const result = parseIncomingWhatsAppMessage(
      webhookWith({
        id: 'wamid.FLOW_BROKEN',
        from: '5490000000',
        type: 'interactive',
        interactive: {
          type: 'nfm_reply',
          nfm_reply: { response_json: '{no es json' },
        },
      }),
    );

    expect(result).toMatchObject({
      kind: IncomingMessageKind.FLOW_REPLY,
      flowToken: null,
      response: null,
      rawResponseJson: '{no es json',
    });
  });

  it('marca como UNSUPPORTED los tipos que no manejamos', () => {
    const result = parseIncomingWhatsAppMessage(
      webhookWith({
        id: 'wamid.AUDIO',
        from: '5490000000',
        type: 'audio',
        audio: { id: 'MEDIA_ID', mime_type: 'audio/ogg' },
      }),
    );

    expect(result).toMatchObject({
      kind: IncomingMessageKind.UNSUPPORTED,
      messageType: 'audio',
    });
  });

  it('devuelve null para notificaciones de estado (statuses)', () => {
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: {
                  display_phone_number: '15550001111',
                  phone_number_id: 'PHONE_NUMBER_ID',
                },
                statuses: [{ id: 'wamid.X', status: 'delivered' }],
              },
            },
          ],
        },
      ],
    };

    expect(parseIncomingWhatsAppMessage(body)).toBeNull();
  });

  it('devuelve null cuando falta phone_number_id', () => {
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { display_phone_number: '15550001111' },
                messages: [
                  {
                    id: 'wamid.X',
                    from: '5490000000',
                    type: 'text',
                    text: { body: 'hola' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    expect(parseIncomingWhatsAppMessage(body)).toBeNull();
  });

  it('devuelve null ante payloads basura sin lanzar', () => {
    expect(parseIncomingWhatsAppMessage(null)).toBeNull();
    expect(parseIncomingWhatsAppMessage(undefined)).toBeNull();
    expect(parseIncomingWhatsAppMessage('texto')).toBeNull();
    expect(parseIncomingWhatsAppMessage([])).toBeNull();
    expect(parseIncomingWhatsAppMessage({})).toBeNull();
    expect(parseIncomingWhatsAppMessage({ entry: [] })).toBeNull();
  });

  it('tolera la ausencia de contacts', () => {
    const result = parseIncomingWhatsAppMessage(
      webhookWith(
        {
          id: 'wamid.NO_CONTACT',
          from: '5490000000',
          type: 'text',
          text: { body: 'hola' },
        },
        { contacts: [] },
      ),
    );

    expect(result).toMatchObject({ contactName: null });
  });
});
