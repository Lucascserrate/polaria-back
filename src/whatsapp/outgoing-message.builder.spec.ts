import {
  buildCtaUrlPayload,
  buildButtonsPayload,
  buildListPayload,
  buildTemplatePayload,
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

/**
 * El botón que abre la página de reservas.
 *
 * Lo que se prueba es sobre todo lo que **no** sale: una dirección inválida o
 * sin `https` tiene que reventar acá y no volver como un 400 genérico de Meta,
 * porque ese error se lee en un log y el cliente mientras tanto ve un chat que
 * no contestó.
 */
describe('buildCtaUrlPayload', () => {
  const base = {
    to: '59171000000',
    body: 'Reservá tu turno desde acá.',
    displayText: 'Reservar turno',
    url: 'https://polariahq.com/royal-barber',
  };

  it('arma el mensaje con el botón y la dirección', () => {
    const { payload } = buildCtaUrlPayload(base);

    expect(payload).toMatchObject({
      type: 'interactive',
      interactive: {
        type: 'cta_url',
        body: { text: 'Reservá tu turno desde acá.' },
        action: {
          name: 'cta_url',
          parameters: {
            display_text: 'Reservar turno',
            url: 'https://polariahq.com/royal-barber',
          },
        },
      },
    });
  });

  it('una dirección que no es una dirección no sale', () => {
    expect(() => buildCtaUrlPayload({ ...base, url: 'royal-barber' })).toThrow(
      WhatsAppMessageBuildError,
    );
  });

  /* WhatsApp marca los `http` como inseguros, y el de un negocio nunca lo es. */
  it('sólo https', () => {
    expect(() =>
      buildCtaUrlPayload({ ...base, url: 'http://polariahq.com/x' }),
    ).toThrow(WhatsAppMessageBuildError);
  });

  /*
   * En local el sitio corre en `http`. Sin esta excepción, el modo enlace no se
   * podría probar sin desplegarlo, que es como se descubren los errores en
   * producción.
   */
  it('en local admite http', () => {
    expect(() =>
      buildCtaUrlPayload({ ...base, url: 'http://localhost:3000/barbership' }),
    ).not.toThrow();
  });

  it('sin dirección tampoco', () => {
    expect(() => buildCtaUrlPayload({ ...base, url: '' })).toThrow(
      WhatsAppMessageBuildError,
    );
  });

  /* Veinte caracteres es el tope de Meta: se recorta con aviso, no se rechaza. */
  it('recorta el texto del botón y lo avisa', () => {
    const { payload, warnings } = buildCtaUrlPayload({
      ...base,
      displayText: 'Reservar un turno en la página del negocio',
    });

    expect(
      (
        payload as {
          interactive: { action: { parameters: { display_text: string } } };
        }
      ).interactive.action.parameters.display_text,
    ).toHaveLength(20);
    expect(warnings).not.toHaveLength(0);
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

describe('buildTemplatePayload', () => {
  it('construye una plantilla con variables y botones', () => {
    const { payload, warnings } = buildTemplatePayload({
      to: '549',
      name: 'appointment_reminder',
      languageCode: 'es',
      bodyParameters: ['María', 'Corte', 'Diego', '16:00'],
      quickReplyPayloads: ['appt|v1|resch|abc', 'appt|v1|cancel|abc'],
    });

    expect(payload).toEqual({
      type: 'template',
      template: {
        name: 'appointment_reminder',
        language: { code: 'es' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'María' },
              { type: 'text', text: 'Corte' },
              { type: 'text', text: 'Diego' },
              { type: 'text', text: '16:00' },
            ],
          },
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: '0',
            parameters: [{ type: 'payload', payload: 'appt|v1|resch|abc' }],
          },
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: '1',
            parameters: [{ type: 'payload', payload: 'appt|v1|cancel|abc' }],
          },
        ],
      },
    });
    expect(warnings).toEqual([]);
  });

  it('omite components cuando la plantilla no tiene variables ni botones', () => {
    const { payload } = buildTemplatePayload({
      to: '549',
      name: 'hello_world',
      languageCode: 'en_US',
    });

    expect(payload).toEqual({
      type: 'template',
      template: { name: 'hello_world', language: { code: 'en_US' } },
    });
  });

  it('deja las variables en una sola línea', () => {
    // Meta rechaza los parámetros con saltos de línea, tabulaciones o espacios
    // repetidos, y no dice cuál falló.
    const { payload } = buildTemplatePayload({
      to: '549',
      name: 'appointment_reminder',
      languageCode: 'es',
      bodyParameters: ['  Corte \n de   barba\t '],
    });

    const template = payload.template as {
      components: Array<{ parameters: Array<{ text: string }> }>;
    };
    expect(template.components[0].parameters[0].text).toBe('Corte de barba');
  });

  it('rechaza más botones de los que admite una plantilla', () => {
    expect(() =>
      buildTemplatePayload({
        to: '549',
        name: 'appointment_reminder',
        languageCode: 'es',
        quickReplyPayloads: ['a', 'b', 'c', 'd'],
      }),
    ).toThrow(WhatsAppMessageBuildError);
  });

  it('rechaza un payload vacío, que llegaría sin identificar la cita', () => {
    expect(() =>
      buildTemplatePayload({
        to: '549',
        name: 'appointment_reminder',
        languageCode: 'es',
        quickReplyPayloads: ['appt|v1|resch|abc', '   '],
      }),
    ).toThrow(WhatsAppMessageBuildError);
  });

  it('rechaza la plantilla sin nombre o sin idioma', () => {
    expect(() =>
      buildTemplatePayload({ to: '549', name: '  ', languageCode: 'es' }),
    ).toThrow(WhatsAppMessageBuildError);

    expect(() =>
      buildTemplatePayload({
        to: '549',
        name: 'appointment_reminder',
        languageCode: '',
      }),
    ).toThrow(WhatsAppMessageBuildError);
  });
});

/**
 * Lo que Meta rechaza y hay que atajar antes de enviar.
 *
 * Este caso llegó a producción: el paso de horarios armó una sección con título
 * y otra sin él, WhatsApp devolvió 400 y el flujo quedó mudo. El error aparecía
 * lejos del error, así que ahora falla acá, donde se arma el mensaje.
 */
describe('secciones de una lista', () => {
  const row = (id: string) => ({ id, title: id });
  const base = { to: '5490000000', body: 'Elegí', buttonText: 'Ver' };

  it('rechaza una lista con secciones donde falta un título', () => {
    expect(() =>
      buildListPayload({
        ...base,
        sections: [
          { title: 'Próximos horarios', rows: [row('a')] },
          { rows: [row('b')] },
        ],
      }),
    ).toThrow(/título en cada una/);
  });

  it('acepta una sola sección sin título, que es la lista de siempre', () => {
    expect(() =>
      buildListPayload({ ...base, sections: [{ rows: [row('a')] }] }),
    ).not.toThrow();
  });

  it('acepta varias secciones si todas tienen título', () => {
    expect(() =>
      buildListPayload({
        ...base,
        sections: [
          { title: 'Próximos horarios', rows: [row('a')] },
          { title: 'Otras opciones', rows: [row('b')] },
        ],
      }),
    ).not.toThrow();
  });
});
