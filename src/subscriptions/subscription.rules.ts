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
  return new Date(
    startedAt.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000,
  );
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
