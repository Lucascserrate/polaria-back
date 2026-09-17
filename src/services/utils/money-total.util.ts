/**
 * Sumar plata cuando hay más de una moneda.
 *
 * Un catálogo puede cobrar en dos monedas —la psicóloga cobra las presenciales
 * en bolivianos y las online en dólares—, y ahí "el total" deja de ser un
 * número. Sumar 300 bolivianos con 40 dólares da 340 de nada.
 *
 * La respuesta honesta es una suma por moneda. El negocio de una sola moneda
 * —que son casi todos— recibe una lista de un elemento, que se dibuja igual que
 * antes; el que cobra en dos recibe dos y ve los dos totales.
 */

export interface MoneyTotal {
  currency: string;
  amount: number;
}

interface PricedItem {
  price: number;
  currency: string;
}

/**
 * Los importes agrupados por moneda, de mayor a menor.
 *
 * El orden es por monto y no alfabético para que la moneda principal del
 * negocio quede primera sin que haga falta decirle cuál es: la que más factura
 * es la que el dueño espera leer arriba. A igual monto desempata el código, que
 * es lo que hace el orden estable entre dos llamadas.
 *
 * Una lista vacía devuelve una lista vacía, no un cero: "no facturó nada" no
 * tiene moneda, y quien lo muestre sabe mejor que este módulo en cuál escribir
 * ese cero.
 */
export const sumByCurrency = (items: Iterable<PricedItem>): MoneyTotal[] => {
  const totals = new Map<string, number>();

  for (const item of items) {
    totals.set(item.currency, (totals.get(item.currency) ?? 0) + item.price);
  }

  return [...totals]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort(
      (a, b) => b.amount - a.amount || a.currency.localeCompare(b.currency),
    );
};
