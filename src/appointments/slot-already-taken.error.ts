/**
 * El horario fue tomado por otra reserva entre la revalidación y la inserción.
 *
 * Nace del índice único `(staffId, activeStartTime)`, que es la última barrera
 * contra reservas duplicadas. No es un error del sistema: es una carrera
 * legítima entre dos clientes, y el flujo la trata como "el horario ya no está
 * disponible" y ofrece la lista actualizada.
 */
export class SlotAlreadyTakenError extends Error {
  constructor(
    readonly staffId: string,
    readonly startTime: Date,
  ) {
    super(
      `El horario ${startTime.toISOString()} ya está ocupado para el profesional ${staffId}.`,
    );
    this.name = 'SlotAlreadyTakenError';
  }
}

// El reconocimiento del choque de índice único es genérico y lo comparten dos
// dominios; vive en `database/duplicate-entry.util`.
export { isDuplicateEntryError } from '../database/duplicate-entry.util';
