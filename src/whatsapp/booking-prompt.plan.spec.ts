import type {
  BookingOption,
  BookingSummary,
} from '../booking-flow/booking-flow.types';
import { planBookingPrompt, planToTranscript } from './booking-prompt.plan';

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

describe('planBookingPrompt', () => {
  it('CONFIRM produce un solo mensaje con botones', () => {
    const plans = planBookingPrompt({
      kind: 'CONFIRM',
      summary: SUMMARY,
      options: [option('confirm', 'Confirmar'), option('cancel', 'Cancelar')],
    });

    expect(plans).toHaveLength(1);
    expect(plans[0].component).toBe('buttons');
  });

  it('un día sin cupo ofrece el desvío en vez de cortar el flujo', () => {
    const plans = planBookingPrompt({
      kind: 'ASK_SLOT',
      date: '2026-07-31',
      hasSlots: false,
      options: [
        option('otherdays', 'Ver otros días'),
        option('cancel', 'Cancelar'),
      ],
    });

    expect(plans).toHaveLength(1);
    expect(plans[0].body).toContain('No quedan horarios');
  });

  it('SLOT_TAKEN produce dos mensajes: aviso y lista', () => {
    const plans = planBookingPrompt({
      kind: 'SLOT_TAKEN',
      date: '2026-07-31',
      options: [option('2026-07-31T16:00:00.000Z', '16:00')],
    });

    expect(plans.map((plan) => plan.component)).toEqual(['text', 'list']);
  });

  it('FROZEN antepone el recordatorio al paso pendiente', () => {
    const plans = planBookingPrompt({
      kind: 'FROZEN',
      current: {
        kind: 'ASK_STAFF',
        options: [option('any', 'Sin preferencia')],
      },
    });

    expect(plans.map((plan) => plan.component)).toEqual(['text', 'list']);
    expect(plans[0].body).toContain('completando tu reserva');
  });

  it('NONE no produce ningún mensaje', () => {
    expect(planBookingPrompt({ kind: 'NONE' })).toEqual([]);
  });

  it('una lista sin opciones degrada a texto en vez de romper', () => {
    const plans = planBookingPrompt({ kind: 'ASK_DATE', options: [] });

    expect(plans).toHaveLength(1);
    expect(plans[0].component).toBe('text');
  });

  it('CONFIRM incluye el resumen en el cuerpo', () => {
    const plans = planBookingPrompt({
      kind: 'CONFIRM',
      summary: SUMMARY,
      options: [option('confirm', 'Confirmar')],
    });

    expect(plans[0].body).toContain('Corte + Barba');
    expect(plans[0].body).toContain('Nico');
    // 19:00 UTC son las 15:00 en La Paz.
    expect(plans[0].body).toContain('15:00');
  });

  it('una reserva nueva se anuncia como agendada', () => {
    const plans = planBookingPrompt({
      kind: 'COMPLETED',
      summary: SUMMARY,
      appointmentId: 'appt-1',
    });

    expect(plans[0].body).toContain('quedó agendado');
  });

  it('una reserva modificada se anuncia como cambiada', () => {
    // Decirle "tu turno quedó agendado" a quien acaba de mover el suyo suena a
    // que le agendaron un segundo.
    const plans = planBookingPrompt({
      kind: 'COMPLETED',
      summary: SUMMARY,
      appointmentId: 'appt-1',
      edited: true,
    });

    expect(plans[0].body).toContain('Cambié tu turno');
    expect(plans[0].body).not.toContain('quedó agendado');
  });
});

describe('planToTranscript', () => {
  it('un texto se registra tal cual', () => {
    const [plan] = planBookingPrompt({ kind: 'CANCELLED' });

    expect(planToTranscript(plan)).toBe(plan.body);
  });

  it('una lista registra también las opciones ofrecidas', () => {
    // Sin esto, el panel mostraría una pregunta sin respuestas posibles.
    const [plan] = planBookingPrompt({
      kind: 'ASK_STAFF',
      options: [
        option('nico', 'Nico'),
        option('ana', 'Ana'),
        option('any', 'Sin preferencia'),
        option('cancel', 'Cancelar'),
      ],
    });

    const transcript = planToTranscript(plan);

    // El cuerpo es copy editable; lo que fija el test es que las opciones
    // aparezcan en el registro.
    expect(transcript).toContain(plan.body);
    expect(transcript).toContain('Nico · Ana · Sin preferencia · Cancelar');
  });

  it('los botones también dejan constancia de las opciones', () => {
    const [plan] = planBookingPrompt({
      kind: 'CONFIRM',
      summary: SUMMARY,
      options: [option('confirm', 'Confirmar'), option('cancel', 'Cancelar')],
    });

    expect(planToTranscript(plan)).toContain('Confirmar · Cancelar');
  });
});

/**
 * Las tres pantallas del paso de horarios.
 *
 * Son el mismo paso y hasta acá decían lo mismo: elegir un rango devolvía otra
 * vez "estos son los horarios disponibles para el jueves 24" y parecía que el
 * flujo no había entendido nada.
 */
describe('el texto del paso de horarios', () => {
  const base = {
    kind: 'ASK_SLOT' as const,
    date: '2026-09-24',
    hasSlots: true,
    options: [option('2026-09-24T13:00:00.000Z', '09:00')],
  };

  const bodyOf = (prompt: Parameters<typeof planBookingPrompt>[0]) => {
    const [plan] = planBookingPrompt(prompt);
    return 'body' in plan ? plan.body : '';
  };

  it('el día completo se anuncia como siempre', () => {
    expect(bodyOf(base)).toBe(
      'Estos son los horarios disponibles para el jueves, 24 de septiembre.',
    );
  });

  it('dentro de un rango dice entre qué horas, y no repite la fecha', () => {
    const body = bodyOf({
      ...base,
      range: { from: '09:45', to: '11:15' },
    });

    expect(body).toBe('Elegí un horario entre las 09:45 y las 11:15.');
    expect(body).not.toContain('septiembre');
  });

  /*
   * Son el mismo paso: si dicen lo mismo, elegir un rato se siente como no haber
   * avanzado.
   */
  it('las dos pantallas dicen cosas distintas', () => {
    expect(bodyOf(base)).not.toBe(
      bodyOf({ ...base, range: { from: '09:45', to: '11:15' } }),
    );
  });

  it('un día sin cupo manda sobre cualquier otra cosa', () => {
    const body = bodyOf({
      ...base,
      hasSlots: false,
      range: { from: '09:45', to: '11:15' },
    });

    expect(body).toContain('No quedan horarios');
  });
});
