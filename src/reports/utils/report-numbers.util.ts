/**
 * Las dos conversiones que todo agregado de reportes necesita.
 *
 * Viven acá y no en el servicio porque los helpers de comisión hacen la misma
 * cuenta de plata: con una copia en cada lado, un redondeo distinto haría que la
 * comisión no cerrara con lo facturado que la produjo.
 */

/** MySQL devuelve los `SUM`/`COUNT` y los `decimal` como string, o `null`. */
export const toNumber = (value: string | number | null | undefined): number =>
  Number(value ?? 0);

/** Los montos se exponen ya redondeados: son plata, no promedios crudos. */
export const toMoney = (value: number): number => Math.round(value * 100) / 100;
