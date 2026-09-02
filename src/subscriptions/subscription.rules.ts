/**
 * Estado de la suscripción de un negocio.
 *
 * Todo acá es puro: el estado se **deriva** de lo guardado más la hora actual, y
 * no de que un proceso haya pasado a marcar vencimientos. Un cron que marque
 * expirados es una fuente de verdad que puede atrasarse, y mientras se atrasa un
 * negocio sigue teniendo acceso que ya no le corresponde.
 */

/**
 * Duración de la prueba gratuita, en días.
 *
 * Constante y no un número suelto en el código que arranca el trial: es una
 * decisión comercial y va a cambiar. Vive acá para que se lea en el mismo lugar
 * donde se calcula el vencimiento.
 */
export const TRIAL_DURATION_DAYS = 7;

/**
 * Lo que se guarda en la base.
 *
 * `NONE` es el estado de un negocio que todavía no probó Polaria: existe, se
 * está configurando, y su prueba no empezó. Hace falta como valor propio porque
 * "sin trial todavía" y "trial vencido" habilitan cosas distintas.
 */
export enum SubscriptionStatus {
  NONE = 'NONE',
  TRIAL = 'TRIAL',
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  CANCELED = 'CANCELED',
}

/**
 * Lo que se responde.
 *
 * Se separa de lo guardado por la misma razón que en la plantilla de
 * recordatorios: `TRIAL` guardado puede significar prueba en curso o prueba
 * vencida según la hora, y obligar a cada consumidor a hacer esa cuenta es
 * garantizar que alguno la haga mal.
 */
export enum SubscriptionState {
  /** No empezó la prueba. */
  NOT_STARTED = 'NOT_STARTED',
  TRIAL_ACTIVE = 'TRIAL_ACTIVE',
  TRIAL_EXPIRED = 'TRIAL_EXPIRED',
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  CANCELED = 'CANCELED',
}

export type SubscriptionSnapshot = {
  subscriptionStatus: string | null;
  trialEndsAt: Date | null;
};

export type ResolvedSubscription = {
  state: SubscriptionState;
  /** Días completos que faltan, solo durante la prueba en curso. */
  trialDaysRemaining: number | null;
  /** Si el negocio tiene acceso al producto ahora mismo. */
  hasAccess: boolean;
};

/** Fin de la prueba a partir de su inicio. */
export function trialEndsAt(startedAt: Date): Date {
  return addDays(startedAt, TRIAL_DURATION_DAYS);
}

/**
 * Las extensiones que soporte puede dar, en días.
 *
 * Una lista cerrada y no un número libre: es una decisión comercial que se toma
 * en un puñado de tamaños, y un campo abierto habilita tipear 700 días —o −7—
 * en una pantalla que regala producto.
 */
export const TRIAL_EXTENSION_DAYS = [7, 14, 30] as const;

/**
 * Lo que hace falta saber del negocio para extenderle la prueba.
 *
 * Aparte de `SubscriptionSnapshot`, que es el que decide el acceso, aunque se
 * parezcan: aquél no necesita `trialStartedAt` y no tiene por qué crecer para
 * que esto exista. Son dos preguntas distintas sobre las mismas columnas.
 */
export type TrialExtensionInput = {
  subscriptionStatus: string | null;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
};

export type TrialExtension =
  | {
      granted: true;
      /** El vencimiento nuevo. */
      trialEndsAt: Date;
      /** Cuándo empezó a probar. Se conserva el original si ya había uno. */
      trialStartedAt: Date;
    }
  | { granted: false; reason: 'PAID_SUBSCRIPTION' | 'INVALID_DAYS' };

/**
 * Si tiene sentido ofrecerle una extensión a este negocio.
 *
 * Sólo el que ya paga queda afuera: extenderle una prueba lo bajaría de
 * categoría, que es exactamente lo contrario de lo que quiere quien aprieta el
 * botón. Todos los demás estados —incluida una prueba vencida hace meses, o un
 * negocio que nunca la arrancó— son casos legítimos de soporte.
 *
 * Se exporta para que el panel pinte el botón con la misma regla que lo aplica:
 * un botón habilitado que el backend después rechaza es peor que uno gris.
 */
