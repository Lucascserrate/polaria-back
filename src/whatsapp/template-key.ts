/**
 * Las plantillas que Polaria aprovisiona, como identificadores.
 *
 * Vive en su propio archivo y **no importa nada**, para cortar un ciclo: el registro
 * necesita los cuerpos de cada plantilla, los cuerpos necesitan saber a qué clave
 * corresponde cada evento, y la clave estaba declarada en el registro. Entrando al
 * ciclo por el archivo equivocado, `TemplateKey` llegaba `undefined` al evaluarse
 * `TEMPLATE_KEY_BY_EVENT` y la carga fallaba con un error que no mencionaba ninguno
 * de los dos archivos.
 *
 * Es el mismo motivo por el que `ReminderState` y `NotificationState` viven aparte.
 *
 * Los valores van a la columna `templateKey`, un `varchar(32)`: el más largo es
 * `staff_alert_cancelled`, de 21 caracteres.
 */
export enum TemplateKey {
  /** Recordatorio de cita al **cliente**. */
  REMINDER = 'reminder',
  /** Al profesional: le agendaron una cita. */
  STAFF_ALERT_NEW = 'staff_alert_new',
  /** Al profesional: le movieron una cita. */
  STAFF_ALERT_MOVED = 'staff_alert_moved',
  /** Al profesional: le cancelaron una cita. */
  STAFF_ALERT_CANCELLED = 'staff_alert_cancelled',
}

export const TEMPLATE_KEYS: readonly TemplateKey[] = [
  TemplateKey.REMINDER,
  TemplateKey.STAFF_ALERT_NEW,
  TemplateKey.STAFF_ALERT_MOVED,
  TemplateKey.STAFF_ALERT_CANCELLED,
];
