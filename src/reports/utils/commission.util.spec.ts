import { estimateCommission, parseCommissionRate } from './commission.util';

describe('parseCommissionRate', () => {
  it('lee el decimal que manda MySQL como string', () => {
    expect(parseCommissionRate('30.00')).toBe(30);
    expect(parseCommissionRate('12.50')).toBe(12.5);
  });

  it('distingue "sin comisión" de una comisión de cero', () => {
    expect(parseCommissionRate(null)).toBeNull();
    expect(parseCommissionRate(undefined)).toBeNull();
    expect(parseCommissionRate('')).toBeNull();
    expect(parseCommissionRate('0.00')).toBe(0);
  });

  it('trata un valor ilegible como falta de tasa', () => {
    expect(parseCommissionRate('nada')).toBeNull();
  });
});

describe('estimateCommission', () => {
  it('aplica el porcentaje sobre lo facturado', () => {
    expect(estimateCommission(200, 30)).toBe(60);
  });

  it('no inventa una comisión cuando el negocio no configuró tasa', () => {
    expect(estimateCommission(200, null)).toBeNull();
  });

  it('con tasa cero informa cero, no "sin comisión"', () => {
    expect(estimateCommission(200, 0)).toBe(0);
  });

  it('redondea a centavos una sola vez, al final', () => {
    // 33.33% de 150.55 son 50.178..., no un monto que se pueda pagar.
    expect(estimateCommission(150.55, 33.33)).toBe(50.18);
  });
});
