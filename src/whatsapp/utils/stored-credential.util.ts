/**
 * Normaliza una credencial de WhatsApp leída de la BD o de un payload externo.
 *
 * Un valor ausente puede haber quedado persistido como cadena (`''`, `'null'`,
 * `'undefined'`) en lugar de `NULL`. El operador `??` no filtra esos casos: la
 * cadena `'null'` es truthy, sobrevive a los chequeos de "falta credencial" y
 * termina saliendo como `Authorization: Bearer null`, a lo que Meta responde
 * 401 con `code: 190` (`OAuthException`) — un error que se lee como token
 * vencido y no como dato corrupto.
 */
export function readStoredCredential(
  value?: string | null,
): string | undefined {
  const trimmed = value?.trim();

  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') {
    return undefined;
  }

  return trimmed;
}
