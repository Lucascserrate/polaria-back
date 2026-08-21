/**
 * Qué hacer al eliminar un profesional.
 *
 * Es una función pura para poder razonar los tres casos sin base de datos. El
 * servicio se ocupa de conseguir los números y de ejecutar la decisión.
 */

export type StaffDeletionPlan =
  /**
   * No se elimina: tiene compromisos por delante. La cantidad va al mensaje
   * porque "tiene 3 citas próximas" le dice al negocio qué resolver, y "no se
   * puede eliminar" no le dice nada.
   */
  | { mode: 'BLOCKED'; futureAppointments: number }
  /**
   * Borrado físico. Solo cuando nunca tuvo un segmento: es el profesional
   * cargado por error, sin nada que preservar.
   */
  | { mode: 'HARD' }
  /**
   * Baja lógica. Sus citas, servicios, comisiones e historial contable quedan
   * intactos y deja de ofrecerse para reservas nuevas.
   */
  | { mode: 'SOFT' };

export type StaffDeletionCounts = {
  /**
   * Segmentos de cita de este profesional, de cualquier estado.
   *
   * Se cuentan segmentos y no citas porque es donde está la clave ajena —y el
   * dinero: `priceAtBooking` vive ahí—. Una cita cancelada conserva su segmento,
   * así que también cuenta como historial: la cita sigue registrando quién
   * estaba asignado, y borrarla físicamente perdería ese dato.
   */
  totalSegments: number;
  /** Citas que todavía ocupan agenda y empiezan en el futuro. */
  futureActiveAppointments: number;
};

export function resolveStaffDeletion(
  counts: StaffDeletionCounts,
): StaffDeletionPlan {
  /*
   * El bloqueo va primero, incluso antes de mirar el historial.
   *
   * Una cita futura es un compromiso con un cliente que ya recibió su
   * confirmación. Eliminar al profesional dejaría ese turno en la agenda sin
   * nadie que lo atienda, con su horario igualmente ocupado y con un
   * recordatorio en camino. Reasignarlo o cancelarlo es una decisión del
   * negocio, no algo que se resuelva como efecto secundario de un borrado.
   */
  if (counts.futureActiveAppointments > 0) {
    return {
      mode: 'BLOCKED',
      futureAppointments: counts.futureActiveAppointments,
    };
  }

  return counts.totalSegments > 0 ? { mode: 'SOFT' } : { mode: 'HARD' };
}
