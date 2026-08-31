/**
 * Si la WABA de un negocio puede pagar los mensajes que Polaria envía por ella.
 *
 * Es un estado aparte de "WhatsApp conectado" porque son cosas distintas, y
 * confundirlas nos costó una noche de depuración: una WABA puede estar conectada,
 * con las plantillas aprobadas y el número verificado, y aun así no entregar un solo
 * mensaje de plantilla porque en Meta le falta configurar la moneda.
 *
 * Meta cobra **directamente al negocio**. Polaria no cobra por mensaje, no lleva
 * saldo y no adelanta nada: solo necesita saber si puede enviar.
 *
 * Todo lo de este archivo es puro.
 */

import { readStoredCredential } from './utils/stored-credential.util';

/**
 * Lo que sabemos sobre la facturación de una WABA.
 *
 * Ninguno de los tres lo escribe una sonda nuestra. Hubo un `READY` que sí, y se
 * quitó: lo ponía una consulta que solo lee la moneda configurada —una de las causas
 * por las que Meta bloquea los envíos, no la única—, así que prometía algo que nunca
 * comprobamos y encima borraba el diagnóstico real de Meta al hacerlo.
 *
 * Lo que reemplaza a ese verde no es una comprobación nuestra sino un hecho
 * documentado: Meta exige que todo cliente de un Tech Provider agregue su propio
 * método de pago **después** del onboarding, y sin él los envíos de plantilla fallan.
 * Es decir que el paso está pendiente para todos hasta que alguien lo haga, y eso lo
 * sabemos sin preguntarle nada a nadie.
 *
 * La confirmación de que un negocio puede enviar sigue siendo un envío que no falle.
 */
export enum WhatsappBillingStatus {
  /**
   * El negocio todavía no dijo haber agregado el método de pago en Meta. **Bloquea.**
   *
   * Es el estado inicial, y no una sospecha: Meta lo pide para todos. Bloquear acá es
   * lo que evita que el negocio active las notificaciones, se olvide del asunto y se
   * entere recién cuando un mensaje no llegue.
   */
  PENDING_SETUP = 'PENDING_SETUP',
  /**
   * El negocio dice que lo configuró. **No bloquea.**
   *
   * Se llama así y no `READY` a propósito: no lo verificamos, le creímos. Si no era
   * cierto, el próximo envío fallido lo corrige.
   */
  UNKNOWN = 'UNKNOWN',
  /** Meta rechazó un envío por facturación. **Bloquea.** Ver `BILLING_ERROR_CODES`. */
  ACTION_REQUIRED = 'ACTION_REQUIRED',
}

/**
 * Si este estado impide activar las notificaciones.
 *
 * Los dos que bloquean lo hacen por razones distintas —uno porque falta un paso que
 * Meta exige, el otro porque Meta ya rechazó— y de las dos se sale igual: el negocio
 * confirma que lo resolvió.
 */
export const blocksNotifications = (status: string): boolean =>
  // `String(...)` porque el estado viaja como `varchar` desde la BD: sin esto,
  // comparar la columna con el enum es un error de tipos y no una comparación.
  status === String(WhatsappBillingStatus.PENDING_SETUP) ||
  status === String(WhatsappBillingStatus.ACTION_REQUIRED);

/**
 * Los códigos de Meta que significan **con certeza** un problema de facturación.
 *
 * La lista tiene uno solo a propósito. `131042` —"Business eligibility payment
 * issue"— es el único que vimos en producción con su detalle explícito, y agregar
 * códigos por parecido sería peor que no tener la función: marcaría la facturación
 * de un negocio como rota por un error que no tiene nada que ver, y lo mandaría al
 * Billing Hub a buscar un problema inexistente.
 *
 * Cuando aparezca otro con evidencia, se agrega acá y no hay nada más que tocar.
 */
export const BILLING_ERROR_CODES: readonly number[] = [131042];

/** Lo mínimo de un fallo de envío para saber si habla de facturación. */
export interface BillingErrorCandidate {
  code: number | null;
  detail: string | null;
}

/**
 * Si un fallo de envío es un problema de facturación.
 *
 * Solo mira el código. El texto de Meta cambia y está traducido según la cuenta, así
 * que emparejarlo por palabras —"payment", "currency"— sería frágil justo donde hace
 * falta precisión.
 */
export const isBillingError = (
  errors: BillingErrorCandidate[],
): BillingErrorCandidate | null =>
  errors.find(
    (error) => error.code !== null && BILLING_ERROR_CODES.includes(error.code),
  ) ?? null;

