import {
  canExtendTrial,
  extendTrial,
  paySubscription,
  resolveSubscription,
  SUBSCRIPTION_MONTHS,
  SubscriptionState,
  SubscriptionStatus,
  TRIAL_DURATION_DAYS,
  trialEndsAt,
} from './subscription.rules';
import type { SubscriptionSnapshot } from './subscription.rules';

const NOW = new Date('2026-08-21T12:00:00.000Z');
const inHours = (hours: number) =>
  new Date(NOW.getTime() + hours * 60 * 60 * 1000);

/** Un negocio con los dos relojes en cero, salvo lo que cada caso cambie. */
const snapshot = (overrides: Partial<SubscriptionSnapshot> = {}) => ({
  subscriptionStatus: SubscriptionStatus.NONE as string | null,
  trialEndsAt: null,
  subscriptionEndsAt: null,
  ...overrides,
});

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
        snapshot({ subscriptionStatus: SubscriptionStatus.NONE }),
        NOW,
      ),
    ).toEqual({
      state: SubscriptionState.NOT_STARTED,
      daysRemaining: null,
      hasAccess: true,
    });
  });

  it('trata un estado ausente como prueba no iniciada', () => {
    expect(
      resolveSubscription(snapshot({ subscriptionStatus: null }), NOW).state,
    ).toBe(SubscriptionState.NOT_STARTED);
  });

  it('durante la prueba informa los días que faltan', () => {
    const resolved = resolveSubscription(
      snapshot({
        subscriptionStatus: SubscriptionStatus.TRIAL,
        trialEndsAt: inHours(48),
      }),
      NOW,
    );

    expect(resolved.state).toBe(SubscriptionState.TRIAL_ACTIVE);
    expect(resolved.daysRemaining).toBe(2);
    expect(resolved.hasAccess).toBe(true);
  });

  it('redondea hacia arriba los días restantes', () => {
    // Quedando 6 horas, al negocio le queda "1 día", no 0.
    const resolved = resolveSubscription(
      snapshot({
        subscriptionStatus: SubscriptionStatus.TRIAL,
        trialEndsAt: inHours(6),
      }),
      NOW,
    );

    expect(resolved.daysRemaining).toBe(1);
  });

  it('la prueba vence sin que nadie la marque', () => {
    // Es el punto del diseño: no hace falta un cron para que expire.
    const resolved = resolveSubscription(
      snapshot({
        subscriptionStatus: SubscriptionStatus.TRIAL,
        trialEndsAt: inHours(-1),
      }),
      NOW,
    );

    expect(resolved.state).toBe(SubscriptionState.TRIAL_EXPIRED);
    expect(resolved.hasAccess).toBe(false);
  });

  it('el instante exacto del vencimiento ya está vencido', () => {
    const resolved = resolveSubscription(
      snapshot({
        subscriptionStatus: SubscriptionStatus.TRIAL,
        trialEndsAt: NOW,
      }),
      NOW,
    );

    expect(resolved.state).toBe(SubscriptionState.TRIAL_EXPIRED);
  });

  it('una prueba sin fecha de fin no regala acceso', () => {
    const resolved = resolveSubscription(
      snapshot({ subscriptionStatus: SubscriptionStatus.TRIAL }),
      NOW,
    );

    expect(resolved.state).toBe(SubscriptionState.TRIAL_EXPIRED);
    expect(resolved.hasAccess).toBe(false);
  });

  it('distingue los estados de pago', () => {
    const cases: Array<[SubscriptionStatus, SubscriptionState, boolean]> = [
      [SubscriptionStatus.EXPIRED, SubscriptionState.EXPIRED, false],
      [SubscriptionStatus.CANCELED, SubscriptionState.CANCELED, false],
    ];

    for (const [status, state, hasAccess] of cases) {
      const resolved = resolveSubscription(
        snapshot({ subscriptionStatus: status }),
        NOW,
      );
      expect(resolved.state).toBe(state);
      expect(resolved.hasAccess).toBe(hasAccess);
    }
  });

  it('con la suscripción paga informa los días que faltan', () => {
    const resolved = resolveSubscription(
      snapshot({
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        subscriptionEndsAt: inHours(72),
      }),
      NOW,
    );

    expect(resolved.state).toBe(SubscriptionState.ACTIVE);
    expect(resolved.daysRemaining).toBe(3);
    expect(resolved.hasAccess).toBe(true);
  });

  it('la suscripción paga vence sin que nadie la marque', () => {
    const resolved = resolveSubscription(
      snapshot({
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        subscriptionEndsAt: inHours(-1),
      }),
      NOW,
    );

    expect(resolved.state).toBe(SubscriptionState.EXPIRED);
    expect(resolved.daysRemaining).toBeNull();
    expect(resolved.hasAccess).toBe(false);
  });

  it('una suscripción paga sin fecha de fin no da acceso para siempre', () => {
    const resolved = resolveSubscription(
      snapshot({ subscriptionStatus: SubscriptionStatus.ACTIVE }),
      NOW,
    );

    expect(resolved.state).toBe(SubscriptionState.EXPIRED);
    expect(resolved.hasAccess).toBe(false);
  });

  it('la prueba vencida no revive porque después se haya pagado', () => {
    // Los dos relojes conviven: manda el estado guardado, no la fecha mayor.
    const resolved = resolveSubscription(
      snapshot({
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        trialEndsAt: inHours(-100),
        subscriptionEndsAt: inHours(240),
      }),
      NOW,
    );

    expect(resolved.state).toBe(SubscriptionState.ACTIVE);
    expect(resolved.daysRemaining).toBe(10);
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

describe('paySubscription', () => {
  const paid = (
    months: number,
    overrides: Parameters<typeof snapshot>[0] = {},
    now: Date = NOW,
  ) =>
    paySubscription(
      {
        subscriptionStatus: snapshot(overrides).subscriptionStatus,
        subscriptionEndsAt: snapshot(overrides).subscriptionEndsAt,
      },
      months,
      now,
    );

  it('da de alta desde hoy al negocio que nunca pagó', () => {
    const outcome = paid(1);

    expect(outcome).toEqual({
      granted: true,
      subscriptionEndsAt: new Date('2026-09-21T12:00:00.000Z'),
    });
  });

  it('suma al vencimiento vigente, no a hoy', () => {
    // Renovar antes de tiempo no puede perder los días que quedaban.
    const outcome = paid(3, {
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      subscriptionEndsAt: new Date('2026-09-10T12:00:00.000Z'),
    });

    expect(outcome).toEqual({
      granted: true,
      subscriptionEndsAt: new Date('2026-12-10T12:00:00.000Z'),
    });
  });

  it('con la suscripción vencida el reloj arranca hoy', () => {
    const outcome = paid(1, {
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      subscriptionEndsAt: new Date('2026-07-01T12:00:00.000Z'),
    });

    expect(outcome).toEqual({
      granted: true,
      subscriptionEndsAt: new Date('2026-09-21T12:00:00.000Z'),
    });
  });

  it('no arrastra la fecha de un estado que no es pago', () => {
    // Un `subscriptionEndsAt` viejo bajo `CANCELED` no cubre nada: se cobra
    // desde hoy, como si nunca hubiera pagado.
    const outcome = paid(1, {
      subscriptionStatus: SubscriptionStatus.CANCELED,
      subscriptionEndsAt: new Date('2027-01-01T12:00:00.000Z'),
    });

    expect(outcome).toEqual({
      granted: true,
      subscriptionEndsAt: new Date('2026-09-21T12:00:00.000Z'),
    });
  });

  it('cobra meses de calendario, no bloques de treinta días', () => {
    const outcome = paid(12, {}, new Date('2026-02-14T12:00:00.000Z'));

    expect(outcome).toEqual({
      granted: true,
      subscriptionEndsAt: new Date('2027-02-14T12:00:00.000Z'),
    });
  });

  it('recorta al último día del mes cuando el día no existe', () => {
    // 31 de enero más un mes no existe: sin recorte, JavaScript desbordaría al
    // 3 de marzo y el negocio se quedaría con días que nadie le cobró.
    const outcome = paid(1, {}, new Date('2026-01-31T12:00:00.000Z'));

    expect(outcome).toEqual({
      granted: true,
      subscriptionEndsAt: new Date('2026-02-28T12:00:00.000Z'),
    });
  });

  it('se niega con meses que acortarían la suscripción', () => {
    for (const months of [0, -1, 1.5]) {
      expect(paid(months)).toEqual({
        granted: false,
        reason: 'INVALID_MONTHS',
      });
    }
  });

  it('todos los plazos que se ofrecen son cobrables', () => {
    for (const months of SUBSCRIPTION_MONTHS) {
      expect(paid(months).granted).toBe(true);
    }
  });
});
