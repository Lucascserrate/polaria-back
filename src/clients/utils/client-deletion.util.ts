/**
 * Qué hacer al eliminar un cliente.
 *
 * Es una función pura para poder razonar los tres casos sin base de datos. El
 * servicio se ocupa de conseguir los números y de ejecutar la decisión. Mismo
 * reparto que `resolveStaffDeletion`, y por los mismos motivos.
 *
 * La decisión importa más acá que en el equipo por cómo está armada la base:
 * `appointments.clientId` borra en cascada, y con él se van los
 * `appointment_services` de esas citas, que es donde vive `priceAtBooking`.
 * Un borrado físico descuidado no deja al cliente sin historial: deja al
 * **negocio** sin la facturación de ese cliente, y sin nada que avise.
 */

export type ClientDeletionPlan =
  /**
   * No se elimina: tiene turnos por delante. La cantidad va al mensaje porque
   * "tiene 2 citas próximas" le dice al negocio qué resolver, y "no se puede
   * eliminar" no le dice nada.
   */
  | { mode: 'BLOCKED'; futureAppointments: number }
  /**
   * Borrado físico. Sólo cuando nunca tuvo una cita: es el cliente cargado por
   * error o el número que escribió una vez y nunca reservó.
   */
  | { mode: 'HARD' }
  /**
   * Baja lógica. Sus citas, lo facturado y su historial quedan intactos, y deja
   * de aparecer en la lista del negocio.
   */
  | { mode: 'SOFT' };

export type ClientDeletionCounts = {
  /**
   * Citas de este cliente, de cualquier estado.
   *
   * Se cuentan las canceladas también: una cancelación es parte del historial
   * —dice que la persona reservó y no vino— y el borrado físico se la llevaría
   * por la clave ajena junto con lo que se le facturó.
   */
  totalAppointments: number;
  /** Citas que todavía ocupan agenda y empiezan en el futuro. */
  futureActiveAppointments: number;
};

export function resolveClientDeletion(
  counts: ClientDeletionCounts,
): ClientDeletionPlan {
  /*
   * El bloqueo va primero, incluso antes de mirar el historial.
   *
   * Una cita futura es un compromiso de las dos partes: el negocio reservó ese
   * horario y la persona ya recibió su confirmación. Eliminar al cliente dejaría
   * el turno ocupando la agenda sin nadie que se presente, o desaparecería un
   * turno que alguien tiene anotado. Cancelarlo es una decisión del negocio, no
   * un efecto secundario de un borrado.
   */
  if (counts.futureActiveAppointments > 0) {
    return {
      mode: 'BLOCKED',
      futureAppointments: counts.futureActiveAppointments,
    };
  }

  /*
   * Las conversaciones y los mensajes no cuentan como historial.
   *
   * Alguien que escribió una vez y nunca reservó no es un cliente que el negocio
   * quiera conservar, y si tuviera que conservarlo, la lista se llenaría de
   * números que preguntaron un precio en 2025. El hilo de WhatsApp además sigue
   * existiendo en WhatsApp. Lo que no se puede recuperar de ningún lado son las
   * citas y lo facturado, y eso es lo que se cuenta.
   */
  return counts.totalAppointments > 0 ? { mode: 'SOFT' } : { mode: 'HARD' };
}