/**
 * El enlace al Billing Hub de Meta para esta WABA.
 *
 * **Es una URL que construimos nosotros**, siguiendo el patrón del Billing Hub, no
 * una que Meta nos haya devuelto: el detalle del `131042` que capturamos venía sin
 * enlace. Vale la pena decirlo porque el comentario anterior afirmaba lo contrario y
 * eso desalienta a verificarla.
 *
 * No lleva `wizard_name`. Lo llevó —fijo en `CHANGE_COUNTRY_CURRENCY`— y estaba mal:
 * `131042` cubre varias causas, y a un negocio con la tarjeta rechazada lo mandaba al
 * asistente de moneda, que además suele estar bloqueado en cuentas que ya gastaron.
 * Sin el parámetro, Meta muestra en el detalle de la cuenta lo que realmente falte.
 *
 * Devuelve `null` sin los dos ids: un botón que lleva a una página genérica del
 * Business Manager no ayuda a nadie.
 */
export const buildBillingSetupUrl = (params: {
  businessId?: string | null;
  wabaId?: string | null;
}): string | null => {
  /*
   * Los ids pasan por `readStoredCredential` y no por un `trim()` propio: estas
   * columnas guardan a veces las cadenas `'null'` y `'undefined'`, que sobreviven a
   * un chequeo de vacío y saldrían en la URL como `business_id=null`. Se filtra acá
   * dentro, y no en quien llama, para que valga para todos los que llamen.
   */
  const businessId = readStoredCredential(params.businessId);
  const wabaId = readStoredCredential(params.wabaId);

  if (!businessId || !wabaId) return null;

  const query = new URLSearchParams({
    business_id: businessId,
    asset_id: wabaId,
    account_type: 'whatsapp-business-account',
  });

  return `https://business.facebook.com/billing_hub/accounts/details/?${query.toString()}`;
};

/**
 * La moneda que la sonda leyó, normalizada para guardar.
 *
 * **No es un veredicto.** Antes esto devolvía un estado, y ahí estaba el error: tener
 * moneda configurada no dice nada del método de pago, ni de si fue rechazado, ni de
 * la verificación del portafolio. Se guarda como dato de diagnóstico y nada más; la
 * pregunta de si el negocio puede enviar la contesta `health_status`.
 */
export const normalizeBillingCurrency = (
  currency: string | null | undefined,
): string | null => currency?.trim() || null;

/** Lo que Meta devuelve en `health_status` de la WABA. */
export interface WabaHealthStatus {
  can_send_message?: string;
  entities?: {
    entity_type?: string;
    id?: string;
    can_send_message?: string;
    errors?: {
      error_code?: number;
      error_description?: string;
      possible_solution?: string;
    }[];
  }[];
}

/** El veredicto de Meta sobre si esta WABA puede enviar. */
export interface HealthVerdict {
  /** `true` solo si Meta dijo `BLOCKED`. La duda no cuenta como bloqueo. */
  blocked: boolean;
  /** La explicación de Meta, con su solución sugerida si la trajo. */
  reason: string | null;
}

/**
 * Lee el veredicto de Meta sobre si la WABA puede enviar mensajes.
 *
 * `health_status` es la pregunta correcta, y llegamos tarde a ella: la sonda anterior
 * miraba `currency`, que solo cubre una de las causas por las que Meta bloquea. Este
 * campo contesta literalmente `can_send_message`, y cuando dice `BLOCKED` trae el
 * código, la descripción y la solución sugerida.
 *
 * **Solo `BLOCKED` es concluyente.** `AVAILABLE` no se toma como permiso: la
 * documentación de Meta no dice que el problema de facturación aparezca acá, así que
 * un verde de este campo podría no estar mirando lo que nos interesa. Se usa entonces
 * en una sola dirección —para bloquear, nunca para desbloquear—, que es la dirección
 * en la que equivocarse no le rompe nada a nadie.
 *
 * `LIMITED` tampoco bloquea: significa que puede enviar con restricciones.
 */
export const readHealthVerdict = (
  health: WabaHealthStatus | null | undefined,
): HealthVerdict => {
  if (!health) return { blocked: false, reason: null };

  const blockedEntities = (health.entities ?? []).filter(
    (entity) => entity.can_send_message === 'BLOCKED',
  );

  if (health.can_send_message !== 'BLOCKED' && blockedEntities.length === 0) {
    return { blocked: false, reason: null };
  }

  const error = blockedEntities
    .flatMap((entity) => entity.errors ?? [])
    .find((candidate) => candidate.error_description);

  /*
   * El texto se arma con la descripción y la solución de Meta, en ese orden, porque
   * es lo que el negocio necesita leer: qué pasa y qué hacer. Escribirlo nosotros
   * sería traducir un mensaje que Meta ya redactó para este caso exacto.
   */
  const reason = error
    ? [error.error_description, error.possible_solution]
        .filter(Boolean)
        .join(' ')
        .trim()
    : null;

  return { blocked: true, reason: reason || null };
};
