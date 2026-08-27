import {
  isNotifiableStaff,
  notificationFingerprint,
  planCancelled,
  planCreated,
  planEdited,
  resolveRecipient,
  STAFF_NOTIFICATION_REASONS,
  type NotifiableSegment,
} from './staff-notification.rules';
import { StaffAlertEvent } from '../whatsapp/staff-alert-template';

const AT_16 = new Date('2026-08-21T20:00:00.000Z');
const AT_17 = new Date('2026-08-21T21:00:00.000Z');

const seg = (
  staffId: string | null,
  serviceId: string,
  startTime = AT_16,
): NotifiableSegment => ({ staffId, serviceId, startTime });

const staff = (overrides: Record<string, unknown> = {}) => ({
  id: 'staff-1',
  isActive: true,
  providesServices: true,
  phone: '+59170000000',
  deletedAt: null,
  ...overrides,
});

describe('isNotifiableStaff', () => {
  it('acepta a quien atiende y está activo', () => {
    expect(isNotifiableStaff(staff())).toBe(true);
  });

  /*
   * Deliberadamente no mira el rol. Un administrador que además atiende tiene que
   * enterarse de sus citas: es el mismo caso del dueño-barbero que motivó separar
   * `accessRole` de `providesServices`.
   */
  it('acepta al administrador que también atiende', () => {
    expect(isNotifiableStaff(staff({ providesServices: true }))).toBe(true);
  });

  it('rechaza a quien no atiende clientes', () => {
    expect(isNotifiableStaff(staff({ providesServices: false }))).toBe(false);
  });

  it('rechaza a quien está inactivo', () => {
    expect(isNotifiableStaff(staff({ isActive: false }))).toBe(false);
  });

  // La puerta que el rol no cierra: dado de baja sigue teniendo `isActive` en la
  // fila vieja si nadie la tocó, pero ya no forma parte del equipo.
  it('rechaza a quien fue dado de baja', () => {
    expect(isNotifiableStaff(staff({ deletedAt: new Date() }))).toBe(false);
  });
});

describe('resolveRecipient', () => {
  it('devuelve el teléfono de quien corresponde', () => {
    expect(resolveRecipient(staff())).toEqual({
      kind: 'SEND',
      phone: '+59170000000',
    });
  });

  /*
   * "No le toca" y "no hay a dónde escribirle" son dos negativas distintas y
   * mandan al negocio a resolver cosas diferentes: una es un cambio de
   * configuración, la otra es cargar un dato que falta.
   */
  it('distingue el inelegible del que no tiene teléfono', () => {
    expect(resolveRecipient(staff({ providesServices: false })).kind).toBe(
      'SKIP',
    );
    expect(resolveRecipient(staff({ providesServices: false }))).toEqual({
      kind: 'SKIP',
      reason: STAFF_NOTIFICATION_REASONS.STAFF_NOT_ELIGIBLE,
    });
    expect(resolveRecipient(staff({ phone: null }))).toEqual({
      kind: 'SKIP',
      reason: STAFF_NOTIFICATION_REASONS.NO_STAFF_PHONE,
    });
  });

  it('el teléfono en blanco no es un teléfono', () => {
    expect(resolveRecipient(staff({ phone: '   ' })).kind).toBe('SKIP');
  });

  it('sin profesional en el tramo, lo dice', () => {
    expect(resolveRecipient(null)).toEqual({
      kind: 'SKIP',
      reason: STAFF_NOTIFICATION_REASONS.NO_STAFF,
    });
  });
});

describe('planCreated', () => {
  /*
   * El punto 3: cada profesional ve su servicio, no el del otro. Son dos avisos y
   * no uno con las dos líneas.
   */
  it('genera un aviso por tramo', () => {
    const planned = planCreated([
      seg('juan', 'corte'),
      seg('pedro', 'barba', AT_17),
    ]);

    expect(planned).toHaveLength(2);
    expect(planned.map((p) => [p.staffId, p.serviceId])).toEqual([
      ['juan', 'corte'],
      ['pedro', 'barba'],
    ]);
    expect(planned.every((p) => p.event === StaffAlertEvent.CREATED)).toBe(
      true,
    );
  });

  it('dos servicios de la misma persona son dos avisos', () => {
    // Son dos bloques distintos de su agenda, aunque sea la misma cita.
    expect(
      planCreated([seg('diego', 'corte'), seg('diego', 'color')]),
    ).toHaveLength(2);
  });

  it('ignora los tramos sin profesional', () => {
    expect(planCreated([seg(null, 'corte')])).toEqual([]);
  });
});

