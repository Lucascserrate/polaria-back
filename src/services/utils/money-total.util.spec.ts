import { sumByCurrency } from './money-total.util';

describe('sumByCurrency', () => {
  it('suma cada moneda por separado en vez de mezclarlas', () => {
    // 300 bolivianos más 40 dólares no son 340 de nada.
    expect(
      sumByCurrency([
        { price: 300, currency: 'BOB' },
        { price: 40, currency: 'USD' },
        { price: 100, currency: 'BOB' },
      ]),
    ).toEqual([
      { currency: 'BOB', amount: 400 },
      { currency: 'USD', amount: 40 },
    ]);
  });

  it('devuelve una sola entrada cuando el negocio cobra en una moneda', () => {
    // Que es el caso de casi todos: la pantalla se dibuja igual que antes.
    expect(
      sumByCurrency([
        { price: 50, currency: 'BOB' },
        { price: 40, currency: 'BOB' },
      ]),
    ).toEqual([{ currency: 'BOB', amount: 90 }]);
  });

  it('ordena por monto y desempata por código', () => {
    expect(
      sumByCurrency([
        { price: 10, currency: 'USD' },
        { price: 10, currency: 'ARS' },
        { price: 99, currency: 'BOB' },
      ]).map((total) => total.currency),
    ).toEqual(['BOB', 'ARS', 'USD']);
  });

  it('sin importes devuelve vacío y no un cero sin moneda', () => {
    expect(sumByCurrency([])).toEqual([]);
  });

  it('lo que no tiene precio no suma como cero: no suma', () => {
    expect(
      sumByCurrency([
        { price: 50, currency: 'BOB' },
        { price: null, currency: 'BOB' },
      ]),
    ).toEqual([{ currency: 'BOB', amount: 50 }]);
  });

  it('una cita entera sin precio devuelve vacío, no un total en cero', () => {
    // Quien lo muestre tiene que decir que falta un precio; un "Bs 0" sería
    // decir que la cita no se cobra.
    expect(sumByCurrency([{ price: null, currency: 'BOB' }])).toEqual([]);
  });
});
