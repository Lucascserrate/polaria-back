import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Quién está suplantando a quién, durante una petición.
 */
export interface ImpersonationContext {
  /** Correo del super admin que abrió la sesión. */
  by: string;
  tenantId: string;
}

/**
 * El contexto de suplantación de la petición en curso.
 *
 * Es `AsyncLocalStorage` y no un parámetro que se pasa de mano en mano porque
 * quien necesita saberlo está muy lejos de quien lo sabe: el borde HTTP tiene el
 * token, y el que no puede hablar es `WhatsAppSenderService`, cinco capas más
 * abajo y también alcanzable desde jobs que no vienen de ninguna petición.
 * Enhebrar un flag por toda esa cadena habría significado tocar cada firma
 * intermedia, y bastaba con que un camino se olvidara de pasarlo para que el
 * bloqueo no existiera justo ahí.
 *
 * Fuera de una petición suplantada el store está vacío, que es lo que hace que
 * los jobs y los webhooks sigan enviando con normalidad.
 */
const storage = new AsyncLocalStorage<ImpersonationContext>();

export const runImpersonated = <T>(
  context: ImpersonationContext,
  callback: () => T,
): T => storage.run(context, callback);

export const currentImpersonation = (): ImpersonationContext | null =>
  storage.getStore() ?? null;
