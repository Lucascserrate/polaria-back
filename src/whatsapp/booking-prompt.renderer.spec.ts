import type {
  BookingOption,
  BookingSummary,
} from '../booking-flow/booking-flow.types';
import {
  BookingPromptRenderer,
  NATIVE_CHANNEL_LIMITS,
} from './booking-prompt.renderer';
import type {
  SendButtonsInput,
  SendListInput,
  SendTextInput,
  WhatsAppCredentials,
} from './types/outgoing-message.type';
import { WHATSAPP_LIMITS } from './types/outgoing-message.type';
import type { WhatsAppSenderService } from './whatsapp-sender.service';

const CREDENTIALS: WhatsAppCredentials = {
  accessToken: 'token',
  phoneNumberId: 'PHONE_ID',
};
const TO = '5490000000';

type SentMessage =
  | { kind: 'text'; input: SendTextInput }
  | { kind: 'buttons'; input: SendButtonsInput }
  | { kind: 'list'; input: SendListInput };

/** Emisor falso que solo registra lo que se le pidió enviar. */
function fakeSender(options: { failListSend?: boolean } = {}) {
  const sent: SentMessage[] = [];

  const sender = {
    sendText: (_c: WhatsAppCredentials, input: SendTextInput) => {
      sent.push({ kind: 'text', input });
      return Promise.resolve({ ok: true, metaMessageId: 'wamid.TEXT' });
    },
    sendButtons: (_c: WhatsAppCredentials, input: SendButtonsInput) => {
      sent.push({ kind: 'buttons', input });
      return Promise.resolve({ ok: true, metaMessageId: 'wamid.BUTTONS' });
    },
    sendList: (_c: WhatsAppCredentials, input: SendListInput) => {
      sent.push({ kind: 'list', input });
      return options.failListSend
        ? Promise.resolve({ ok: false, error: 'boom' })
        : Promise.resolve({ ok: true, metaMessageId: 'wamid.LIST' });
    },
  } as unknown as WhatsAppSenderService;

  return { sender, sent };
}

function option(value: string, title: string): BookingOption {
  return { selectionId: `b1|tok|3|ASK_SLOT|${value}`, title };
}

const SUMMARY: BookingSummary = {
  date: '2026-07-31',
  serviceName: 'Corte + Barba',
  serviceDurationMinutes: 45,
  staffName: 'Nico',
  startTime: new Date('2026-07-31T19:00:00.000Z'),
  endTime: new Date('2026-07-31T19:45:00.000Z'),
  timezone: 'America/La_Paz',
};

describe('NATIVE_CHANNEL_LIMITS', () => {
  it('expone el tope real de filas de una lista nativa', () => {
    expect(NATIVE_CHANNEL_LIMITS.maxOptionsPerPrompt).toBe(
      WHATSAPP_LIMITS.LIST_ROWS_MAX_COUNT,
    );
  });
});

