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

/** Código de MySQL para violación de restricción única. */
const MYSQL_DUPLICATE_ENTRY = 'ER_DUP_ENTRY';
const MYSQL_DUPLICATE_ENTRY_ERRNO = 1062;

/** Reconoce el fallo de índice único sin acoplar el llamador al driver. */
export function isDuplicateEntryError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const candidate = error as {
    code?: unknown;
    errno?: unknown;
    driverError?: { code?: unknown; errno?: unknown };
  };

  const code = candidate.code ?? candidate.driverError?.code;
  const errno = candidate.errno ?? candidate.driverError?.errno;

  return (
    code === MYSQL_DUPLICATE_ENTRY || errno === MYSQL_DUPLICATE_ENTRY_ERRNO
  );
}
