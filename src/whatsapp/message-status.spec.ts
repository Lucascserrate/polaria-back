import {
  describeMessageStatus,
  isFailedStatus,
  parseMessageStatuses,
} from './message-status';
import type { JsonObject } from '../webhook/webhook-meta.util';

const change = (value: unknown): JsonObject =>
  ({ field: 'messages', value }) as unknown as JsonObject;

describe('parseMessageStatuses', () => {
  it('lee un estado de entrega', () => {
    const events = parseMessageStatuses(
      change({
        statuses: [
          {
            id: 'wamid.ABC',
            status: 'delivered',
            recipient_id: '59177679027',
            timestamp: '1756400000',
          },
        ],
      }),
    );

    expect(events).toEqual([
      {
        metaMessageId: 'wamid.ABC',
        status: 'delivered',
        recipientId: '59177679027',
        timestamp: '1756400000',
        errors: [],
      },
    ]);
  });

  /*
   * El caso que importa: Meta acepta el envío y devuelve un `wamid`, y recién en
   * este webhook aparece que el mensaje no va a llegar. Sin leerlo, "aceptado por
   * Graph" se confunde con "entregado".
   */
  it('lee el detalle de un fallo', () => {
    const [event] = parseMessageStatuses(
      change({
        statuses: [
          {
            id: 'wamid.XYZ',
            status: 'failed',
            recipient_id: '59177679027',
            errors: [
              {
                code: 131030,
                title: 'Recipient phone number not in allowed list',
                error_data: {
                  details:
                    'Recipient phone number not in allowed list for this WABA.',
                },
              },
            ],
          },
        ],
      }),
    );

    expect(isFailedStatus(event)).toBe(true);
    expect(event.errors).toEqual([
      {
        code: 131030,
        title: 'Recipient phone number not in allowed list',
        detail: 'Recipient phone number not in allowed list for this WABA.',
      },
    ]);
  });

  /*
   * Meta no es consistente en qué nivel llena. Sin `error_data.details` hay que caer
   * a `message`, o el log diría que hubo un error sin decir cuál.
   */
  it('cae a `message` cuando no viene `error_data.details`', () => {
    const [event] = parseMessageStatuses(
      change({
        statuses: [
          {
            id: 'wamid.XYZ',
            status: 'failed',
            errors: [{ code: 470, message: 'Message failed to send' }],
          },
        ],
      }),
    );

    expect(event.errors[0].detail).toBe('Message failed to send');
  });

  it('devuelve varios cuando el webhook trae varios', () => {
    const events = parseMessageStatuses(
      change({
        statuses: [
          { id: 'wamid.1', status: 'sent' },
          { id: 'wamid.2', status: 'read' },
        ],
      }),
    );

    expect(events.map((e) => e.status)).toEqual(['sent', 'read']);
  });

  /*
   * Un mensaje entrante llega por el mismo `field` que los estados. Devolver vacío
   * es lo que permite preguntar por estados en cada webhook sin romper el camino de
   * los mensajes.
   */
  it('un mensaje entrante no produce estados', () => {
    expect(
      parseMessageStatuses(change({ messages: [{ from: '59177810954' }] })),
    ).toEqual([]);
  });

  it('tolera un webhook sin value o con statuses vacío', () => {
    expect(parseMessageStatuses(change(undefined))).toEqual([]);
    expect(parseMessageStatuses(change({ statuses: [] }))).toEqual([]);
    expect(
      parseMessageStatuses(change({ statuses: [null, 'basura'] })),
    ).toEqual([]);
  });
});

describe('describeMessageStatus', () => {
  it('pone lo que hace falta para rastrear el mensaje', () => {
    const [event] = parseMessageStatuses(
      change({
        statuses: [
          {
            id: 'wamid.ABC',
            status: 'delivered',
            recipient_id: '59177679027',
          },
        ],
      }),
    );

    expect(describeMessageStatus(event)).toBe(
      'status=DELIVERED metaMessageId=wamid.ABC recipient=59177679027',
    );
  });

  it('en un fallo agrega el código y la explicación', () => {
    const [event] = parseMessageStatuses(
      change({
        statuses: [
          {
            id: 'wamid.XYZ',
            status: 'failed',
            recipient_id: '59177679027',
            errors: [
              {
                code: 131030,
                title: 'Recipient not allowed',
                error_data: { details: 'No está en la lista de permitidos.' },
              },
            ],
          },
        ],
      }),
    );

    const linea = describeMessageStatus(event);

    expect(linea).toContain('status=FAILED');
    expect(linea).toContain('error=131030');
    expect(linea).toContain('detalle="No está en la lista de permitidos."');
  });
});
