/** Código de MySQL para violación de restricción única. */
const MYSQL_DUPLICATE_ENTRY = 'ER_DUP_ENTRY';
const MYSQL_DUPLICATE_ENTRY_ERRNO = 1062;

/**
 * Reconoce el fallo de índice único sin acoplar el llamador al driver.
 *
 * Vive acá y no dentro de un módulo de dominio porque son tres los que dependen
 * de un índice único como última barrera: la reserva doble sobre
 * `(staffId, activeStartTime)`, la cuenta duplicada sobre `googleId` y el mismo
 * cliente entrando dos veces por `(tenantId, phone)`. En los tres casos el
 * choque no es un error del sistema, es una carrera legítima que hay que
 * traducir a una respuesta de producto.
 */
export function isDuplicateEntryError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const candidate = error as {
    code?: unknown;
    errno?: unknown;
    driverError?: { code?: unknown; errno?: unknown };
  };

  const codes = [candidate.code, candidate.driverError?.code];
  const errnos = [candidate.errno, candidate.driverError?.errno];

  return (
    codes.includes(MYSQL_DUPLICATE_ENTRY) ||
    errnos.includes(MYSQL_DUPLICATE_ENTRY_ERRNO)
  );
}
