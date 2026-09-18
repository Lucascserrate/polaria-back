import { hasPrice, toPrice } from './quoted-price';

describe('toPrice', () => {
  it('acepta el string que devuelve TypeORM para columnas decimal', () => {
    expect(toPrice('80.00')).toBe(80);
  });

  it('devuelve null cuando no hay precio, no cero', () => {
    // Es la razón de existir del módulo: `Number(null)` da 0, y ese 0 se guarda,
    // se suma y termina mostrándose como un servicio gratis.
    expect(toPrice(null)).toBeNull();
    expect(toPrice(undefined)).toBeNull();
    expect(toPrice('')).toBeNull();
  });

  it('conserva el cero, que sí es un precio', () => {
    expect(toPrice(0)).toBe(0);
    expect(toPrice('0.00')).toBe(0);
  });

  it('trata un valor inutilizable como ausente', () => {
    expect(toPrice('gratis')).toBeNull();
    expect(toPrice(Number.NaN)).toBeNull();
  });
});

describe('hasPrice', () => {
  it('distingue el que no cobra del que todavía no sabe cuánto cobra', () => {
    expect(hasPrice(0)).toBe(true);
    expect(hasPrice(null)).toBe(false);
  });
});
