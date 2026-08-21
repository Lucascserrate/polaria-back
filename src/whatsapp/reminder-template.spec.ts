import {
  buildReminderTemplateCreatePayload,
  canSendReminders,
  REMINDER_TEMPLATE_BUTTONS,
  REMINDER_TEMPLATE_VARIABLES,
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

describe('buildReminderTemplateCreatePayload', () => {
  const payload = buildReminderTemplateCreatePayload();

  it('se crea como utility, no como marketing', () => {
    // La categoría cambia el precio y las reglas: un recordatorio clasificado
    // como marketing sería rechazado.
    expect(payload.category).toBe('UTILITY');
  });

  it('usa mayúsculas en los componentes, como pide la creación', () => {
    const components = payload.components as Array<{ type: string }>;
    expect(components.map((component) => component.type)).toEqual([
      'BODY',
      'BUTTONS',
    ]);
  });

  it('declara un ejemplo por cada variable del cuerpo', () => {
    const [body] = payload.components as Array<{
      text: string;
      example: { body_text: string[][] };
    }>;

    const placeholders = body.text.match(/\{\{\d+\}\}/g) ?? [];
    expect(placeholders).toHaveLength(REMINDER_TEMPLATE_VARIABLES.length);
    // Sin un ejemplo por variable, Meta rechaza la plantilla.
    expect(body.example.body_text[0]).toHaveLength(
      REMINDER_TEMPLATE_VARIABLES.length,
    );
  });

  it('numera las variables del cuerpo sin saltos', () => {
    const [body] = payload.components as Array<{ text: string }>;
    const expected = REMINDER_TEMPLATE_VARIABLES.map(
      (_, index) => `{{${index + 1}}}`,
    );
    expect(body.text.match(/\{\{\d+\}\}/g)).toEqual(expected);
  });

  it('declara los botones de respuesta rápida en orden', () => {
    const [, buttons] = payload.components as Array<{
      buttons: Array<{ type: string; text: string }>;
    }>;

    expect(buttons.buttons).toEqual(
      REMINDER_TEMPLATE_BUTTONS.map((text) => ({
        type: 'QUICK_REPLY',
        text,
      })),
    );
  });
});
