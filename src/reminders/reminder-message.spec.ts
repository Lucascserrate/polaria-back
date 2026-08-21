import { REMINDER_TEMPLATE_VARIABLES } from '../whatsapp/reminder-template';
import {
  buildReminderMessage,
  formatReminderDateTime,
} from './reminder-message';

const INPUT = {
  appointmentId: 'appt-1',
  clientName: 'María',
  businessName: 'Studio Nova',
  serviceName: 'Corte',
  professionalName: 'Diego',
  startTime: new Date('2026-08-21T20:00:00.000Z'),
  timezone: 'America/La_Paz',
};

describe('formatReminderDateTime', () => {
  it('usa la hora del negocio y no la del servidor', () => {
    // 20:00 UTC son 16:00 en La Paz: es la hora que el cliente tiene que leer.
    expect(formatReminderDateTime(INPUT.startTime, 'America/La_Paz')).toContain(
      '16:00',
    );
    expect(formatReminderDateTime(INPUT.startTime, 'Europe/Madrid')).toContain(
      '22:00',
    );
  });
});

describe('buildReminderMessage', () => {
  it('llena las variables en el orden de la plantilla', () => {
    const { bodyParameters } = buildReminderMessage(INPUT);

    expect(bodyParameters).toHaveLength(REMINDER_TEMPLATE_VARIABLES.length);
    expect(bodyParameters.slice(0, 4)).toEqual([
      'María',
      'Studio Nova',
      'Corte',
      'Diego',
    ]);
    expect(bodyParameters[4]).toContain('16:00');
  });

  it('no deja ninguna variable vacía', () => {
    // Meta rechaza el envío si falta un parámetro, así que un dato ausente se
    // reemplaza por algo legible en lugar de romper el recordatorio.
    const { bodyParameters } = buildReminderMessage({
      ...INPUT,
      clientName: null,
      businessName: '   ',
      serviceName: null,
      professionalName: null,
    });

    for (const value of bodyParameters) {
      expect(value.trim().length).toBeGreaterThan(0);
    }
  });

  it('manda los payloads de reagendar y cancelar, en ese orden', () => {
    // El botón se identifica por índice, no por texto: invertirlos haría que
    // "Reagendar" cancelara la cita.
    const { quickReplyPayloads } = buildReminderMessage(INPUT);

    expect(quickReplyPayloads).toEqual([
      'appt|v1|resched|appt-1',
      'appt|v1|cancel|appt-1',
    ]);
  });
});
