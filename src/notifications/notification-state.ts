/**
 * Estado de un aviso a un profesional.
 *
 * Vive en su propio archivo, igual que `ReminderState`, para que la entidad no
 * tenga que importar el módulo de reglas: TypeORM carga las entidades por glob al
 * arrancar, y una entidad que arrastra reglas arrastra todo lo que ellas importan.
 */
export enum NotificationState {
  /** Encolado, esperando salir. */
  PENDING = 'PENDING',
  /** Un proceso se hizo cargo del envío. */
  SENDING = 'SENDING',
  /** Entregado a Meta. Terminal: un segundo mensaje igual sería spam. */
  SENT = 'SENT',
  /** El canal lo rechazó. Terminal: reintentar sin control es una tormenta. */
  FAILED = 'FAILED',
  /**
   * No correspondía enviarlo, y se registra por qué.
   *
   * No es un error: cubre al profesional sin teléfono, al que no atiende clientes y
   * al negocio cuya plantilla todavía no está aprobada. Es lo que hace que la
   * ausencia de un mensaje sea explicable en lugar de un silencio.
   */
  SKIPPED = 'SKIPPED',
}
