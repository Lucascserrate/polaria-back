import { toMoney } from './report-numbers.util';

/**
 * Cuánto le corresponde a un profesional de lo que facturó.
 *
 * Es un único lugar y no la cuenta escrita dos veces porque hoy la comisión se
 * informa en dos reportes distintos —el ranking del equipo, que mira el dueño, y
 * el reporte propio del profesional— y los dos tienen que decir el mismo número.
 * Si mañana la comisión deja de ser un porcentaje plano, este archivo es el que
 * cambia.
 */

/**
 * La tasa como número, o `null` si el negocio no configuró comisión.
 *
 * `null` y `0` son cosas distintas: el primero es "acá no se trabaja a comisión"
 * —sueldo fijo, alquiler de silla— y el segundo es una comisión de cero. La
 * diferencia importa porque decide si la pantalla del profesional habla de
 * comisión o solo de lo generado.
 *
 * Llega como string porque es el `decimal` de MySQL ("30.00").
 */
export const parseCommissionRate = (
  value: string | number | null | undefined,
): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const rate = Number(value);
  return Number.isFinite(rate) ? rate : null;
};

/**
 * La comisión **estimada** sobre lo facturado en un período.
 *
 * Estimada, y no liquidada, por dos motivos que conviene no perder de vista al
 * mostrarla: se aplica la tasa vigente hoy y no la que regía el día de cada
 * servicio —ver `commissionRate` en la entidad `Staff`—, y no existe registro de
 * pagos, así que este número no sabe nada de lo que ya se cobró.
 *
 * El monto entra sin redondear y sale redondeado: redondear antes de aplicar el
 * porcentaje sería redondear dos veces.
 */
export const estimateCommission = (
  revenue: number,
  rate: number | null,
): number | null => (rate === null ? null : toMoney((revenue * rate) / 100));
