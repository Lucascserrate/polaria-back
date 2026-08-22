import { REMINDER_TEMPLATE_VARIABLES } from '../whatsapp/reminder-template';
import {
  buildReminderMessage,
  buildReminderPreview,
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

describe('buildReminderPreview', () => {
  it('reemplaza todas las variables de la plantilla', () => {
    const preview = buildReminderPreview('Studio Nova');

    expect(preview).not.toContain('{{');
    expect(preview).toContain('Studio Nova');
  });

  it('usa el nombre del negocio y datos de ejemplo para el resto', () => {
    const preview = buildReminderPreview('Studio Nova');

    // El cliente, el servicio, el profesional y la hora son inventados: la
    // vista previa no puede depender de que exista una cita real.
    expect(preview).toContain('Hola Lucas');
    expect(preview).toContain('Servicio: Corte');
    expect(preview).toContain('Profesional: Diego');
  });

  it('no deja el negocio en blanco cuando todavía no tiene nombre', () => {
    expect(buildReminderPreview('   ')).toContain('tu negocio');
  });
});
