/**
 * El acceso de un miembro del equipo a Polaria.
 *
 * Tener email no da acceso. Son tres cosas separadas a propósito —quién es la
 * persona, qué hace en el negocio, y si puede entrar al sistema— y esta capa es
 * la tercera.
 *
 * De ahí que `accessEmail` sea una columna distinta de `email`. No es duplicar un
 * dato: `email` es de contacto y se corrige cuando alguien detecta un typo, y la
 * identidad con la que se inicia sesión **no puede cambiar como efecto
 * secundario** de esa corrección. Además permite el índice único que `email` no
 * podría tener, porque esa columna también guarda correos de gente sin acceso.
 */

export enum StaffAccessState {
  /** Nadie le habilitó el acceso. Es el estado por defecto. */
  NONE = 'NONE',
  /** Tiene el acceso habilitado pero todavía no entró ni una vez. */
  INVITED = 'INVITED',
  /** Entró: su cuenta de Google quedó vinculada. */
  ACTIVE = 'ACTIVE',
}

export interface StaffAccessFlags {
  accessEmail?: string | null;
  accessGoogleId?: string | null;
}

/**
 * En qué estado está el acceso de alguien.
 *
 * `accessGoogleId` sin `accessEmail` no es un estado posible —revocar borra los
 * dos— pero si apareciera se lee como sin acceso: lo que habilita entrar es el
 * correo, y sin él no hay nada que buscar en el login.
 */
export const accessStateOf = (staff: StaffAccessFlags): StaffAccessState => {
  if (!staff.accessEmail?.trim()) return StaffAccessState.NONE;

  return staff.accessGoogleId
    ? StaffAccessState.ACTIVE
    : StaffAccessState.INVITED;
};

export const hasAccess = (staff: StaffAccessFlags): boolean =>
  accessStateOf(staff) !== StaffAccessState.NONE;

/**
 * Deja un correo en la forma en la que se guarda y se compara.
 *
 * Google devuelve el correo tal como lo escribió la persona, y el mismo buzón
 * puede llegar como `Lucas@Gmail.com` o `lucas@gmail.com`. Sin normalizar, el
 * índice único los tomaría como dos correos distintos y la búsqueda del login
 * fallaría contra el que quedó guardado con otras mayúsculas.
 */
export const normalizeAccessEmail = (email: string): string =>
  email.trim().toLowerCase();
