import { BookingMode, bookingModeOf } from './booking-mode';

/**
 * Qué modo se aplica de verdad.
 *
 * La columna dice qué eligió el negocio; esto dice qué se puede hacer. La
 * diferencia es una sola condición —sin página no hay enlace— y existe porque
 * un "Agendar cita" que no lleva a ningún lado deja la conversación muda en el
 * paso más importante.
 */

describe('bookingModeOf', () => {
  it('sin nada guardado, el flujo guiado', () => {
    expect(bookingModeOf({})).toBe(BookingMode.GUIDED_CHAT);
  });

  it('respeta el enlace cuando el negocio tiene página', () => {
    expect(
      bookingModeOf({ bookingMode: 'BOOKING_LINK', slug: 'royal-barber' }),
    ).toBe(BookingMode.BOOKING_LINK);
  });

  /*
   * La red: los ajustes impiden llegar a este estado, pero un slug borrado a
   * mano o una fila importada sí pueden. Mejor el flujo guiado que un botón que
   * no lleva a ninguna parte.
   */
  it('sin página cae al flujo guiado aunque diga enlace', () => {
    expect(bookingModeOf({ bookingMode: 'BOOKING_LINK', slug: null })).toBe(
      BookingMode.GUIDED_CHAT,
    );
  });

  it('un valor desconocido no rompe la conversación', () => {
    expect(bookingModeOf({ bookingMode: 'LO_QUE_SEA', slug: 'x' })).toBe(
      BookingMode.GUIDED_CHAT,
    );
  });

  /* El flujo guiado no necesita página: funciona sin ninguna otra condición. */
  it('el flujo guiado vale sin página', () => {
    expect(bookingModeOf({ bookingMode: 'GUIDED_CHAT', slug: null })).toBe(
      BookingMode.GUIDED_CHAT,
    );
  });
});
