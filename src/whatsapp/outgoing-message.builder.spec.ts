import {
  buildButtonsPayload,
  buildListPayload,
  buildTextPayload,
} from './outgoing-message.builder';
import {
  WHATSAPP_LIMITS,
  WhatsAppMessageBuildError,
  type OutgoingListRow,
} from './types/outgoing-message.type';

function rows(count: number): OutgoingListRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `slot:${index}`,
    title: `1${index}:00`,
  }));
}

describe('buildTextPayload', () => {
  it('construye un mensaje de texto', () => {
    const { payload } = buildTextPayload({ to: '549', body: '  Hola  ' });

    expect(payload).toEqual({
      type: 'text',
      text: { preview_url: false, body: 'Hola' },
    });
  });

  it('rechaza texto vacío', () => {
    expect(() => buildTextPayload({ to: '549', body: '   ' })).toThrow(
      WhatsAppMessageBuildError,
    );
  });
});

describe('buildButtonsPayload', () => {
  it('construye un mensaje con botones de respuesta', () => {
    const { payload, warnings } = buildButtonsPayload({
      to: '549',
      body: '¿Cuándo querés atenderte?',
      buttons: [
        { id: 'when:today', title: 'Hoy' },
        { id: 'when:other', title: 'Otro día' },
      ],
    });

    expect(warnings).toEqual([]);
    expect(payload).toEqual({
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: '¿Cuándo querés atenderte?' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'when:today', title: 'Hoy' } },
            { type: 'reply', reply: { id: 'when:other', title: 'Otro día' } },
          ],
        },
      },
    });
  });

  it('incluye header y footer cuando se pasan', () => {
    const { payload } = buildButtonsPayload({
      to: '549',
      body: 'Confirmá tu reserva',
      header: 'Reserva',
      footer: 'Podés cancelar cuando quieras',
      buttons: [{ id: 'confirm:yes', title: 'Confirmar' }],
    });

    expect(payload.interactive).toMatchObject({
      header: { type: 'text', text: 'Reserva' },
      footer: { text: 'Podés cancelar cuando quieras' },
    });
  });

  it(`lanza con más de ${WHATSAPP_LIMITS.BUTTONS_MAX_COUNT} botones`, () => {
    expect(() =>
      buildButtonsPayload({
        to: '549',
        body: 'Elegí',
        buttons: [
          { id: 'a', title: 'A' },
          { id: 'b', title: 'B' },
          { id: 'c', title: 'C' },
          { id: 'd', title: 'D' },
        ],
      }),
    ).toThrow(/hasta 3 botones/);
  });

  it('lanza sin botones', () => {
    expect(() =>
      buildButtonsPayload({ to: '549', body: 'Elegí', buttons: [] }),
    ).toThrow(WhatsAppMessageBuildError);
  });

  it('lanza con ids repetidos', () => {
    expect(() =>
      buildButtonsPayload({
        to: '549',
        body: 'Elegí',
        buttons: [
          { id: 'same', title: 'A' },
          { id: 'same', title: 'B' },
        ],
      }),
    ).toThrow(/repetido/);
  });

  it('recorta el título del botón y avisa, en vez de fallar', () => {
    const { payload, warnings } = buildButtonsPayload({
      to: '549',
      body: 'Elegí',
      buttons: [{ id: 'long', title: 'Un título larguísimo que no entra' }],
    });

    const buttons = (
      payload.interactive as {
        action: { buttons: Array<{ reply: { title: string } }> };
      }
    ).action.buttons;

    expect(buttons[0].reply.title).toHaveLength(
      WHATSAPP_LIMITS.BUTTON_TITLE_MAX,
    );
    expect(warnings).toHaveLength(1);
  });

  it('nunca recorta un id: lanza si excede el límite', () => {
    expect(() =>
      buildButtonsPayload({
        to: '549',
        body: 'Elegí',
        buttons: [
          { id: 'x'.repeat(WHATSAPP_LIMITS.BUTTON_ID_MAX + 1), title: 'A' },
        ],
      }),
    ).toThrow(/deben volver intactos/);
  });
});

describe('buildListPayload', () => {
  it('construye una lista con secciones y descripciones', () => {
    const { payload, warnings } = buildListPayload({
      to: '549',
      body: 'Elegí un horario',
      buttonText: 'Ver horarios',
      sections: [
        {
          title: 'Mañana',
          rows: [{ id: 'slot:0', title: '09:00', description: 'Con Nico' }],
        },
      ],
    });

    expect(warnings).toEqual([]);
    expect(payload).toEqual({
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: 'Elegí un horario' },
        action: {
          button: 'Ver horarios',
          sections: [
            {
              title: 'Mañana',
              rows: [{ id: 'slot:0', title: '09:00', description: 'Con Nico' }],
            },
          ],
        },
      },
    });
  });

  it('omite la descripción cuando no se pasa', () => {
    const { payload } = buildListPayload({
      to: '549',
      body: 'Elegí',
      buttonText: 'Ver',
      sections: [{ rows: [{ id: 'slot:0', title: '09:00' }] }],
    });

    const section = (
      payload.interactive as {
        action: { sections: Array<Record<string, unknown>> };
      }
    ).action.sections[0];

    expect(section).not.toHaveProperty('title');
    expect(section.rows).toEqual([{ id: 'slot:0', title: '09:00' }]);
  });

  it(`admite exactamente ${WHATSAPP_LIMITS.LIST_ROWS_MAX_COUNT} filas`, () => {
    expect(() =>
      buildListPayload({
        to: '549',
        body: 'Elegí',
        buttonText: 'Ver',
        sections: [{ rows: rows(WHATSAPP_LIMITS.LIST_ROWS_MAX_COUNT) }],
      }),
    ).not.toThrow();
  });

  it('lanza cuando las filas suman más del límite entre todas las secciones', () => {
    expect(() =>
      buildListPayload({
        to: '549',
        body: 'Elegí',
        buttonText: 'Ver',
        sections: [
          { title: 'Mañana', rows: rows(6) },
          {
            title: 'Tarde',
            rows: rows(6).map((row) => ({ ...row, id: `${row.id}:pm` })),
          },
        ],
      }),
    ).toThrow(/hasta 10 filas/);
  });

  it('lanza sin filas', () => {
    expect(() =>
      buildListPayload({
        to: '549',
        body: 'Elegí',
        buttonText: 'Ver',
        sections: [{ rows: [] }],
      }),
    ).toThrow(WhatsAppMessageBuildError);
  });

  it('lanza con ids de fila repetidos entre secciones distintas', () => {
    expect(() =>
      buildListPayload({
        to: '549',
        body: 'Elegí',
        buttonText: 'Ver',
        sections: [
          { title: 'Mañana', rows: [{ id: 'slot:0', title: '09:00' }] },
          { title: 'Tarde', rows: [{ id: 'slot:0', title: '15:00' }] },
        ],
      }),
    ).toThrow(/repetido/);
  });

  it('recorta título y descripción de fila y acumula los avisos', () => {
    const { warnings } = buildListPayload({
      to: '549',
      body: 'Elegí',
      buttonText: 'Ver',
      sections: [
        {
          rows: [
            {
              id: 'slot:0',
              title: 'Un título de fila que supera los 24',
              description: 'd'.repeat(
                WHATSAPP_LIMITS.LIST_ROW_DESCRIPTION_MAX + 5,
              ),
            },
          ],
        },
      ],
    });

    expect(warnings).toHaveLength(2);
  });
});
