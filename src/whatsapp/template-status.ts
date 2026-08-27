/**
 * Estado de una plantilla, en los términos que le importan a Polaria.
 *
 * Meta maneja nueve estados (`APPROVED`, `PENDING`, `IN_APPEAL`, `REJECTED`,
 * `PAUSED`, `DISABLED`, `LIMIT_EXCEEDED`, `PENDING_DELETION`, `DELETED`). Se
 * traducen a cuatro porque quien consulta tiene una sola pregunta —¿puedo
 * enviar?— y obligar a cada consumidor a conocer los nueve garantiza que alguno
 * olvide tratar `PAUSED` como "no".
 *
 * Vive en su propio archivo, sin importar nada, porque la entidad lo necesita para
 * su columna y las entidades se cargan por glob al arrancar.
 */
export enum TemplateStatus {
  /** No se creó todavía, o el negocio no tiene WhatsApp conectado. */
  NOT_CREATED = 'NOT_CREATED',
  /** Creada y esperando revisión de Meta. Se resuelve sola. */
  PENDING = 'PENDING',
  /** Lista para enviar. */
  APPROVED = 'APPROVED',
  /** No se puede enviar y no se resuelve esperando: hace falta intervenir. */
  UNAVAILABLE = 'UNAVAILABLE',
}

/** Traduce el estado que informa Meta al de Polaria. */
export function toTemplateStatus(
  metaStatus: string | null | undefined,
): TemplateStatus {
  switch (metaStatus?.toUpperCase()) {
    case 'APPROVED':
      return TemplateStatus.APPROVED;
    case 'PENDING':
    case 'IN_APPEAL':
    case 'PENDING_DELETION':
      return TemplateStatus.PENDING;
    case undefined:
      return TemplateStatus.NOT_CREATED;
    default:
      // `REJECTED`, `PAUSED`, `DISABLED`, `LIMIT_EXCEEDED`, `DELETED` y cualquier
      // estado que Meta agregue: sin enviar hasta saber qué es.
      return TemplateStatus.UNAVAILABLE;
  }
}

/** Solo con la plantilla aprobada se puede iniciar una conversación. */
export function canSendTemplate(status: string | null | undefined): boolean {
  return status === TemplateStatus.APPROVED;
}
