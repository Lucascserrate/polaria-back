/**
 * El rol de un miembro del equipo y qué lo hace reservable.
 *
 * Son dos preguntas distintas y por eso son dos columnas. `accessRole` dice qué
 * puede hacer la persona **dentro de Polaria**; `providesServices` dice si
 * atiende clientes. Con un solo enum, el dueño que además corta pelo tendría que
 * elegir entre administrar su negocio y aparecer en la agenda, que es el caso más
 * común de una barbería y no una excepción.
 */

export enum StaffAccessRole {
  /** Dueño del negocio. Es quien registró la cuenta. */
  OWNER = 'OWNER',
  /** Administra el negocio sin atender, salvo que `providesServices` diga otra cosa. */
  ADMIN = 'ADMIN',
  /** Atiende clientes y ve solo lo suyo. */
  PROFESSIONAL = 'PROFESSIONAL',
}

export const STAFF_ACCESS_ROLES: readonly StaffAccessRole[] = [
  StaffAccessRole.OWNER,
  StaffAccessRole.ADMIN,
  StaffAccessRole.PROFESSIONAL,
];

/** Lo mínimo para decidir si alguien puede recibir reservas. */
export interface BookableStaffFlags {
  isActive: boolean;
  providesServices: boolean;
}

/**
 * Condición de reservabilidad, como cláusula `where` de TypeORM.
 *
 * Fuente única para las tres consultas que deciden quién puede recibir una
 * reserva: el catálogo de disponibilidad, la lista de candidatos de un servicio y
 * la validación al guardar una cita. Si divergieran, el panel ofrecería a alguien
 * que después el guardado rechaza —o peor, al revés.
 *
 * Se exporta el objeto y no tres literales sueltos justamente para que agregar
 * una condición futura llegue sola a los tres lugares.
 */
export const BOOKABLE_STAFF_WHERE = {
  isActive: true,
  providesServices: true,
} as const;

/**
 * El mismo criterio que `BOOKABLE_STAFF_WHERE`, para filtrar en memoria.
 *
 * Existe porque hay un consumidor que ya tiene el equipo cargado —el conteo de
 * onboarding— y volver a consultarlo solo para aplicar el filtro sería una
 * consulta de más. Se deriva del mismo objeto: no es una segunda definición de la
 * regla, es la misma leída de otra forma.
 */
export const isBookableStaff = (member: BookableStaffFlags): boolean =>
  member.isActive === BOOKABLE_STAFF_WHERE.isActive &&
  member.providesServices === BOOKABLE_STAFF_WHERE.providesServices;

/**
 * Si el rol, por sí solo, sugiere que la persona atiende.
 *
 * Es únicamente el valor inicial cuando se elige un rol en el panel: quien manda
 * después es `providesServices`, que el negocio puede cambiar sin cambiar el rol.
 * Un administrador que también atiende es una configuración válida, no un
 * estado inconsistente que haya que corregir.
 */
export const providesServicesByDefault = (role: StaffAccessRole): boolean =>
  role === StaffAccessRole.PROFESSIONAL;
