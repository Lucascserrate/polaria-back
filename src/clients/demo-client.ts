import { ClientSource } from './entities/client.entity';

/**
 * El cliente con el que un negocio nuevo puede probar la agenda.
 *
 * Existe por el tutorial de la primera cita. Sin él, la primera lección tenía
 * que enseñar de paso a dar de alta un cliente —abrir el buscador, el diálogo,
 * nombre y teléfono— para recién ahí poder cargar la cita, y eso convertía la
 * lección más importante en la más larga. Con uno ya cargado, el paso es
 * elegirlo.
 *
 * **Sin teléfono, a propósito.** Es lo que garantiza que nunca se le mande nada:
 * el envío de recordatorios cancela la fila cuando el cliente no tiene número,
 * así que no hay forma de que una prueba termine escribiéndole a un desconocido.
 * Un número inventado sí podría: bastaría que exista.
 *
 * Es un cliente común y corriente, no una fila marcada: aparece en la lista, se
 * puede editar y se puede borrar. Que se pueda borrar es la salida para el
 * negocio al que le sobra, y no hace falta explicarla porque es la misma que la
 * de cualquier otro cliente.
 */
export const DEMO_CLIENT = {
  name: 'Cliente de prueba',
  phone: null,
  notes:
    'Lo creamos para que puedas probar la agenda sin usar a un cliente real. Borralo cuando no lo necesites.',
  createdVia: ClientSource.PANEL,
} as const;
