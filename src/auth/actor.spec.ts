import { actorFrom, ADMIN_ROLES, canAdminister } from './actor';
import { StaffAccessRole } from '../staff/staff-role';

describe('actorFrom', () => {
  it('lee el actor completo de un token del equipo', () => {
    expect(
      actorFrom({
        sub: 'tenant-1',
        email: 'marco@barberia.com',
        actorId: 'staff-9',
        role: 'PROFESSIONAL',
      }),
    ).toEqual({
      tenantId: 'tenant-1',
      staffId: 'staff-9',
      role: StaffAccessRole.PROFESSIONAL,
      email: 'marco@barberia.com',
      impersonatedBy: null,
    });
  });

  /*
   * La sesión de soporte es, para todo el backend, una sesión de dueño: mismo
   * tenant y mismo rol, porque el objetivo es ver lo mismo que ve el negocio.
   * Lo único que la distingue es de dónde vino, y eso es lo que se comprueba acá.
   */
  it('un token de soporte dice quién lo abrió, y sigue siendo del dueño', () => {
    const actor = actorFrom({
      sub: 'tenant-1',
      email: 'dueño@barberia.com',
      role: 'OWNER',
      imp: true,
      act: 'soporte@polaria.com',
    });

    expect(actor.impersonatedBy).toBe('soporte@polaria.com');
    expect(actor.role).toBe(StaffAccessRole.OWNER);
    expect(actor.tenantId).toBe('tenant-1');
  });

  /*
   * `imp` sin `act` no debería existir —lo firma una sola función— pero si
   * apareciera, lo importante es que siga contando como suplantación: leerlo
   * como una sesión normal sería perder el bloqueo de envíos y la barra en
   * pantalla justo en el token que vino raro.
   */
  it('una sesión marcada sin autor sigue siendo de soporte', () => {
    expect(actorFrom({ sub: 'tenant-1', imp: true }).impersonatedBy).toBe(
      'desconocido',
    );
  });

  /*
   * Los tokens emitidos antes de que existiera el acceso del equipo no traen
   * `role`, y duran treinta días. Eran todos de dueños: leerlos como un rol menor
   * habría dejado a los negocios sin panel hasta que vencieran.
   */
  it('un token sin rol ni actor es del dueño', () => {
    const actor = actorFrom({ sub: 'tenant-1', email: 'dueño@barberia.com' });

    expect(actor.role).toBe(StaffAccessRole.OWNER);
    expect(actor.staffId).toBeNull();
  });

  /*
   * Ante un token que no entendemos hay que dar de menos, no de más. Con `actorId`
   * presente ya sabemos que no es el dueño, así que cae al rol con menos permisos.
   */
  it('un rol desconocido cae a profesional, no a dueño', () => {
    expect(
      actorFrom({ sub: 'tenant-1', actorId: 'staff-9', role: 'SUPERUSER' })
        .role,
    ).toBe(StaffAccessRole.PROFESSIONAL);
  });

  it('un token con actor pero sin rol también cae a profesional', () => {
    expect(actorFrom({ sub: 'tenant-1', actorId: 'staff-9' }).role).toBe(
      StaffAccessRole.PROFESSIONAL,
    );
  });

  it('el email ausente queda en null y no en undefined', () => {
    expect(actorFrom({ sub: 'tenant-1' }).email).toBeNull();
  });
});

describe('canAdminister', () => {
  const actor = (role: StaffAccessRole) =>
    actorFrom({ sub: 'tenant-1', actorId: 'staff-1', role });

  it('el dueño y el administrador pueden', () => {
    expect(canAdminister(actor(StaffAccessRole.OWNER))).toBe(true);
    expect(canAdminister(actor(StaffAccessRole.ADMIN))).toBe(true);
  });

  it('el profesional no', () => {
    expect(canAdminister(actor(StaffAccessRole.PROFESSIONAL))).toBe(false);
  });

  /*
   * Si mañana se agrega un rol a `StaffAccessRole`, este test se cae y obliga a
   * decidir explícitamente si administra o no —en lugar de que herede el permiso
   * por descuido, que es la forma en la que estas listas se aflojan solas.
   */
  it('solo dos roles administran', () => {
    expect([...ADMIN_ROLES].sort()).toEqual(['ADMIN', 'OWNER']);
    expect(Object.values(StaffAccessRole)).toHaveLength(3);
  });
});
