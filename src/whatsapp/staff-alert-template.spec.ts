import {
  buildStaffAlertParameters,
  StaffAlertEvent,
  STAFF_ALERT_CANCELLED_TEMPLATE_BODY,
  STAFF_ALERT_MOVED_TEMPLATE_BODY,
  STAFF_ALERT_NEW_TEMPLATE_BODY,
  STAFF_ALERT_TEMPLATE_VARIABLES,
  TEMPLATE_KEY_BY_EVENT,
  type StaffAlertContent,
} from './staff-alert-template';
import { templateDefinition, TemplateKey } from './template-registry';

const BODIES: Array<[string, string]> = [
  ['nueva', STAFF_ALERT_NEW_TEMPLATE_BODY],
  ['reprogramada', STAFF_ALERT_MOVED_TEMPLATE_BODY],
  ['cancelada', STAFF_ALERT_CANCELLED_TEMPLATE_BODY],
];

const content = (
  overrides: Partial<StaffAlertContent> = {},
): StaffAlertContent => ({
  clientName: 'Carlos Pérez',
  serviceName: 'Corte',
  date: 'jueves 21 de agosto',
  time: '16:00',
  ...overrides,
});

const variablesOf = (body: string): string[] =>
  body.match(/\{\{\d+\}\}/g) ?? [];

describe('las tres plantillas', () => {
  /*
   * Estas comprobaciones son el resultado de un rechazo real de Meta
   * (`code=100, subcode=2388293`). La plantilla parametrizada que las reemplazó tenía
   * `{{1}}` ocupando una línea entera y 34 caracteres de texto para 6 variables. Los
   * tests dejan esas dos condiciones fuera de lo posible.
   */
  it.each(BODIES)('%s: usa las cuatro variables, sin saltos', (_, body) => {
    const numbers = variablesOf(body)
      .map((token) => Number(token.replace(/\D/g, '')))
      .sort((a, b) => a - b);

    expect([...new Set(numbers)]).toEqual([1, 2, 3, 4]);
    expect(numbers).toHaveLength(STAFF_ALERT_TEMPLATE_VARIABLES.length);
  });

  it.each(BODIES)('%s: ninguna línea es solo una variable', (_, body) => {
    const bare = body
      .split('\n')
      .filter((line) => /^\s*\{\{\d+\}\}\s*$/.test(line));

    expect(bare).toEqual([]);
  });

  it.each(BODIES)('%s: no hay variables adyacentes', (_, body) => {
    expect(/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(body)).toBe(false);
  });

  /*
   * El umbral sale de la comparación que explicó el rechazo: la plantilla aprobada de
   * recordatorios tiene 28.2 caracteres de texto por variable, y la rechazada 5.7. Un
   * cuerpo que baje de 12 se está pareciendo demasiado a la que Meta no aceptó.
   */
  it.each(BODIES)(
    '%s: tiene texto real alrededor de sus variables',
    (_, body) => {
      const text = body.replace(/\{\{\d+\}\}/g, '').trim().length;
      const ratio = text / variablesOf(body).length;

      expect(ratio).toBeGreaterThan(12);
    },
  );

  it.each(BODIES)('%s: abre con el encabezado y su emoji', (_, body) => {
    // Es lo primero que se ve en la lista de chats, antes de abrir el mensaje.
    expect(body.split('\n')[0]).toMatch(/^Cita |^Nueva cita /);
    expect(/[📅🔄❌]/u.test(body.split('\n')[0])).toBe(true);
  });

  it('los tres encabezados son distintos', () => {
    const headings = BODIES.map(([, body]) => body.split('\n')[0]);
    expect(new Set(headings).size).toBe(3);
  });
});

describe('TEMPLATE_KEY_BY_EVENT', () => {
  it('cada evento tiene su plantilla, y ninguna se repite', () => {
    const keys = Object.values(TEMPLATE_KEY_BY_EVENT);

    expect(keys).toHaveLength(Object.keys(StaffAlertEvent).length);
    expect(new Set(keys).size).toBe(keys.length);
  });

  /*
   * Si se agrega un evento a `StaffAlertEvent` y se olvida su plantilla, el
   * despachador lo saltearía con `UNKNOWN_EVENT` en silencio. Esto lo caza antes.
   */
  it('no queda ningún evento sin plantilla', () => {
    for (const event of Object.values(StaffAlertEvent)) {
      expect(TEMPLATE_KEY_BY_EVENT[event]).toBeDefined();
    }
  });
});

describe('los botones', () => {
  it('la nueva y la reprogramada llevan a la agenda', () => {
    for (const key of [
      TemplateKey.STAFF_ALERT_NEW,
      TemplateKey.STAFF_ALERT_MOVED,
    ]) {
      expect(templateDefinition(key).urlButton?.text).toBe('Ver mi agenda');
    }
  });

  /*
   * La cita ya no existe: "ver mi agenda" llevaría a un día donde no hay nada que
   * ver. Y si la plantilla no declara botón, mandarle un parámetro de botón al enviar
   * hace que Meta rechace el mensaje —de ahí que el despachador lo condicione—.
   */
  it('la cancelada no lleva botón', () => {
    expect(
      templateDefinition(TemplateKey.STAFF_ALERT_CANCELLED).urlButton,
    ).toBeUndefined();
  });
});

describe('buildStaffAlertParameters', () => {
  it('manda un parámetro por variable, en orden', () => {
    expect(buildStaffAlertParameters(content())).toEqual([
      'Carlos Pérez',
      'Corte',
      'jueves 21 de agosto',
      '16:00',
    ]);
  });

  /*
   * Meta rechaza el envío si una variable llega vacía, y el mensaje no llega. Es un
   * fallo que no se ve desde el panel, así que se cubre acá.
   */
  it('ninguna variable queda vacía, aunque falten datos', () => {
    const parameters = buildStaffAlertParameters(
      content({ clientName: null, serviceName: null }),
    );

    expect(parameters).toHaveLength(STAFF_ALERT_TEMPLATE_VARIABLES.length);
    for (const parameter of parameters) {
      expect(parameter.trim()).not.toBe('');
    }
  });

  it('el nombre en blanco cuenta como ausente', () => {
    expect(buildStaffAlertParameters(content({ clientName: '   ' }))[0]).toBe(
      'Un cliente',
    );
  });
});
