import { DEFAULT_DIAL_CODE, dialCodeForTimeZone } from './dial-code';

describe('dialCodeForTimeZone', () => {
  it('resuelve las zonas de la región', () => {
    expect(dialCodeForTimeZone('America/La_Paz')).toBe('591');
    expect(dialCodeForTimeZone('America/Lima')).toBe('51');
    expect(dialCodeForTimeZone('America/Sao_Paulo')).toBe('55');
  });

  it('cubre toda la familia de zonas de Argentina', () => {
    // Hay una zona por provincia y todas comparten prefijo: listarlas una por
    // una dejaría afuera a la próxima que aparezca.
    expect(dialCodeForTimeZone('America/Argentina/Buenos_Aires')).toBe('54');
    expect(dialCodeForTimeZone('America/Argentina/Ushuaia')).toBe('54');
  });

  it('cae al valor por defecto en vez de dejar al cliente sin prefijo', () => {
    expect(dialCodeForTimeZone('Europe/Madrid')).toBe(DEFAULT_DIAL_CODE);
    expect(dialCodeForTimeZone(null)).toBe(DEFAULT_DIAL_CODE);
    expect(dialCodeForTimeZone(undefined)).toBe(DEFAULT_DIAL_CODE);
  });
});
