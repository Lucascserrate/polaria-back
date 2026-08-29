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
 * Lo único que podemos afirmar sobre la facturación de una WABA.
 *
 * Son dos estados y no tres a propósito. Hubo un `READY` y se quitó: lo ponía una
 * sonda que solo sabe leer la moneda configurada, que es **una** de las causas por
 * las que Meta bloquea los envíos —también están el método de pago ausente, el
 * rechazado y el portafolio sin verificar—. Un verde apoyado en esa sonda le
 * prometía al negocio algo que no habíamos comprobado, y encima borraba el
 * diagnóstico real de Meta al hacerlo.
 *
 * La única confirmación de que un negocio puede enviar es que un envío no falle.
 * Mientras tanto, o Meta nos dijo que hay un problema, o no sabemos.
 */
export enum WhatsappBillingStatus {
  /**
   * No sabemos, y **no bloquea nada**.
   *
   * Es el estado inicial, y también al que se vuelve cuando el negocio dice que ya
   * configuró: es honesto —no lo comprobamos— y deja pasar, que es lo que
   * corresponde cuando la duda es nuestra y no de Meta.
   */
  UNKNOWN = 'UNKNOWN',
  /** Meta rechazó un envío por facturación. Ver `BILLING_ERROR_CODES`. */
  ACTION_REQUIRED = 'ACTION_REQUIRED',
}

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
 * la verificación del portafolio. Se guarda como dato de diagnóstico —para poder
 * responder algún día si Meta devuelve una moneda por defecto en cuentas sin
 * facturar, que hoy no sabemos— y nada más.
 */
export const normalizeBillingCurrency = (
  currency: string | null | undefined,
): string | null => currency?.trim() || null;
