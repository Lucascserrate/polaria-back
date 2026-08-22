/**
 * Rubros que Polaria reconoce.
 *
 * Se guardan códigos estables y no la etiqueta que ve el usuario: el texto va a
 * cambiar —"Salones" hoy, "Peluquería y estética" mañana— y traducirlo es
 * problema de la interfaz, no de la base.
 *
 * La lista es cerrada porque el rubro va a alimentar decisiones de producto
 * (plantillas de servicios sugeridos, tono del asistente). Un campo libre daría
 * "barberia", "Barbería " y "BARBER SHOP" como tres rubros distintos.
 *
 * `OTHER` existe para no bloquear a un negocio cuyo rubro todavía no está en la
 * lista: es preferible perder la clasificación antes que el registro.
 */
export const BUSINESS_TYPES = [
  'BARBERSHOP',
  'SALON',
  'SPA',
  'AESTHETIC_MEDICINE',
  'DENTAL_CLINIC',
  'OTHER',
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];
