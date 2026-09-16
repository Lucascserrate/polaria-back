import {
  CURRENCIES,
  CURRENCY_LOCALES,
  DEFAULT_CURRENCY,
  currencyForTimeZone,
  isSupportedCurrency,
} from './currency';

describe('currencyForTimeZone', () => {
  it('resuelve las zonas de la región', () => {
    expect(currencyForTimeZone('America/La_Paz')).toBe('BOB');
    expect(currencyForTimeZone('America/Bogota')).toBe('COP');
    expect(currencyForTimeZone('America/Lima')).toBe('PEN');
    expect(currencyForTimeZone('America/Sao_Paulo')).toBe('BRL');
  });

  it('cubre toda la familia de zonas de Argentina', () => {
    expect(currencyForTimeZone('America/Argentina/Buenos_Aires')).toBe('ARS');
    expect(currencyForTimeZone('America/Argentina/Ushuaia')).toBe('ARS');
  });

  it('da dólares donde no hay moneda propia', () => {
    expect(currencyForTimeZone('America/Guayaquil')).toBe('USD');
    expect(currencyForTimeZone('America/Panama')).toBe('USD');
  });

  it('cae al valor por defecto en vez de dejar el precio sin unidad', () => {
    expect(currencyForTimeZone('Asia/Tokyo')).toBe(DEFAULT_CURRENCY);
    expect(currencyForTimeZone(null)).toBe(DEFAULT_CURRENCY);
    expect(currencyForTimeZone(undefined)).toBe(DEFAULT_CURRENCY);
  });
});

describe('CURRENCY_LOCALES', () => {
  it('tiene locale para cada moneda soportada', () => {
    // Sin locale el precio se imprime "COP 45.000" en vez de "$ 45.000", que es
    // la mitad del problema que este módulo resuelve.
    for (const code of CURRENCIES) {
      expect(CURRENCY_LOCALES[code]).toBeDefined();
    }
  });
});

describe('isSupportedCurrency', () => {
  it('acepta las de la lista y rechaza el resto', () => {
    expect(isSupportedCurrency('COP')).toBe(true);
    expect(isSupportedCurrency('JPY')).toBe(false);
    expect(isSupportedCurrency('')).toBe(false);
    expect(isSupportedCurrency(null)).toBe(false);
  });
});
