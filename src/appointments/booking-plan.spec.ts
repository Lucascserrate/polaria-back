import { planBookingSegments } from './booking-plan';

const START = new Date('2026-08-24T13:00:00.000Z');

const services = new Map([
  ['corte', { durationMinutes: 30, price: 50, currency: 'BOB' }],
  ['barba', { durationMinutes: 30, price: 40, currency: 'BOB' }],
  // En dólares a propósito: un catálogo puede cobrar en dos monedas.
  ['online', { durationMinutes: 20, price: 25, currency: 'USD' }],
  ['cejas', { durationMinutes: 20, price: 25, currency: 'BOB' }],
]);

describe('planBookingSegments', () => {
  it('encadena los tramos uno detrás del otro', () => {
    const plan = planBookingSegments({
      startTime: START,
      items: [
        { serviceId: 'corte', staffId: 'diego' },
        { serviceId: 'barba', staffId: 'carlos' },
      ],
      services,
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    expect(plan.segments[0].startTime.toISOString()).toBe(
      '2026-08-24T13:00:00.000Z',
    );
    expect(plan.segments[0].endTime.toISOString()).toBe(
      '2026-08-24T13:30:00.000Z',
    );
    // El segundo arranca donde termina el primero: sin hueco y sin pisarse.
    expect(plan.segments[1].startTime.toISOString()).toBe(
      '2026-08-24T13:30:00.000Z',
    );
    expect(plan.endTime.toISOString()).toBe('2026-08-24T14:00:00.000Z');
  });

  it('conserva el profesional de cada servicio', () => {
    const plan = planBookingSegments({
      startTime: START,
      items: [
        { serviceId: 'corte', staffId: 'diego' },
        { serviceId: 'barba', staffId: 'carlos' },
      ],
      services,
    });

    if (!plan.ok) throw new Error('debía planificar');
    expect(plan.segments.map((s) => s.staffId)).toEqual(['diego', 'carlos']);
  });

  it('respeta el orden recibido y lo deja numerado', () => {
    // El orden es dato: invertirlo cambia a qué hora atiende cada profesional.
    const plan = planBookingSegments({
      startTime: START,
      items: [
        { serviceId: 'barba', staffId: 'carlos' },
        { serviceId: 'corte', staffId: 'diego' },
      ],
      services,
    });

    if (!plan.ok) throw new Error('debía planificar');
    expect(plan.segments.map((s) => s.serviceId)).toEqual(['barba', 'corte']);
    expect(plan.segments.map((s) => s.sequenceOrder)).toEqual([0, 1]);
  });

  it('suma duraciones distintas', () => {
    const plan = planBookingSegments({
      startTime: START,
      items: [
        { serviceId: 'cejas', staffId: 'diego' },
        { serviceId: 'corte', staffId: 'diego' },
      ],
      services,
    });

    if (!plan.ok) throw new Error('debía planificar');
    expect(plan.endTime.toISOString()).toBe('2026-08-24T13:50:00.000Z');
  });

  it('conserva el precio ya pactado de un servicio que la reserva tenía', () => {
    // `priceAtBooking` es literal: corregir la hora no puede re-cotizar lo que el
    // cliente ya tenía acordado.
    const plan = planBookingSegments({
      startTime: START,
      items: [{ serviceId: 'corte', staffId: 'diego' }],
      services,
      agreedPrices: new Map([['corte', { price: 45, currency: 'BOB' }]]),
    });

    if (!plan.ok) throw new Error('debía planificar');
    expect(plan.segments[0].price).toBe(45);
  });

  it('cobra el precio de hoy en un servicio que se agrega', () => {
    const plan = planBookingSegments({
      startTime: START,
      items: [
        { serviceId: 'corte', staffId: 'diego' },
        { serviceId: 'barba', staffId: 'diego' },
      ],
      services,
      agreedPrices: new Map([['corte', { price: 45, currency: 'BOB' }]]),
    });

    if (!plan.ok) throw new Error('debía planificar');
    expect(plan.segments.map((s) => s.price)).toEqual([45, 40]);
  });

  it('cada tramo lleva la moneda de su servicio', () => {
    // Un precio sin su moneda no es un precio: la psicóloga cobra la presencial
    // en bolivianos y la online en dólares, en la misma reserva si hace falta.
    const plan = planBookingSegments({
      startTime: START,
      items: [
        { serviceId: 'corte', staffId: 'diego' },
        { serviceId: 'online', staffId: 'diego' },
      ],
      services,
    });

    if (!plan.ok) throw new Error('debía planificar');
    expect(plan.segments.map((s) => s.currency)).toEqual(['BOB', 'USD']);
  });

  it('conserva la moneda pactada aunque el servicio haya cambiado de moneda', () => {
    // Pasar un servicio de bolivianos a dólares no puede reescribir lo que un
    // cliente ya tenía acordado: eso convertiría Bs 300 en USD 300.
    const plan = planBookingSegments({
      startTime: START,
      items: [{ serviceId: 'online', staffId: 'diego' }],
      services,
      agreedPrices: new Map([['online', { price: 300, currency: 'BOB' }]]),
    });

    if (!plan.ok) throw new Error('debía planificar');
    expect(plan.segments[0].price).toBe(300);
    expect(plan.segments[0].currency).toBe('BOB');
  });

  it('usa siempre la duración vigente, incluso con precio conservado', () => {
    // Sostener una duración vieja dejaría la agenda diciendo una cosa y la
    // disponibilidad otra.
    const plan = planBookingSegments({
      startTime: START,
      items: [{ serviceId: 'corte', staffId: 'diego' }],
      services: new Map([
        ['corte', { durationMinutes: 45, price: 60, currency: 'BOB' }],
      ]),
      agreedPrices: new Map([['corte', { price: 50, currency: 'BOB' }]]),
    });

    if (!plan.ok) throw new Error('debía planificar');
    expect(plan.segments[0].durationMinutes).toBe(45);
    expect(plan.segments[0].price).toBe(50);
    expect(plan.endTime.toISOString()).toBe('2026-08-24T13:45:00.000Z');
  });

  it('avisa qué servicio no existe en lugar de planificar a medias', () => {
    const plan = planBookingSegments({
      startTime: START,
      items: [
        { serviceId: 'corte', staffId: 'diego' },
        { serviceId: 'fantasma', staffId: 'diego' },
      ],
      services,
    });

    expect(plan).toEqual({ ok: false, missingServiceIds: ['fantasma'] });
  });

  it('trata como faltante un servicio sin duración', () => {
    // Duración 0 encadenaría dos tramos en el mismo instante y el índice único
    // los rechazaría con un error que no explica nada.
    const plan = planBookingSegments({
      startTime: START,
      items: [{ serviceId: 'roto', staffId: 'diego' }],
      services: new Map([
        ['roto', { durationMinutes: 0, price: 10, currency: 'BOB' }],
      ]),
    });

    expect(plan).toEqual({ ok: false, missingServiceIds: ['roto'] });
  });

  it('un solo servicio termina cuando termina su duración', () => {
    const plan = planBookingSegments({
      startTime: START,
      items: [{ serviceId: 'corte', staffId: 'diego' }],
      services,
    });

    if (!plan.ok) throw new Error('debía planificar');
    expect(plan.segments).toHaveLength(1);
    expect(plan.endTime.toISOString()).toBe('2026-08-24T13:30:00.000Z');
  });
});
