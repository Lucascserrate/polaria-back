import { normalizeClientPhone } from './client-phone.util';

const BOLIVIA = '591';

describe('normalizeClientPhone', () => {
  it('antepone el país al número local, que es como lo escribe la gente', () => {
    expect(normalizeClientPhone('70123456', BOLIVIA)).toBe('59170123456');
  });

  it('produce el mismo valor que guarda WhatsApp', () => {
    // Es la razón de existir del módulo: sin esto, el mismo cliente entraría dos
    // veces —una por WhatsApp y otra por la página— y perdería su historial.
    const fromWhatsApp = '59170123456';

    expect(normalizeClientPhone('70123456', BOLIVIA)).toBe(fromWhatsApp);
    expect(normalizeClientPhone('+591 70 123 456', BOLIVIA)).toBe(fromWhatsApp);
    expect(normalizeClientPhone('(591) 7012-3456', BOLIVIA)).toBe(fromWhatsApp);
    expect(normalizeClientPhone('0059170123456', BOLIVIA)).toBe(fromWhatsApp);
  });

  it('no le agrega el país a un número que ya lo trae', () => {
    // El cliente de otro país es el caso que esto protege: anteponerle el
    // prefijo local le rompería el número.
    expect(normalizeClientPhone('+54 9 11 2345 6789', BOLIVIA)).toBe(
      '5491123456789',
    );
  });

  it('rechaza lo que no alcanza a ser un teléfono', () => {
    expect(normalizeClientPhone('', BOLIVIA)).toBeNull();
    expect(normalizeClientPhone('   ', BOLIVIA)).toBeNull();
    expect(normalizeClientPhone('no tengo', BOLIVIA)).toBeNull();
    expect(normalizeClientPhone('12345', BOLIVIA)).toBeNull();
  });

  it('rechaza lo que se pasa del largo de E.164', () => {
    // Guardar un número inventado es peor que rechazar el formulario: el
    // recordatorio se va a un número que no existe y nadie se entera.
    expect(normalizeClientPhone('1'.repeat(16), BOLIVIA)).toBeNull();
    expect(normalizeClientPhone('1'.repeat(13), BOLIVIA)).toBeNull();
  });
});
