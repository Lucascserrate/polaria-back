import {
  buildTemplateCreatePayload,
  TEMPLATE_KEYS,
  TemplateKey,
  templateHasUrlButton,
} from './template-registry';

const BASE = 'https://app.polariahq.com';

type Payload = {
  name: string;
  language: string;
  category: string;
  allow_category_change?: boolean;
  components: Array<{
    type: string;
    text?: string;
    example?: { body_text?: string[][] };
    buttons?: Array<{
      type: string;
      text?: string;
      url?: string;
      example?: string[];
    }>;
  }>;
};

const payloadOf = (key: TemplateKey) =>
  buildTemplateCreatePayload(key, BASE) as unknown as Payload;

const bodyOf = (p: Payload) => p.components.find((c) => c.type === 'BODY');
const buttonsOf = (p: Payload) =>
  p.components.find((c) => c.type === 'BUTTONS')?.buttons ?? [];

describe('buildTemplateCreatePayload', () => {
  it.each(TEMPLATE_KEYS.map((key) => [key] as const))(
    '%s: manda tantos ejemplos como variables',
    (key) => {
      const body = bodyOf(payloadOf(key));
      const variables = new Set(body?.text?.match(/\{\{\d+\}\}/g) ?? []);

      /*
       * Si sobran o faltan ejemplos, Meta rechaza la creación. Es un desajuste fácil
       * de introducir editando el cuerpo y olvidando la lista de ejemplos.
       */
      expect(body?.example?.body_text?.[0]).toHaveLength(variables.size);
    },
  );

  it.each(TEMPLATE_KEYS.map((key) => [key] as const))(
    '%s: el cuerpo no empieza ni termina en una variable',
    (key) => {
      /*
       * Meta rechaza la creación con `code=100, subcode=2388299` —"Leading or
       * Trailing Params Not Allowed"— y el mensaje no dice qué componente está mal.
       * Pasó de verdad: los tres avisos al profesional cerraban con la hora en
       * `{{4}}` y ninguno llegó a aprobarse.
       */
      const text = bodyOf(payloadOf(key))?.text?.trim() ?? '';

      expect(text.startsWith('{{')).toBe(false);
      expect(text.endsWith('}}')).toBe(false);
    },
  );

  it.each(TEMPLATE_KEYS.map((key) => [key] as const))(
    '%s: ningún ejemplo viene vacío',
    (key) => {
      for (const value of bodyOf(payloadOf(key))?.example?.body_text?.[0] ??
        []) {
        expect(value.trim()).not.toBe('');
      }
    },
  );

  /*
   * Sin este parámetro, declarar una categoría con la que el clasificador de Meta no
   * esté de acuerdo puede terminar en rechazo en lugar de recategorización. Meta lo
   * recomienda para toda creación y no lo estábamos mandando.
   */
  it.each(TEMPLATE_KEYS.map((key) => [key] as const))(
    '%s: deja que Meta corrija la categoría en lugar de rechazar',
    (key) => {
      expect(payloadOf(key).allow_category_change).toBe(true);
    },
  );

  it.each(TEMPLATE_KEYS.map((key) => [key] as const))(
    '%s: el nombre cumple lo que acepta Meta',
    (key) => {
      // Solo minúsculas, números y guion bajo.
      expect(payloadOf(key).name).toMatch(/^[a-z0-9_]+$/);
    },
  );

  describe('el botón de enlace', () => {
    /*
     * El ejemplo de un botón URL es la **URL completa** con el valor sustituido, no el
     * valor suelto. Mandar `"2026-08-21"` fue uno de los errores del primer payload
     * que Meta rechazó.
     */
    it('lleva la URL completa como ejemplo, no el valor suelto', () => {
      const button = buttonsOf(payloadOf(TemplateKey.STAFF_ALERT_NEW)).find(
        (b) => b.type === 'URL',
      );

      expect(button?.url).toBe(`${BASE}/mi-agenda?date={{1}}`);
      expect(button?.example).toEqual([`${BASE}/mi-agenda?date=2026-08-21`]);
    });

    it('el ejemplo no deja ningún hueco sin sustituir', () => {
      for (const key of TEMPLATE_KEYS) {
        for (const button of buttonsOf(payloadOf(key))) {
          for (const example of button.example ?? []) {
            expect(example).not.toMatch(/\{\{\d+\}\}/);
          }
        }
      }
    });

    /*
     * Sin la base del panel no se puede armar el enlace. Se omite el botón entero en
     * lugar de crearlo apuntando a ninguna parte: una plantilla con un enlace roto se
     * aprueba igual, y el problema aparece cuando alguien lo toca.
     */
    it('sin base configurada, la plantilla se crea sin botón', () => {
      const payload = buildTemplateCreatePayload(
        TemplateKey.STAFF_ALERT_NEW,
        undefined,
      ) as unknown as Payload;

      expect(payload.components.map((c) => c.type)).toEqual(['BODY']);
    });

    it('la cancelada no lleva componente de botones', () => {
      expect(
        payloadOf(TemplateKey.STAFF_ALERT_CANCELLED).components.map(
          (c) => c.type,
        ),
      ).toEqual(['BODY']);
    });
  });

  /*
   * Crear y enviar tienen que coincidir en si la plantilla lleva botón.
   *
   * Discreparon una vez: la creación omite el botón sin `CLIENT_BASE_URL` —no hay
   * con qué armar el enlace— pero el envío lo decidía mirando solo el registro.
   * Quedaba una plantilla aprobada sin botón recibiendo un parámetro de botón, y
   * Meta rechazaba cada mensaje.
   *
   * Este test recorre las dos entradas posibles: con base y sin base.
   */
  describe('crear y enviar coinciden en el botón', () => {
    it.each(TEMPLATE_KEYS.map((key) => [key] as const))(
      '%s: con la base configurada',
      (key) => {
        const tieneEnElPayload = buttonsOf(payloadOf(key)).some(
          (b) => b.type === 'URL',
        );

        expect(tieneEnElPayload).toBe(templateHasUrlButton(key, BASE));
      },
    );

    it.each(TEMPLATE_KEYS.map((key) => [key] as const))(
      '%s: sin base configurada',
      (key) => {
        const payload = buildTemplateCreatePayload(
          key,
          undefined,
        ) as unknown as Payload;
        const tieneEnElPayload = (
          payload.components.find((c) => c.type === 'BUTTONS')?.buttons ?? []
        ).some((b) => b.type === 'URL');

        expect(tieneEnElPayload).toBe(templateHasUrlButton(key, undefined));
        // Sin base, ninguna lleva enlace: no hay con qué armarlo.
        expect(templateHasUrlButton(key, undefined)).toBe(false);
      },
    );
  });
});
