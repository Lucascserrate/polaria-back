import { describeServices, describeStaff } from './appointment-naming';

const segment = (service: string | null, staff: string | null = null) => ({
  service: service === null ? null : { name: service },
  staff: staff === null ? null : { name: staff },
});

describe('describeServices', () => {
  it('nombra un servicio tal cual', () => {
    expect(describeServices([segment('Corte')])).toBe('Corte');
  });

  it('une dos con "y", que es como se dice en voz alta', () => {
    expect(describeServices([segment('Corte'), segment('Barba')])).toBe(
      'Corte y Barba',
    );
  });

  it('con tres usa coma y deja la "y" para el último', () => {
    expect(
      describeServices([
        segment('Corte'),
        segment('Barba'),
        segment('Perfilado'),
      ]),
    ).toBe('Corte, Barba y Perfilado');
  });

  /*
   * Esto termina en la descripción de una fila de WhatsApp, que se corta a los
   * 72 caracteres. Resumir es peor que nombrarlos a todos, y mucho mejor que
   * que el texto se corte a la mitad de una palabra.
   */
  it('a partir del cuarto resume el resto en lugar de crecer', () => {
    expect(
      describeServices([
        segment('Corte'),
        segment('Barba'),
        segment('Perfilado'),
        segment('Color'),
        segment('Lavado'),
      ]),
    ).toBe('Corte, Barba, Perfilado y 2 más');
  });

  /*
   * Una cita sin la relación cargada no puede quedar con el nombre en blanco:
   * el mismo texto que usaba WhatsApp antes de que esto existiera.
   */
  it('sin nombres cae en "Turno"', () => {
    expect(describeServices([segment(null)])).toBe('Turno');
    expect(describeServices([])).toBe('Turno');
  });
});

describe('describeStaff', () => {
  it('devuelve null cuando no vino nadie', () => {
    expect(describeStaff([segment('Corte')])).toBeNull();
  });

  /*
   * El caso normal de una reserva de dos servicios: los hace la misma persona.
   * "Con Fernando y Fernando" no es un detalle, es un error de lectura.
   */
  it('no repite a quien atiende los dos servicios', () => {
    expect(
      describeStaff([
        segment('Corte', 'Fernando'),
        segment('Barba', 'Fernando'),
      ]),
    ).toBe('Fernando');
  });

  it('nombra a los dos cuando la reserva está repartida', () => {
    expect(
      describeStaff([segment('Corte', 'Diego'), segment('Barba', 'Carlos')]),
    ).toBe('Diego y Carlos');
  });
});
