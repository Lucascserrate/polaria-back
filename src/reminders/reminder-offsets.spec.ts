import {
  normalizeReminderOffsets,
  SUPPORTED_REMINDER_OFFSETS,
} from './reminder-offsets';

describe('normalizeReminderOffsets', () => {
  it('ordena del más lejano al más cercano a la cita', () => {
    // Es el orden en que van a salir.
    expect(normalizeReminderOffsets([60, 1440])).toEqual([1440, 60]);
  });

  it('quita repetidos', () => {
    expect(normalizeReminderOffsets([1440, 1440, 60])).toEqual([1440, 60]);
  });

  it('descarta valores que no se soportan', () => {
    // Un valor raro acá no produce un error visible: produce un recordatorio a
    // una hora absurda.
    expect(normalizeReminderOffsets([1440, 7, -60, 0])).toEqual([1440]);
  });

  it('descarta lo que no es un entero', () => {
    expect(normalizeReminderOffsets([1440, 'mañana', null, 90.5])).toEqual([
      1440,
    ]);
  });

  it('una lista vacía significa recordatorios apagados', () => {
    expect(normalizeReminderOffsets([])).toEqual([]);
  });

  it('tolera una columna que no tiene una lista', () => {
    // La columna es JSON: su contenido no lo garantiza el esquema.
    for (const raw of [null, undefined, 1440, {}, 'x']) {
      expect(normalizeReminderOffsets(raw)).toEqual([]);
    }
  });

  it('acepta todas las anticipaciones soportadas', () => {
    expect(normalizeReminderOffsets([...SUPPORTED_REMINDER_OFFSETS])).toEqual(
      [...SUPPORTED_REMINDER_OFFSETS].sort((a, b) => b - a),
    );
  });
});
