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
  subscriptionEndsAt: Date | null;
};

export type ResolvedSubscription = {
  state: SubscriptionState;
  /**
   * Días completos que faltan para que se termine lo que hay: la prueba en
   * curso o la suscripción paga.
   *
   * Un solo campo para los dos y no uno por estado: quien lo muestra ya sabe en
   * qué estado está el negocio, y dos contadores mutuamente excluyentes serían
   * dos formas de escribir el mismo cartel. `null` en todo lo vencido, que es
   * lo único honesto: no faltan cero días, no falta nada.
   */
  daysRemaining: number | null;
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

/**
 * Los plazos que se pueden cobrar, en meses.
 *
 * Lista cerrada por lo mismo que `TRIAL_EXTENSION_DAYS`: es una decisión
 * comercial que se toma en un puñado de tamaños, y un campo abierto habilita
 * cargar 700 meses —o −3— en una pantalla que regala producto.
 */
export const SUBSCRIPTION_MONTHS = [1, 3, 6, 12] as const;

/**
 * Suma meses de calendario, no bloques de treinta días.
 *
 * Es lo que hace que un mes pagado el 14 venza el 14 del mes siguiente, que es
 * como se vende y como lo va a leer el negocio. El recorte del final resuelve
 * el único caso raro: el 31 de enero más un mes no existe, y sin esto JavaScript
 * desborda al 3 de marzo en lugar de quedarse en el último día de febrero.
 *
 * Trabaja en la hora local del servidor, como el resto del módulo. Alcanza
 * porque lo que se compara siempre es un instante contra otro; la zona sólo
 * importaría si el vencimiento tuviera que caer a una hora concreta del negocio,
 * y no la tiene: cae a la misma hora del día en que se cargó el pago.
 */
function addMonths(from: Date, months: number): Date {
  const result = new Date(from.getTime());
  const day = result.getDate();

  result.setMonth(result.getMonth() + months);
  if (result.getDate() !== day) {
    result.setDate(0);
  }

  return result;
}

/** Lo que hace falta saber del negocio para cobrarle. */
export type SubscriptionPaymentInput = {
  subscriptionStatus: string | null;
  subscriptionEndsAt: Date | null;
};

export type SubscriptionPayment =
  | { granted: true; subscriptionEndsAt: Date }
  | { granted: false; reason: 'INVALID_MONTHS' };

/**
 * Registra que el negocio pagó, y hasta cuándo queda cubierto.
 *
 * Se suma **al vencimiento vigente** y no a hoy, igual que `extendTrial`:
 * renovar el día 20 una suscripción que vence el 31 tiene que dar mes y once
 * días, no un mes. Con la suscripción ya vencida no queda nada que preservar y
 * el reloj arranca ahora.
 *
 * Nunca acorta: si el negocio ya está cubierto hasta más adelante, esto sólo
 * puede correr la fecha hacia el futuro. Es una función que registra un cobro,
 * y un cobro no puede quitarle días a nadie.
 *
 * No mira la prueba y no la toca. Un negocio que paga en medio de su semana
 * gratis pasa a pagar desde hoy —sus días de prueba no se le suman— y
 * `trialStartedAt`/`trialEndsAt` quedan como lo que son: el registro de cuándo
 * probó Polaria.
 *
 * Rechaza los meses inválidos en lugar de confiar en el validador de la ruta,
 * por lo mismo que `extendTrial`: un número negativo acá no cobraría nada,
 * **acortaría** la suscripción.
 */
export function paySubscription(
  input: SubscriptionPaymentInput,
  months: number,
  now: Date,
): SubscriptionPayment {
  if (!Number.isInteger(months) || months <= 0) {
    return { granted: false, reason: 'INVALID_MONTHS' };
  }

  const covered =
    input.subscriptionStatus === SubscriptionStatus.ACTIVE &&
    input.subscriptionEndsAt !== null &&
    input.subscriptionEndsAt > now;

  return {
    granted: true,
    subscriptionEndsAt: addMonths(
      covered ? (input.subscriptionEndsAt as Date) : now,
      months,
    ),
  };
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
        return without(SubscriptionState.TRIAL_EXPIRED, false);
      }

      if (now >= snapshot.trialEndsAt) {
        return without(SubscriptionState.TRIAL_EXPIRED, false);
      }

      return {
        state: SubscriptionState.TRIAL_ACTIVE,
        daysRemaining: daysBetween(now, snapshot.trialEndsAt),
        hasAccess: true,
      };
    }

    case SubscriptionStatus.ACTIVE: {
      /*
       * Sin fecha de vencimiento se trata como vencida, por lo mismo que la
       * prueba: un dato faltante no debería regalar producto, y acá regalaría
       * producto **para siempre**. No hay filas así —el único escritor de
       * `ACTIVE` es `paySubscription`, que siempre deja fecha—, así que esto
       * cubre un `ACTIVE` puesto a mano en la base, que es exactamente el caso
       * en que conviene que el estado grite en vez de callarse.
       */
      if (!snapshot.subscriptionEndsAt) {
        return without(SubscriptionState.EXPIRED, false);
      }

      if (now >= snapshot.subscriptionEndsAt) {
        return without(SubscriptionState.EXPIRED, false);
      }

      return {
        state: SubscriptionState.ACTIVE,
        daysRemaining: daysBetween(now, snapshot.subscriptionEndsAt),
        hasAccess: true,
      };
    }

    case SubscriptionStatus.EXPIRED:
      return without(SubscriptionState.EXPIRED, false);

    case SubscriptionStatus.CANCELED:
      return without(SubscriptionState.CANCELED, false);

    default:
      /*
       * Sin prueba iniciada **hay acceso**.
       *
       * Es el negocio que se acaba de registrar y está configurándose: negarle
       * el panel sería impedirle llegar al punto en que la prueba arranca. Y no
       * es una puerta abierta, porque sin WhatsApp conectado no hay nada que
       * Polaria pueda hacer por él todavía.
       */
      return without(SubscriptionState.NOT_STARTED, true);
  }
}

/** Un estado sin contador: no queda nada por vencer, o ya venció. */
function without(
  state: SubscriptionState,
  hasAccess: boolean,
): ResolvedSubscription {
  return { state, daysRemaining: null, hasAccess };
}

/**
 * Días completos que faltan, redondeando hacia arriba.
 *
 * Quedando 6 horas al negocio le queda "1 día", no 0: el cartel lo lee alguien
 * que está por perder el acceso, y decirle cero cuando todavía puede trabajar
 * sería mentirle en la dirección que más molesta.
 */
function daysBetween(now: Date, end: Date): number {
  return Math.ceil((end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}
