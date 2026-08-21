import { resolveStaffDeletion } from './staff-deletion.util';

describe('resolveStaffDeletion', () => {
  it('sin historial, borra físicamente', () => {
    expect(
      resolveStaffDeletion({ totalSegments: 0, futureActiveAppointments: 0 }),
    ).toEqual({ mode: 'HARD' });
  });

  it('con historial, da de baja conservándolo', () => {
    expect(
      resolveStaffDeletion({ totalSegments: 12, futureActiveAppointments: 0 }),
    ).toEqual({ mode: 'SOFT' });
  });

  it('un solo segmento ya es historial', () => {
    // Puede ser una cita cancelada: el segmento sigue registrando quién estaba
    // asignado, y el borrado físico se lo llevaría por la clave ajena.
    expect(
      resolveStaffDeletion({ totalSegments: 1, futureActiveAppointments: 0 }),
    ).toEqual({ mode: 'SOFT' });
  });

  it('con citas futuras, bloquea e informa cuántas', () => {
    expect(
      resolveStaffDeletion({ totalSegments: 40, futureActiveAppointments: 3 }),
    ).toEqual({ mode: 'BLOCKED', futureAppointments: 3 });
  });

  it('el bloqueo gana incluso sin historial previo', () => {
    // Un profesional recién creado que ya tiene un turno reservado: el turno es
    // un compromiso con un cliente, y el borrado físico se lo llevaría.
    expect(
      resolveStaffDeletion({ totalSegments: 1, futureActiveAppointments: 1 }),
    ).toEqual({ mode: 'BLOCKED', futureAppointments: 1 });
  });
});