export function canExtendTrial(subscriptionStatus: string | null): boolean {
  return subscriptionStatus !== SubscriptionStatus.ACTIVE;
}

/**
 * Le da más prueba a un negocio.
 *
 * Se suma **al vencimiento vigente** y no a hoy: extender el jueves una prueba
 * que vence el domingo tiene que dejar diez días, no siete. Con la prueba ya
 * vencida no queda nada que preservar y el reloj arranca ahora, que es lo que
 * convierte esto en la forma de revivir una prueba muerta.
 *
 * El inicio real no se reescribe. Es el dato de cuándo este negocio empezó a
 * probar Polaria, y pisarlo en cada extensión borraría la única forma de
 * saberlo. Se escribe sólo cuando no hay ninguno, que es el negocio al que
 * soporte le arranca la prueba a mano; a partir de ahí `startTrial` deja de
 * tocarlo —su condición es `trialStartedAt IS NULL`—, así que conectar WhatsApp
 * más tarde no le regala días nuevos ni reinicia el reloj.
 *
 * Rechaza los días inválidos en lugar de confiar en el validador de la ruta: un
 * número negativo acá no extendería nada, **acortaría** la prueba, y esta
 * función no puede tener una forma de hacer lo contrario de lo que dice.
 */
export function extendTrial(
  input: TrialExtensionInput,
  days: number,
  now: Date,
): TrialExtension {
  if (!Number.isInteger(days) || days <= 0) {
    return { granted: false, reason: 'INVALID_DAYS' };
  }

  if (!canExtendTrial(input.subscriptionStatus)) {
    return { granted: false, reason: 'PAID_SUBSCRIPTION' };
  }

  const ongoing =
    input.subscriptionStatus === SubscriptionStatus.TRIAL &&
    input.trialEndsAt !== null &&
    input.trialEndsAt > now;

  return {
    granted: true,
    trialEndsAt: addDays(ongoing ? (input.trialEndsAt as Date) : now, days),
    trialStartedAt: input.trialStartedAt ?? now,
  };
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

export function resolveSubscription(
  snapshot: SubscriptionSnapshot,
  now: Date,
): ResolvedSubscription {
  switch (snapshot.subscriptionStatus) {
    case SubscriptionStatus.TRIAL: {
      // Sin fecha de fin no se puede decidir. Se trata como vencida en lugar de
      // dar acceso indefinido: un dato faltante no debería regalar producto.
      if (!snapshot.trialEndsAt) {
        return notStarted(SubscriptionState.TRIAL_EXPIRED, false);
      }

      if (now >= snapshot.trialEndsAt) {
        return notStarted(SubscriptionState.TRIAL_EXPIRED, false);
      }

      const msRemaining = snapshot.trialEndsAt.getTime() - now.getTime();
      return {
        state: SubscriptionState.TRIAL_ACTIVE,
        // Hacia arriba: quedando 6 horas, al negocio le queda "1 día", no 0.
        trialDaysRemaining: Math.ceil(msRemaining / (24 * 60 * 60 * 1000)),
        hasAccess: true,
      };
    }

    case SubscriptionStatus.ACTIVE:
      return notStarted(SubscriptionState.ACTIVE, true);

    case SubscriptionStatus.EXPIRED:
      return notStarted(SubscriptionState.EXPIRED, false);

    case SubscriptionStatus.CANCELED:
      return notStarted(SubscriptionState.CANCELED, false);

    default:
      /*
       * Sin prueba iniciada **hay acceso**.
       *
       * Es el negocio que se acaba de registrar y está configurándose: negarle
       * el panel sería impedirle llegar al punto en que la prueba arranca. Y no
       * es una puerta abierta, porque sin WhatsApp conectado no hay nada que
       * Polaria pueda hacer por él todavía.
       */
      return notStarted(SubscriptionState.NOT_STARTED, true);
  }
}

function notStarted(
  state: SubscriptionState,
  hasAccess: boolean,
): ResolvedSubscription {
  return { state, trialDaysRemaining: null, hasAccess };
}
