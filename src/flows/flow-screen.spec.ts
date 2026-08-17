import {
  buildBookingScreen,
  buildPingResponse,
  buildSummaryScreen,
  buildTerminalResponse,
  emptyBookingScreen,
  FLOW_DATA_API_VERSION,
  FLOW_SCREENS,
} from './flow-screen';

/** Campos que `booking-flow.json` declara para la pantalla de selección. */
const BOOKING_FIELDS = [
  'services',
  'staff',
  'is_staff_enabled',
  'dates',
  'is_date_enabled',
  'slots',
  'is_slot_enabled',
  'has_error',
  'error_message',
];

const SUMMARY_FIELDS = ['summary', 'service', 'staff', 'date', 'slot'];

const OPTION = { id: 'uuid', title: 'Corte — Bs 80' };

describe('respuestas del endpoint', () => {
  it('siempre llevan la versión del protocolo', () => {
    // Sin `version` el Flow falla en silencio y muestra la pantalla vacía.
    const respuestas = [
      buildPingResponse(),
      emptyBookingScreen([OPTION]),
      buildTerminalResponse('tok', { status: 'completed' }),
    ];

    for (const respuesta of respuestas) {
      expect(respuesta.version).toBe(FLOW_DATA_API_VERSION);
    }
  });
});

describe('buildBookingScreen', () => {
  it('manda todos los campos que declara la pantalla, incluso los vacíos', () => {
    // Meta descarta lo que no venga declarado y la pantalla se rompe.
    const screen = buildBookingScreen({
      services: [OPTION],
      staff: [],
      isStaffEnabled: false,
      dates: [],
      isDateEnabled: false,
      slots: [],
      isSlotEnabled: false,
    });

    expect(Object.keys(screen.data).sort()).toEqual([...BOOKING_FIELDS].sort());
    expect(screen.screen).toBe(FLOW_SCREENS.BOOKING);
  });

  it('deriva has_error del mensaje, para no tener que sincronizar dos campos', () => {
    const sinError = buildBookingScreen({
      services: [OPTION],
      staff: [],
      isStaffEnabled: false,
      dates: [],
      isDateEnabled: false,
      slots: [],
      isSlotEnabled: false,
    });
    expect(sinError.data.has_error).toBe(false);
    expect(sinError.data.error_message).toBe('');

    const conError = buildBookingScreen({
      services: [OPTION],
      staff: [],
      isStaffEnabled: false,
      dates: [],
      isDateEnabled: false,
      slots: [],
      isSlotEnabled: false,
      errorMessage: 'Ese horario ya no está disponible.',
    });
    expect(conError.data.has_error).toBe(true);
  });

  it('la pantalla inicial deja habilitados solo los servicios', () => {
    const screen = emptyBookingScreen([OPTION]);

    expect(screen.data.is_staff_enabled).toBe(false);
    expect(screen.data.is_date_enabled).toBe(false);
    expect(screen.data.is_slot_enabled).toBe(false);
    expect(screen.data.services).toEqual([OPTION]);
  });
});

describe('buildSummaryScreen', () => {
  it('arrastra las cuatro selecciones que el pie devuelve al confirmar', () => {
    const screen = buildSummaryScreen({
      summary: 'Corte\nHoy\n10:00',
      service: 'service-uuid',
      staff: 'any',
      date: '2026-08-02',
      slot: '2026-08-02T14:00:00.000Z',
    });

    expect(Object.keys(screen.data).sort()).toEqual([...SUMMARY_FIELDS].sort());
    expect(screen.screen).toBe(FLOW_SCREENS.SUMMARY);
  });
});

describe('buildTerminalResponse', () => {
  it('devuelve el desenlace al chat dentro de extension_message_response', () => {
    // Es la única vía por la que el webhook se entera de cómo terminó el Flow.
    const screen = buildTerminalResponse('tok_123', {
      status: 'completed',
      appointment_id: 'appt-1',
    });

    expect(screen.screen).toBe(FLOW_SCREENS.SUCCESS);
    expect(screen.data).toEqual({
      extension_message_response: {
        params: {
          flow_token: 'tok_123',
          status: 'completed',
          appointment_id: 'appt-1',
        },
      },
    });
  });
});

describe('buildPingResponse', () => {
  it('responde el health check como espera Meta', () => {
    expect(buildPingResponse().data).toEqual({ status: 'active' });
  });
});
