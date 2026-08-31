import { resolveClientDeletion } from './client-deletion.util';

describe('resolveClientDeletion', () => {
  it('sin citas, borra físicamente', () => {
    // El cliente cargado por error, o el número que preguntó un precio y nunca
    // reservó. No hay nada que preservar.
    expect(
      resolveClientDeletion({
        totalAppointments: 0,
        futureActiveAppointments: 0,
      }),
    ).toEqual({ mode: 'HARD' });
  });

  it('con historial, da de baja conservándolo', () => {
    expect(
      resolveClientDeletion({
        totalAppointments: 8,
        futureActiveAppointments: 0,
      }),
    ).toEqual({ mode: 'SOFT' });
  });

  it('una sola cita ya es historial', () => {
    /*
     * Puede ser una cita cancelada: igual registra que la persona reservó y qué
     * se le iba a cobrar. El borrado físico se llevaría la cita y sus
     * `appointment_services` por la clave ajena, o sea la facturación del
     * negocio, no sólo los datos del cliente.
     */
    expect(
      resolveClientDeletion({
        totalAppointments: 1,
        futureActiveAppointments: 0,
      }),
    ).toEqual({ mode: 'SOFT' });
  });

  it('con citas próximas, bloquea e informa cuántas', () => {
    expect(
      resolveClientDeletion({
        totalAppointments: 20,
        futureActiveAppointments: 2,
      }),
    ).toEqual({ mode: 'BLOCKED', futureAppointments: 2 });
  });

  it('el bloqueo gana incluso sin historial previo', () => {
    // Un cliente nuevo que ya reservó su primer turno: ese turno ocupa la agenda
    // y la persona tiene su confirmación.
    expect(
      resolveClientDeletion({
        totalAppointments: 1,
        futureActiveAppointments: 1,
      }),
    ).toEqual({ mode: 'BLOCKED', futureAppointments: 1 });
  });
});
