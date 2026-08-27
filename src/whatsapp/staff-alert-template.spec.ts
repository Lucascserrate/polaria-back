import {
  buildStaffAlertParameters,
  StaffAlertEvent,
  STAFF_ALERT_TEMPLATE_BODY,
  STAFF_ALERT_TEMPLATE_VARIABLES,
  type StaffAlertContent,
} from './staff-alert-template';

const content = (
  overrides: Partial<StaffAlertContent> = {},
): StaffAlertContent => ({
  event: StaffAlertEvent.CREATED,
  professionalName: 'Diego',
  clientName: 'Carlos Pérez',
  serviceName: 'Corte',
  date: 'jueves 21 de agosto',
  time: '16:00',
  ...overrides,
});

describe('la plantilla', () => {
  /*
   * El cuerpo y la lista de variables tienen que decir lo mismo. Si alguien agrega
   * un `{{7}}` al texto y olvida la constante, el envío manda seis parámetros para
   * siete huecos y Meta rechaza el mensaje: no llega, y el error aparece lejos.
   */
  it('declara tantas variables como usa el cuerpo', () => {
    const used = new Set(STAFF_ALERT_TEMPLATE_BODY.match(/\{\{\d+\}\}/g) ?? []);

    expect(used.size).toBe(STAFF_ALERT_TEMPLATE_VARIABLES.length);
  });

  it('las numera desde 1 y sin saltos', () => {
    const tokens: string[] =
      STAFF_ALERT_TEMPLATE_BODY.match(/\{\{\d+\}\}/g) ?? [];
    const numbers = tokens
      .map((token) => Number(token.replace(/\D/g, '')))
      .sort((a, b) => a - b);

    expect([...new Set(numbers)]).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('buildStaffAlertParameters', () => {
  it('manda un parámetro por variable, en orden', () => {
    expect(buildStaffAlertParameters(content())).toHaveLength(
      STAFF_ALERT_TEMPLATE_VARIABLES.length,
    );
  });

  /*
   * Meta rechaza el envío si una variable llega vacía, y el mensaje no llega. Es un
   * fallo que no se ve desde el panel, así que se cubre acá.
   */
  it('ninguna variable queda vacía, aunque falten datos', () => {
    const parameters = buildStaffAlertParameters(
      content({ clientName: null, serviceName: null }),
    );

    for (const parameter of parameters) {
      expect(parameter.trim()).not.toBe('');
    }
  });

  it('distingue los tres eventos en el encabezado', () => {
    const headingOf = (event: StaffAlertEvent) =>
      buildStaffAlertParameters(content({ event }))[0];

    const headings = [
      headingOf(StaffAlertEvent.CREATED),
      headingOf(StaffAlertEvent.RESCHEDULED),
      headingOf(StaffAlertEvent.CANCELLED),
    ];

    expect(new Set(headings).size).toBe(3);
  });

  it('la nueva cita nombra a quien la agendó', () => {
    expect(buildStaffAlertParameters(content())[2]).toBe(
      'Carlos Pérez agendó una cita con vos.',
    );
  });

  it('sin nombre del cliente no dice "null"', () => {
    expect(buildStaffAlertParameters(content({ clientName: null }))[2]).toBe(
      'Un cliente agendó una cita con vos.',
    );
  });

  it('la reprogramación dice de dónde se movió, cuando se sabe', () => {
    expect(
      buildStaffAlertParameters(
        content({
          event: StaffAlertEvent.RESCHEDULED,
          previousTime: '15:30',
          time: '17:00',
        }),
      )[2],
    ).toBe('La cita con Carlos Pérez se movió de las 15:30 a las 17:00.');
  });

  it('y no lo dice cuando solo cambió el día', () => {
    expect(
      buildStaffAlertParameters(
        content({ event: StaffAlertEvent.RESCHEDULED, previousTime: null }),
      )[2],
    ).toBe('La cita con Carlos Pérez fue reprogramada.');
  });
});
