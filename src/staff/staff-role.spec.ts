import {
  BOOKABLE_STAFF_WHERE,
  isBookableStaff,
  providesServicesByDefault,
  StaffAccessRole,
} from './staff-role';

describe('isBookableStaff', () => {
  it('acepta a quien está activo y atiende', () => {
    expect(isBookableStaff({ isActive: true, providesServices: true })).toBe(
      true,
    );
  });

  it('rechaza a quien atiende pero está de baja temporal', () => {
    expect(isBookableStaff({ isActive: false, providesServices: true })).toBe(
      false,
    );
  });

  it('rechaza al administrativo activo que no atiende', () => {
    expect(isBookableStaff({ isActive: true, providesServices: false })).toBe(
      false,
    );
  });

  /*
   * Lo que protege este test es que el filtro en memoria y el `where` de SQL no
   * puedan derivar: si alguien agrega una condición a uno solo, esto se cae.
   */
  it('mira exactamente las mismas claves que la cláusula SQL', () => {
    expect(Object.keys(BOOKABLE_STAFF_WHERE).sort()).toEqual([
      'isActive',
      'providesServices',
    ]);
  });
});

describe('providesServicesByDefault', () => {
  it('el profesional atiende', () => {
    expect(providesServicesByDefault(StaffAccessRole.PROFESSIONAL)).toBe(true);
  });

  it('el administrador y el dueño no, hasta que el negocio diga lo contrario', () => {
    expect(providesServicesByDefault(StaffAccessRole.ADMIN)).toBe(false);
    expect(providesServicesByDefault(StaffAccessRole.OWNER)).toBe(false);
  });
});
