import {
  canonicalizeWhatsAppPhone,
  normalizeClientPhone,
  resolveClientPhone,
} from './client-phone.util';

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

describe('canonicalizeWhatsAppPhone', () => {
  it('deja intacto el wa_id, que ya viene en el formato de referencia', () => {
    expect(canonicalizeWhatsAppPhone('59170123456')).toBe('59170123456');
  });

  it('conserva el número del cliente que no es del país del negocio', () => {
    /*
     * Los dos casos que rompía pasar el `wa_id` por `normalizeClientPhone` con
     * el prefijo del negocio boliviano. El argentino se descartaba entero por
     * pasarse de largo; el colombiano entraba justo en el límite y se guardaba
     * como `591573001234567`, un número que no existe.
     */
    expect(canonicalizeWhatsAppPhone('5491123456789')).toBe('5491123456789');
    expect(canonicalizeWhatsAppPhone('573001234567')).toBe('573001234567');
  });

  it('rechaza lo que no llega a ser un teléfono', () => {
    expect(canonicalizeWhatsAppPhone('')).toBeNull();
    expect(canonicalizeWhatsAppPhone('12345')).toBeNull();
    expect(canonicalizeWhatsAppPhone('1'.repeat(16))).toBeNull();
  });
});

describe('resolveClientPhone', () => {
  it('reconoce a la misma persona por sus dos puertas de entrada', () => {
    // El punto entero del resolver: el mismo cliente escribiendo su número
    // local en la página y llegando por WhatsApp tiene que dar el mismo valor.
    const porWhatsApp = resolveClientPhone({
      kind: 'whatsapp',
      value: '59170123456',
    });
    const porFormulario = resolveClientPhone({
      kind: 'typed',
      value: '70123456',
      dialCode: BOLIVIA,
    });

    expect(porWhatsApp).toBe(porFormulario);
  });

  it('no le aplica el prefijo del negocio a lo que viene de WhatsApp', () => {
    expect(
      resolveClientPhone({ kind: 'whatsapp', value: '5491123456789' }),
    ).toBe('5491123456789');
    expect(
      resolveClientPhone({
        kind: 'typed',
        value: '5491123456789',
        dialCode: BOLIVIA,
      }),
      // Sin `+` y sin el prefijo del negocio, escrito a mano, no es utilizable.
      // Es correcto: quien carga un número extranjero desde el panel tiene que
      // escribirlo con `+`, y así el formulario se lo pide.
    ).toBeNull();
  });
});
