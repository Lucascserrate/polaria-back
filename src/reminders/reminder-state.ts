/**
 * Estado de un recordatorio.
 *
 * Vive en su propio archivo, sin importar nada, para cortar un ciclo: la
 * entidad del recordatorio necesita el enum para su columna, las reglas
 * necesitan la entidad de la cita, y la cita necesita la del recordatorio.
 * Entrando al ciclo por el archivo equivocado, el enum llegaba `undefined` al
 * evaluarse el decorador y la carga fallaba con un error que no mencionaba
 * ninguno de los tres archivos.
 */
export enum ReminderState {
  /** Programado y esperando su momento. */
  SCHEDULED = 'SCHEDULED',
  /**
   * Tomado por una ejecución que está llamando al canal ahora mismo.
   *
   * Existe para separar "lo estoy mandando" de "llegó". Sin este paso había
   * que marcar `SENT` antes de llamar a Meta —para que dos ejecuciones no
   * enviaran lo mismo—, y una caída en el medio dejaba un recordatorio marcado
   * como enviado que nunca salió: el dueño leía "enviado" y el cliente no
   * había recibido nada.
   */
  SENDING = 'SENDING',
  /** Entregado al canal. Terminal: nunca se reenvía. */
  SENT = 'SENT',
  /** Ya no corresponde: la cita se canceló, se completó o se apagaron los avisos. */
  CANCELLED = 'CANCELLED',
  /** El canal rechazó el envío. */
  FAILED = 'FAILED',
  /** No se puede avisar por una condición de los datos, no por un fallo. */
  SKIPPED = 'SKIPPED',
}
