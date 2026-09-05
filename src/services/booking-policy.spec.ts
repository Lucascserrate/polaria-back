import {
  CONSULTATION_FIRST_NOTICE,
  isSelfBookable,
  ServiceBookingPolicy,
} from './booking-policy';

describe('isSelfBookable', () => {
  it('el cliente reserva lo que está marcado como reservable', () => {
    expect(isSelfBookable(ServiceBookingPolicy.CLIENT_BOOKS)).toBe(true);
  });

  it('no reserva lo que requiere consulta previa', () => {
    expect(isSelfBookable(ServiceBookingPolicy.CONSULTATION_FIRST)).toBe(false);
  });

  /*
   * Lo que protege este test es el catálogo que ya existe. Cuando esta columna se
   * agregó, todos los servicios eran reservables; una fila sin valor —o con un
   * valor que no entendemos— tiene que seguir vendiéndose. Fallar cerrado acá
   * significaría que un negocio deja de recibir reservas sin haber tocado nada.
   */
  it('lo desconocido se reserva: un dato que no entendemos no puede dejar de vender', () => {
    expect(isSelfBookable(null)).toBe(true);
    expect(isSelfBookable(undefined)).toBe(true);
    expect(isSelfBookable('')).toBe(true);
    expect(isSelfBookable('ALGO_QUE_NO_EXISTE')).toBe(true);
  });

  /*
   * Solo hay una política que bloquea, y este test está para que agregar otra sea
   * una decisión: si mañana entra `DEPOSIT_FIRST`, acá se ve que `isSelfBookable`
   * no la contempla todavía.
   */
  it('solo `CONSULTATION_FIRST` bloquea', () => {
    const blocking = Object.values(ServiceBookingPolicy).filter(
      (policy) => !isSelfBookable(policy),
    );

    expect(blocking).toEqual([ServiceBookingPolicy.CONSULTATION_FIRST]);
  });
});

describe('CONSULTATION_FIRST_NOTICE', () => {
  /* Explicar sin ofrecer salida deja al cliente sin siguiente paso. */
  it('dice el motivo y qué hacer', () => {
    expect(CONSULTATION_FIRST_NOTICE).toContain('consulta previa');
    expect(CONSULTATION_FIRST_NOTICE).toContain('coordinamos');
  });
});
