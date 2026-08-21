import {
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
