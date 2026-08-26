import {
  accessStateOf,
  hasAccess,
  normalizeAccessEmail,
  StaffAccessState,
} from './staff-access';

describe('accessStateOf', () => {
  it('sin correo de acceso, no hay acceso', () => {
    expect(accessStateOf({})).toBe(StaffAccessState.NONE);
    expect(accessStateOf({ accessEmail: null })).toBe(StaffAccessState.NONE);
  });

  it('un correo en blanco no habilita nada', () => {
    expect(accessStateOf({ accessEmail: '   ' })).toBe(StaffAccessState.NONE);
  });

  it('con correo y sin cuenta vinculada, la invitación está pendiente', () => {
    expect(accessStateOf({ accessEmail: 'marco@barberia.com' })).toBe(
      StaffAccessState.INVITED,
    );
  });

  it('con cuenta vinculada, el acceso está activo', () => {
    expect(
      accessStateOf({
        accessEmail: 'marco@barberia.com',
        accessGoogleId: 'google-1',
      }),
    ).toBe(StaffAccessState.ACTIVE);
  });

  /*
   * `revokeAccess` borra los dos campos, así que este estado no lo produce el
   * sistema. Si apareciera —una fila tocada a mano, una migración a medias— lo que
   * habilita entrar es el correo: sin él no hay nada que buscar en el login, y
   * leerlo como acceso activo dejaría entrar a alguien a quien se le revocó.
   */
  it('una cuenta vinculada sin correo se lee como sin acceso', () => {
    expect(accessStateOf({ accessGoogleId: 'google-1' })).toBe(
      StaffAccessState.NONE,
    );
  });
});

describe('hasAccess', () => {
  it('la invitación pendiente ya cuenta como acceso', () => {
    expect(hasAccess({ accessEmail: 'marco@barberia.com' })).toBe(true);
  });

  it('sin correo, no', () => {
    expect(hasAccess({})).toBe(false);
  });
});

describe('normalizeAccessEmail', () => {
  /*
   * Google devuelve el correo como lo escribió la persona. Sin normalizar, el
   * índice único tomaría `Lucas@Gmail.com` y `lucas@gmail.com` como dos correos
   * distintos, y la búsqueda del login fallaría contra el que quedó guardado con
   * otras mayúsculas.
   */
  it('baja a minúsculas y recorta', () => {
    expect(normalizeAccessEmail('  Lucas@Gmail.COM ')).toBe('lucas@gmail.com');
  });

  it('es idempotente', () => {
    const once = normalizeAccessEmail('Marco@Barberia.com');
    expect(normalizeAccessEmail(once)).toBe(once);
  });
});
