import { readStoredCredential } from './stored-credential.util';

describe('readStoredCredential', () => {
  it('devuelve la credencial cuando es un valor real', () => {
    expect(readStoredCredential('EAALyP7abc')).toBe('EAALyP7abc');
  });

  it('recorta espacios alrededor de la credencial', () => {
    expect(readStoredCredential('  EAALyP7abc \n')).toBe('EAALyP7abc');
  });

  it.each([undefined, null, '', '   '])(
    'trata %p como credencial ausente',
    (value) => {
      expect(readStoredCredential(value)).toBeUndefined();
    },
  );

  // El caso que provocaba `Authorization: Bearer null` y un 401 code=190 de Meta:
  // un valor ausente persistido como cadena en lugar de NULL.
  it.each(['null', 'undefined'])(
    'trata la cadena %p como credencial ausente',
    (value) => {
      expect(readStoredCredential(value)).toBeUndefined();
    },
  );
});
