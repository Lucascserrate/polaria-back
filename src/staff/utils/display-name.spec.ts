import { displayNameOf, splitFullName } from './display-name';

describe('displayNameOf', () => {
  it('junta nombre y apellido', () => {
    expect(displayNameOf({ firstName: 'Lucas', lastName: 'Serrate' })).toBe(
      'Lucas Serrate',
    );
  });

  it('sin apellido devuelve solo el nombre, sin espacio colgando', () => {
    expect(displayNameOf({ firstName: 'Lucas', lastName: null })).toBe('Lucas');
    expect(displayNameOf({ firstName: 'Lucas' })).toBe('Lucas');
  });

  it('limpia los espacios que se escriben de más', () => {
    expect(
      displayNameOf({ firstName: '  Lucas ', lastName: ' Serrate ' }),
    ).toBe('Lucas Serrate');
  });

  it('el apellido en blanco no cuenta como apellido', () => {
    expect(displayNameOf({ firstName: 'Lucas', lastName: '   ' })).toBe(
      'Lucas',
    );
  });
});

describe('splitFullName', () => {
  it('el primer token es el nombre y el resto el apellido', () => {
    expect(splitFullName('Lucas Serrate')).toEqual({
      firstName: 'Lucas',
      lastName: 'Serrate',
    });
  });

  it('los apellidos compuestos quedan enteros', () => {
    expect(splitFullName('Juan Carlos Pérez')).toEqual({
      firstName: 'Juan',
      lastName: 'Carlos Pérez',
    });
  });

  it('un solo nombre no inventa apellido', () => {
    expect(splitFullName('Marco')).toEqual({
      firstName: 'Marco',
      lastName: null,
    });
  });

  it('tolera los espacios de más de lo ya cargado', () => {
    expect(splitFullName('  Ana   López  ')).toEqual({
      firstName: 'Ana',
      lastName: 'López',
    });
  });
});
