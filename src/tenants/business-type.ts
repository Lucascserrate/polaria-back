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
 * Cerrada no quiere decir corta: cuanto más fino sea el rubro, mejor la
 * plantilla de servicios que se puede sugerir. Un centro de depilación y una
 * peluquería no comparten ni un servicio, y meter a los dos en `SALON` obliga a
 * preguntar de nuevo más adelante lo que acá se podía saber de una.
 *
 * Solo se agregan códigos al final del ciclo de vida de un rubro: el valor está
 * escrito en la ficha de negocios que ya se registraron, así que renombrar un
 * código es una migración y quitar uno deja fichas apuntando a la nada.
 *
 * `OTHER` existe para no bloquear a un negocio cuyo rubro todavía no está en la
 * lista: es preferible perder la clasificación antes que el registro.
 */
export const BUSINESS_TYPES = [
  'HAIR_SALON',
  'NAIL_SALON',
  'BROWS_LASHES',
  'SALON',
  'AESTHETIC_MEDICINE',
  'BARBERSHOP',
  'MASSAGE',
  'SPA',
  'WAXING',
  'TATTOO_PIERCING',
  'TANNING',
  'FITNESS',
  'PHYSIOTHERAPY',
  'HEALTH_CLINIC',
  'DENTAL_CLINIC',
  'PET_GROOMING',
  'OTHER',
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];
