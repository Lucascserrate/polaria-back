import { formatPrice } from './price-format.util';

describe('formatPrice', () => {
  it('formatea con la moneda del negocio', () => {
    expect(formatPrice(80, 'BOB')).toContain('80');
    expect(formatPrice(8000, 'ARS')).toContain('8.000');
  });

  it('usa el símbolo local de cada moneda, no el código', () => {
    // El símbolo lo elige el locale: formatear BOB con es-AR imprimiría
    // "BOB 8.000" en lugar de "Bs 8.000".
    expect(formatPrice(8000, 'BOB')).toContain('Bs');
    expect(formatPrice(8000, 'ARS')).toContain('$');

    expect(formatPrice(8000, 'BOB')).not.toContain('BOB');
    expect(formatPrice(8000, 'ARS')).not.toContain('ARS');
  });

  it('acepta el string que devuelve TypeORM para columnas decimal', () => {
    // MySQL entrega `decimal` como string; sin esto saldría NaN en la lista.
    expect(formatPrice('80.00', 'BOB')).toBe(formatPrice(80, 'BOB'));
  });

  it('redondea: los centavos solo agregan ruido en una lista', () => {
    expect(formatPrice(79.6, 'BOB')).toBe(formatPrice(80, 'BOB'));
  });

  it('cae a la moneda por defecto si falta o es inválida', () => {
    const fallback = formatPrice(80, 'BOB');

    expect(formatPrice(80, null)).toBe(fallback);
    expect(formatPrice(80, '')).toBe(fallback);
    expect(formatPrice(80, 'pesos')).toBe(fallback);
  });

  it('normaliza el código a mayúsculas', () => {
    expect(formatPrice(80, 'ars')).toBe(formatPrice(80, 'ARS'));
  });

  it('devuelve null ante un precio inutilizable, en vez de mostrar NaN', () => {
    expect(formatPrice(null, 'BOB')).toBeNull();
    expect(formatPrice(undefined, 'BOB')).toBeNull();
    expect(formatPrice('sin precio', 'BOB')).toBeNull();
  });

  it('no lanza con un código de tres letras inexistente', () => {
    expect(formatPrice(80, 'XYZ')).toContain('80');
  });
});
