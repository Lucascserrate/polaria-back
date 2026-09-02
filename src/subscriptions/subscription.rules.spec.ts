import {
  canExtendTrial,
  extendTrial,
  resolveSubscription,
  SubscriptionState,
  SubscriptionStatus,
  TRIAL_DURATION_DAYS,
  trialEndsAt,
} from './subscription.rules';

const NOW = new Date('2026-08-21T12:00:00.000Z');
const inHours = (hours: number) =>
  new Date(NOW.getTime() + hours * 60 * 60 * 1000);

describe('trialEndsAt', () => {
  it('dura los días configurados', () => {
    const end = trialEndsAt(NOW);
    const days = (end.getTime() - NOW.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(TRIAL_DURATION_DAYS);
  });
});

describe('resolveSubscription', () => {
  it('sin prueba iniciada da acceso: el negocio se está configurando', () => {
    expect(
      resolveSubscription(
        { subscriptionStatus: SubscriptionStatus.NONE, trialEndsAt: null },
        NOW,
      ),
    ).toEqual({
      state: SubscriptionState.NOT_STARTED,
      trialDaysRemaining: null,
      hasAccess: true,
    });
  });

  it('trata un estado ausente como prueba no iniciada', () => {
    expect(
      resolveSubscription({ subscriptionStatus: null, trialEndsAt: null }, NOW)
        .state,
    ).toBe(SubscriptionState.NOT_STARTED);
  });

  it('durante la prueba informa los días que faltan', () => {
    const resolved = resolveSubscription(
      {
        subscriptionStatus: SubscriptionStatus.TRIAL,
        trialEndsAt: inHours(48),
      },
      NOW,
    );

    expect(resolved.state).toBe(SubscriptionState.TRIAL_ACTIVE);
    expect(resolved.trialDaysRemaining).toBe(2);
    expect(resolved.hasAccess).toBe(true);
  });

  it('redondea hacia arriba los días restantes', () => {
    // Quedando 6 horas, al negocio le queda "1 día", no 0.
    const resolved = resolveSubscription(
      { subscriptionStatus: SubscriptionStatus.TRIAL, trialEndsAt: inHours(6) },
      NOW,
    );

    expect(resolved.trialDaysRemaining).toBe(1);
  });

  it('la prueba vence sin que nadie la marque', () => {
    // Es el punto del diseño: no hace falta un cron para que expire.
    const resolved = resolveSubscription(
      {
        subscriptionStatus: SubscriptionStatus.TRIAL,
        trialEndsAt: inHours(-1),
      },
      NOW,
    );

    expect(resolved.state).toBe(SubscriptionState.TRIAL_EXPIRED);
    expect(resolved.hasAccess).toBe(false);
  });

  it('el instante exacto del vencimiento ya está vencido', () => {
    const resolved = resolveSubscription(
      { subscriptionStatus: SubscriptionStatus.TRIAL, trialEndsAt: NOW },
      NOW,
    );

    expect(resolved.state).toBe(SubscriptionState.TRIAL_EXPIRED);
  });

  it('una prueba sin fecha de fin no regala acceso', () => {
    const resolved = resolveSubscription(
      { subscriptionStatus: SubscriptionStatus.TRIAL, trialEndsAt: null },
      NOW,
    );

    expect(resolved.state).toBe(SubscriptionState.TRIAL_EXPIRED);
    expect(resolved.hasAccess).toBe(false);
  });

  it('distingue los estados de pago', () => {
    const cases: Array<[SubscriptionStatus, SubscriptionState, boolean]> = [
      [SubscriptionStatus.ACTIVE, SubscriptionState.ACTIVE, true],
      [SubscriptionStatus.EXPIRED, SubscriptionState.EXPIRED, false],
      [SubscriptionStatus.CANCELED, SubscriptionState.CANCELED, false],
    ];

    for (const [status, state, hasAccess] of cases) {
      const resolved = resolveSubscription(
        { subscriptionStatus: status, trialEndsAt: null },
        NOW,
      );
      expect(resolved.state).toBe(state);
      expect(resolved.hasAccess).toBe(hasAccess);
    }
  });
});

describe('canExtendTrial', () => {
  it('sólo deja afuera al negocio que ya paga', () => {
    expect(canExtendTrial(SubscriptionStatus.ACTIVE)).toBe(false);

    for (const status of [
      SubscriptionStatus.NONE,
      SubscriptionStatus.TRIAL,
      SubscriptionStatus.EXPIRED,
      SubscriptionStatus.CANCELED,
      null,
    ]) {
      expect(canExtendTrial(status)).toBe(true);
    }
  });
});

describe('extendTrial', () => {
  const daysBetween = (from: Date, to: Date) =>
    (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);

  it('suma al vencimiento vigente, no a hoy', () => {
    // Extender el jueves una prueba que vence el domingo deja diez días, no
    // siete: los tres que le quedaban no se pierden por pedir la extensión
    // antes de tiempo.
    const endsAt = inHours(72);

    const outcome = extendTrial(
      {
        subscriptionStatus: SubscriptionStatus.TRIAL,
        trialStartedAt: inHours(-96),
        trialEndsAt: endsAt,
      },
      7,
      NOW,
    );

    expect(outcome.granted).toBe(true);
    if (!outcome.granted) return;
    expect(daysBetween(endsAt, outcome.trialEndsAt)).toBe(7);
    expect(daysBetween(NOW, outcome.trialEndsAt)).toBe(10);
  });

  it('revive una prueba vencida contando desde hoy', () => {
    const outcome = extendTrial(
      {
        subscriptionStatus: SubscriptionStatus.TRIAL,
        trialStartedAt: inHours(-24 * 30),
        trialEndsAt: inHours(-24 * 23),
      },
      7,
      NOW,
    );

    expect(outcome.granted).toBe(true);
    if (!outcome.granted) return;
    // Y no siete días después de un vencimiento que ya pasó, que dejaría la
    // prueba revivida y vencida a la vez.
    expect(daysBetween(NOW, outcome.trialEndsAt)).toBe(7);
  });

  it('conserva el inicio real de la prueba', () => {
    const startedAt = inHours(-24 * 30);

    const outcome = extendTrial(
      {
        subscriptionStatus: SubscriptionStatus.TRIAL,
        trialStartedAt: startedAt,
        trialEndsAt: inHours(24),
      },
      14,
      NOW,
    );

    expect(outcome.granted).toBe(true);
    if (!outcome.granted) return;
    expect(outcome.trialStartedAt).toEqual(startedAt);
  });

  it('le arranca la prueba al negocio que nunca la inició', () => {
    const outcome = extendTrial(
      {
        subscriptionStatus: SubscriptionStatus.NONE,
        trialStartedAt: null,
        trialEndsAt: null,
      },
      7,
      NOW,
    );

    expect(outcome.granted).toBe(true);
    if (!outcome.granted) return;
    // El inicio se escribe acá: a partir de ahora `startTrial` no lo toca, así
    // que conectar WhatsApp más tarde no reinicia el reloj.
    expect(outcome.trialStartedAt).toEqual(NOW);
    expect(daysBetween(NOW, outcome.trialEndsAt)).toBe(7);
  });

  it('se niega con una suscripción paga', () => {
    const outcome = extendTrial(
      {
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        trialStartedAt: inHours(-24 * 30),
        trialEndsAt: inHours(-24 * 23),
      },
      7,
      NOW,
    );

    expect(outcome).toEqual({ granted: false, reason: 'PAID_SUBSCRIPTION' });
  });

  it('se niega con días que acortarían la prueba', () => {
    // Es lo contrario de lo que dice el nombre, así que no puede tener forma de
    // ocurrir aunque el validador de la ruta falle.
    for (const days of [0, -7, 1.5]) {
      expect(
        extendTrial(
          {
            subscriptionStatus: SubscriptionStatus.TRIAL,
            trialStartedAt: inHours(-24),
            trialEndsAt: inHours(24),
          },
          days,
          NOW,
        ),
      ).toEqual({ granted: false, reason: 'INVALID_DAYS' });
    }
  });
});