describe('BookingPromptRenderer', () => {
  it('CONFIRM se envía como botones', async () => {
    const { sender, sent } = fakeSender();

    await new BookingPromptRenderer(sender).render({
      credentials: CREDENTIALS,
      to: TO,
      prompt: {
        kind: 'CONFIRM',
        summary: SUMMARY,
        options: [option('confirm', 'Confirmar'), option('cancel', 'Cancelar')],
      },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].kind).toBe('buttons');
    const input = sent[0].input as SendButtonsInput;
    expect(input.buttons.map((b) => b.title)).toEqual([
      'Confirmar',
      'Cancelar',
    ]);
  });

  it('copia el selectionId sin tocarlo', async () => {
    const { sender, sent } = fakeSender();
    const slot = option('2026-07-31T15:00:00.000Z', '15:00');

    await new BookingPromptRenderer(sender).render({
      credentials: CREDENTIALS,
      to: TO,
      prompt: {
        kind: 'ASK_SLOT',
        date: '2026-07-31',
        hasSlots: true,
        options: [slot],
      },
    });

    const input = sent[0].input as SendListInput;
    expect(input.sections[0].rows[0].id).toBe(slot.selectionId);
  });

  it('ASK_SERVICE se envía como lista y arrastra la descripción', async () => {
    const { sender, sent } = fakeSender();

    await new BookingPromptRenderer(sender).render({
      credentials: CREDENTIALS,
      to: TO,
      prompt: {
        kind: 'ASK_SERVICE',
        date: '2026-07-31',
        options: [
          { ...option('svc', 'Corte'), description: '30 min' },
          option('cancel', 'Cancelar'),
        ],
      },
    });

    expect(sent[0].kind).toBe('list');
    const input = sent[0].input as SendListInput;
    expect(input.sections[0].rows[0].description).toBe('30 min');
  });

  it('SLOT_TAKEN avisa por texto antes de mandar la lista nueva', async () => {
    const { sender, sent } = fakeSender();

    await new BookingPromptRenderer(sender).render({
      credentials: CREDENTIALS,
      to: TO,
      prompt: {
        kind: 'SLOT_TAKEN',
        date: '2026-07-31',
        options: [option('2026-07-31T16:00:00.000Z', '16:00')],
      },
    });

    expect(sent.map((m) => m.kind)).toEqual(['text', 'list']);
    expect((sent[0].input as SendTextInput).body).toContain('tomaron');
  });

  it('FROZEN recuerda el congelamiento y reenvía el paso pendiente', async () => {
    const { sender, sent } = fakeSender();

    await new BookingPromptRenderer(sender).render({
      credentials: CREDENTIALS,
      to: TO,
      prompt: {
        kind: 'FROZEN',
        current: {
          kind: 'ASK_STAFF',
          options: [option('any', 'Sin preferencia')],
        },
      },
    });

    expect(sent.map((m) => m.kind)).toEqual(['text', 'list']);
    expect((sent[0].input as SendTextInput).body).toContain(
      'completando tu reserva',
    );
  });

  it('NONE no envía nada: es una reentrega ya procesada', async () => {
    const { sender, sent } = fakeSender();

    await new BookingPromptRenderer(sender).render({
      credentials: CREDENTIALS,
      to: TO,
      prompt: { kind: 'NONE' },
    });

    expect(sent).toEqual([]);
  });

  it('CONFIRM muestra el resumen y los botones', async () => {
    const { sender, sent } = fakeSender();

    await new BookingPromptRenderer(sender).render({
      credentials: CREDENTIALS,
      to: TO,
      prompt: {
        kind: 'CONFIRM',
        summary: SUMMARY,
        options: [option('confirm', 'Confirmar'), option('cancel', 'Cancelar')],
      },
    });

    expect(sent[0].kind).toBe('buttons');
    const body = (sent[0].input as SendButtonsInput).body;
    expect(body).toContain('Corte + Barba');
    expect(body).toContain('Nico');
    // 19:00 UTC son las 15:00 en La Paz.
    expect(body).toContain('15:00');
  });

  it('COMPLETED confirma por texto', async () => {
    const { sender, sent } = fakeSender();

    await new BookingPromptRenderer(sender).render({
      credentials: CREDENTIALS,
      to: TO,
      prompt: { kind: 'COMPLETED', summary: SUMMARY, appointmentId: 'appt-1' },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].kind).toBe('text');
    expect((sent[0].input as SendTextInput).body).toContain('agendado');
  });

  it('NO_AVAILABILITY explica según el alcance', async () => {
    for (const scope of ['DATE', 'SERVICE', 'STAFF'] as const) {
      const { sender, sent } = fakeSender();

      await new BookingPromptRenderer(sender).render({
        credentials: CREDENTIALS,
        to: TO,
        prompt: { kind: 'NO_AVAILABILITY', scope },
      });

      expect(sent).toHaveLength(1);
      expect(sent[0].kind).toBe('text');
    }
  });

  it('informa los mensajes entregados, con su contenido y opciones', async () => {
    const { sender } = fakeSender();

    const delivered = await new BookingPromptRenderer(sender).render({
      credentials: CREDENTIALS,
      to: TO,
      prompt: {
        kind: 'ASK_STAFF',
        options: [option('nico', 'Nico'), option('cancel', 'Cancelar')],
      },
    });

    expect(delivered).toHaveLength(1);
    expect(delivered[0].content).toContain('Nico · Cancelar');
    expect(delivered[0].raw).toMatchObject({
      source: 'booking-flow',
      prompt: 'ASK_STAFF',
      component: 'list',
      metaMessageId: 'wamid.LIST',
    });
    expect(delivered[0].raw.options).toHaveLength(2);
  });

  it('no informa un mensaje que WhatsApp rechazó', async () => {
    // Registrarlo mostraría en el historial algo que el cliente nunca recibió.
    const { sender } = fakeSender({ failListSend: true });

    const delivered = await new BookingPromptRenderer(sender).render({
      credentials: CREDENTIALS,
      to: TO,
      prompt: {
        kind: 'SLOT_TAKEN',
        date: '2026-07-31',
        options: [option('2026-07-31T16:00:00.000Z', '16:00')],
      },
    });

    // El aviso salió; la lista no.
    expect(delivered).toHaveLength(1);
    expect(delivered[0].raw.component).toBe('text');
  });

  it('NONE no entrega nada', async () => {
    const { sender } = fakeSender();

    const delivered = await new BookingPromptRenderer(sender).render({
      credentials: CREDENTIALS,
      to: TO,
      prompt: { kind: 'NONE' },
    });

    expect(delivered).toEqual([]);
  });

  it('una lista sin opciones responde por texto en vez de romper', async () => {
    const { sender, sent } = fakeSender();

    await new BookingPromptRenderer(sender).render({
      credentials: CREDENTIALS,
      to: TO,
      prompt: { kind: 'ASK_DATE', options: [] },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].kind).toBe('text');
  });
});
