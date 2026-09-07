import { normalizeOptionalText } from './optional-text';

describe('normalizeOptionalText', () => {
  it('deja pasar la ausencia del campo como "no se tocó"', () => {
    expect(normalizeOptionalText(undefined)).toBeUndefined();
  });

  it('convierte la cadena vacía en NULL: es la forma de vaciar el campo', () => {
    expect(normalizeOptionalText('')).toBeNull();
  });

  it('trata el campo con solo espacios como vacío', () => {
    expect(normalizeOptionalText('   ')).toBeNull();
  });

  it('recorta los espacios de los extremos', () => {
    expect(normalizeOptionalText('  Paredes  ')).toBe('Paredes');
  });

  it('no toca el texto de adentro', () => {
    expect(normalizeOptionalText('de la Fuente')).toBe('de la Fuente');
  });
});
