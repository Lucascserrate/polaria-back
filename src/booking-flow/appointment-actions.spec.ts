import {
  AppointmentAction,
  buildAppointmentListPrompt,
  buildCancelConfirmPrompt,
  buildSingleAppointmentPrompt,
  decodeAppointmentAction,
  encodeAppointmentAction,
  isAppointmentSelection,
  MAX_LISTED_APPOINTMENTS,
  type AppointmentSummary,
} from './appointment-actions';

const TIMEZONE = 'America/La_Paz';
const APPOINTMENT_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

function appointment(
  overrides: Partial<AppointmentSummary> = {},
): AppointmentSummary {
  return {
    id: APPOINTMENT_ID,
    serviceName: 'Corte + Barba',
    staffName: 'Nico',
    // 19:00 UTC son las 15:00 en La Paz.
    startTime: new Date('2026-08-21T19:00:00.000Z'),
    ...overrides,
  };
}

describe('codificación de acciones sobre citas', () => {
  it('hace ida y vuelta con y sin cita', () => {
    expect(
      decodeAppointmentAction(
        encodeAppointmentAction(AppointmentAction.CANCEL, APPOINTMENT_ID),
      ),
    ).toEqual({
      action: AppointmentAction.CANCEL,
      appointmentId: APPOINTMENT_ID,
    });

    expect(
      decodeAppointmentAction(encodeAppointmentAction(AppointmentAction.NEW)),
    ).toEqual({ action: AppointmentAction.NEW, appointmentId: undefined });
  });

  it('no se confunde con las otras familias de ids', () => {
    // El coordinador despacha por prefijo: reserva, menú y citas no pueden
    // solaparse.
    const ajenos = [
      'b1|a1b2c3|3|ASK_SERVICE|uuid',
      'menu|v1|book',
      'cualquier-cosa',
    ];

    for (const id of ajenos) {
      expect(isAppointmentSelection(id)).toBe(false);
      expect(decodeAppointmentAction(id)).toBeNull();
    }
  });

  it('rechaza acciones desconocidas y versiones ajenas', () => {
    expect(decodeAppointmentAction('appt|v1|borrar|x')).toBeNull();
    expect(decodeAppointmentAction('appt|v2|cancel|x')).toBeNull();
    expect(decodeAppointmentAction('appt|v1')).toBeNull();
    expect(decodeAppointmentAction('appt|v1|cancel|x|extra')).toBeNull();
  });

  it('los ids entran en el límite de una fila de lista', () => {
    const id = encodeAppointmentAction(
      AppointmentAction.CANCEL_CONFIRM,
      APPOINTMENT_ID,
    );

    expect(id.length).toBeLessThanOrEqual(200);
  });
});

describe('buildSingleAppointmentPrompt', () => {
  it('ofrece reagendar, cancelar y sacar otro', () => {
    const prompt = buildSingleAppointmentPrompt(appointment(), TIMEZONE);

    expect(prompt.options.map((option) => option.title)).toEqual([
      'Reagendar',
      'Cancelar turno',
      'Sacar otro',
    ]);
  });

  it('entra en el máximo de botones de WhatsApp', () => {
    expect(
      buildSingleAppointmentPrompt(appointment(), TIMEZONE).options.length,
    ).toBeLessThanOrEqual(3);
  });

  it('muestra la cita en la zona del negocio', () => {
    const prompt = buildSingleAppointmentPrompt(appointment(), TIMEZONE);

    expect(prompt.body).toContain('Corte + Barba');
    expect(prompt.body).toContain('15:00');
    expect(prompt.body).toContain('Nico');
  });

  it('omite el profesional si no se conoce', () => {
    const prompt = buildSingleAppointmentPrompt(
      appointment({ staffName: null }),
      TIMEZONE,
    );

    expect(prompt.body).not.toContain('Con ');
  });
});

describe('buildAppointmentListPrompt', () => {
  function many(count: number): AppointmentSummary[] {
    return Array.from({ length: count }, (_, index) =>
      appointment({
        id: `${index}`.padStart(36, '0'),
        startTime: new Date(`2026-08-${21 + index}T19:00:00.000Z`),
      }),
    );
  }

  it('lista las citas y agrega la opción de sacar otro', () => {
    const prompt = buildAppointmentListPrompt(many(3), TIMEZONE);

    expect(prompt.options).toHaveLength(4);
    expect(prompt.options.at(-1)?.title).toBe('Sacar otro turno');
  });

  it('nunca supera las 10 filas de una lista', () => {
    const prompt = buildAppointmentListPrompt(many(20), TIMEZONE);

    expect(prompt.options.length).toBeLessThanOrEqual(10);
    expect(prompt.options).toHaveLength(MAX_LISTED_APPOINTMENTS + 1);
  });

  it('avisa cuando hay más citas de las que muestra', () => {
    // Recortar en silencio se leería como "solo tengo estos turnos".
    const prompt = buildAppointmentListPrompt(many(20), TIMEZONE);

    expect(prompt.body).toContain('20');
  });

  it('los títulos entran en el límite de una fila', () => {
    for (const option of buildAppointmentListPrompt(many(3), TIMEZONE)
      .options) {
      expect(option.title.length).toBeLessThanOrEqual(24);
    }
  });
});

describe('buildCancelConfirmPrompt', () => {
  it('pide confirmación antes de cancelar', () => {
    // Cancelar es destructivo y le libera el horario a otro cliente: no puede
    // quedar a un solo toque.
    const prompt = buildCancelConfirmPrompt(appointment(), TIMEZONE);

    expect(prompt.body).toContain('¿Seguro');
    expect(prompt.options.map((option) => option.title)).toEqual([
      'Sí, cancelar',
      'No, dejarlo',
    ]);
  });

  it('la confirmación arrastra la cita, no el paso anterior', () => {
    const prompt = buildCancelConfirmPrompt(appointment(), TIMEZONE);

    expect(decodeAppointmentAction(prompt.options[0].id)).toEqual({
      action: AppointmentAction.CANCEL_CONFIRM,
      appointmentId: APPOINTMENT_ID,
    });
  });
});
