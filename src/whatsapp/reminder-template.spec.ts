import {
  canSendReminders,
  ReminderTemplateStatus,
  toReminderTemplateStatus,
} from './reminder-template';

describe('toReminderTemplateStatus', () => {
  it('aprueba solo lo aprobado', () => {
    expect(toReminderTemplateStatus('APPROVED')).toBe(
      ReminderTemplateStatus.APPROVED,
    );
  });

  it('trata como pendiente lo que se resuelve esperando', () => {
    expect(toReminderTemplateStatus('PENDING')).toBe(
      ReminderTemplateStatus.PENDING,
    );
    expect(toReminderTemplateStatus('IN_APPEAL')).toBe(
      ReminderTemplateStatus.PENDING,
    );
  });

  it('trata como no disponible todo lo que impide enviar', () => {
    // Es el punto del mapeo: `PAUSED` y `DISABLED` no son "rechazada", pero
    // tampoco se puede enviar con ellas, y un consumidor podría no saberlo.
    for (const metaStatus of [
      'REJECTED',
      'PAUSED',
      'DISABLED',
      'LIMIT_EXCEEDED',
      'DELETED',
    ]) {
      expect(toReminderTemplateStatus(metaStatus)).toBe(
        ReminderTemplateStatus.UNAVAILABLE,
      );
    }
  });

  it('un estado nuevo de Meta no habilita el envío', () => {
    expect(toReminderTemplateStatus('ALGO_QUE_META_AGREGUE')).toBe(
      ReminderTemplateStatus.UNAVAILABLE,
    );
  });

  it('sin estado, la plantilla no existe', () => {
    expect(toReminderTemplateStatus(undefined)).toBe(
      ReminderTemplateStatus.NOT_CREATED,
    );
  });

  it('acepta el estado en minúsculas', () => {
    expect(toReminderTemplateStatus('approved')).toBe(
      ReminderTemplateStatus.APPROVED,
    );
  });
});

describe('canSendReminders', () => {
  it('solo habilita con la plantilla aprobada', () => {
    expect(canSendReminders(ReminderTemplateStatus.APPROVED)).toBe(true);

    for (const status of [
      ReminderTemplateStatus.PENDING,
      ReminderTemplateStatus.UNAVAILABLE,
      ReminderTemplateStatus.NOT_CREATED,
      null,
      undefined,
    ]) {
      expect(canSendReminders(status)).toBe(false);
    }
  });
});
