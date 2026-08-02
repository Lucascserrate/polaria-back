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
  it('ASK_WHEN produce un solo mensaje con botones', () => {
    const plans = planBookingPrompt({
      kind: 'ASK_WHEN',
      options: [option('today', 'Hoy'), option('cancel', 'Cancelar')],
    });

    expect(plans).toHaveLength(1);
    expect(plans[0].component).toBe('buttons');
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
      kind: 'ASK_WHEN',
      options: [
        option('today', 'Hoy'),
        option('other', 'Otro día'),
        option('cancel', 'Cancelar'),
      ],
    });

    expect(planToTranscript(plan)).toContain('Hoy · Otro día · Cancelar');
  });
});