describe('planCancelled', () => {
  it('avisa a cada profesional que tenía un tramo', () => {
    const planned = planCancelled([
      seg('juan', 'corte'),
      seg('pedro', 'barba'),
    ]);

    expect(planned).toHaveLength(2);
    expect(planned.every((p) => p.event === StaffAlertEvent.CANCELLED)).toBe(
      true,
    );
  });
});

describe('planEdited', () => {
  /*
   * El caso exacto del punto 11: Barba pasa de Pedro a Carlos, Corte se queda con
   * Juan y a la misma hora.
   */
  it('cancela al que sale, avisa al que entra y no molesta al que no cambió', () => {
    const planned = planEdited({
      before: [seg('juan', 'corte'), seg('pedro', 'barba', AT_17)],
      after: [seg('juan', 'corte'), seg('carlos', 'barba', AT_17)],
    });

    const byStaff = new Map(planned.map((p) => [p.staffId, p.event]));

    expect(byStaff.get('pedro')).toBe(StaffAlertEvent.CANCELLED);
    expect(byStaff.get('carlos')).toBe(StaffAlertEvent.CREATED);
    // Lo que importa: Juan no aparece.
    expect(byStaff.has('juan')).toBe(false);
    expect(planned).toHaveLength(2);
  });

  it('avisa la reprogramación a quien se le movió la hora', () => {
    const planned = planEdited({
      before: [seg('juan', 'corte', AT_16)],
      after: [seg('juan', 'corte', AT_17)],
    });

    expect(planned).toEqual([
      {
        staffId: 'juan',
        event: StaffAlertEvent.RESCHEDULED,
        serviceId: 'corte',
        startTime: AT_17,
        previousStartTime: AT_16,
      },
    ]);
  });

  it('una edición que no cambió nada no avisa a nadie', () => {
    expect(
      planEdited({
        before: [seg('juan', 'corte'), seg('pedro', 'barba', AT_17)],
        after: [seg('juan', 'corte'), seg('pedro', 'barba', AT_17)],
      }),
    ).toEqual([]);
  });

  /*
   * La reprogramación por WhatsApp manda un solo servicio, así que reprogramar una
   * cita de dos deja el segundo afuera. Es una pérdida de datos previa a esta
   * función; lo que se comprueba acá es que el aviso la refleje con honestidad en
   * lugar de silenciarla.
   */
  it('el servicio que la edición deja afuera se avisa como cancelado', () => {
    const planned = planEdited({
      before: [seg('juan', 'corte'), seg('pedro', 'barba', AT_17)],
      after: [seg('juan', 'corte', AT_17)],
    });

    const byStaff = new Map(planned.map((p) => [p.staffId, p.event]));

    expect(byStaff.get('pedro')).toBe(StaffAlertEvent.CANCELLED);
    expect(byStaff.get('juan')).toBe(StaffAlertEvent.RESCHEDULED);
  });

  it('cambiar de servicio con el mismo profesional es baja y alta', () => {
    const planned = planEdited({
      before: [seg('juan', 'corte')],
      after: [seg('juan', 'barba')],
    });

    expect(planned.map((p) => [p.event, p.serviceId]).sort()).toEqual([
      [StaffAlertEvent.CANCELLED, 'corte'],
      [StaffAlertEvent.CREATED, 'barba'],
    ]);
  });
});

describe('notificationFingerprint', () => {
  /*
   * Las dos propiedades que sostienen la idempotencia, y tienen que valer las dos a
   * la vez.
   */
  it('la misma acción repetida produce la misma huella', () => {
    expect(
      notificationFingerprint({ serviceId: 'corte', startTime: AT_16 }),
    ).toBe(notificationFingerprint({ serviceId: 'corte', startTime: AT_16 }));
  });

  it('una reprogramación real produce otra huella', () => {
    expect(
      notificationFingerprint({ serviceId: 'corte', startTime: AT_16 }),
    ).not.toBe(
      notificationFingerprint({ serviceId: 'corte', startTime: AT_17 }),
    );
  });

  it('y otro servicio a la misma hora también', () => {
    expect(
      notificationFingerprint({ serviceId: 'corte', startTime: AT_16 }),
    ).not.toBe(
      notificationFingerprint({ serviceId: 'barba', startTime: AT_16 }),
    );
  });
});
