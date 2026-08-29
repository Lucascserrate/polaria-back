import { buildUniqueSlug, MAX_SLUG_LENGTH, slugify } from './slug.util';

describe('slugify', () => {
  it('baja a minúsculas y une con guiones', () => {
    expect(slugify('Royal Barber')).toBe('royal-barber');
  });

  it('quita acentos en lugar de descartar la letra', () => {
    // "Peluquería" sin esto quedaría "peluquer-a", que no se puede escribir.
    expect(slugify('Peluquería Ñandú')).toBe('peluqueria-nandu');
  });

  it('colapsa la puntuación y no deja guiones sueltos en los extremos', () => {
    expect(slugify('  ¡La Mafia — Los Cusis!  ')).toBe('la-mafia-los-cusis');
    expect(slugify('Corte & Barba')).toBe('corte-barba');
  });

  it('devuelve vacío cuando no queda nada utilizable', () => {
    // No inventa un slug: quien llama decide con qué reemplazarlo.
    expect(slugify('★★★')).toBe('');
    expect(slugify('   ')).toBe('');
  });

  it('recorta al largo de la columna sin terminar en guion', () => {
    const long = slugify('a'.repeat(MAX_SLUG_LENGTH + 20));
    expect(long).toHaveLength(MAX_SLUG_LENGTH);

    const cut = slugify(`${'a'.repeat(MAX_SLUG_LENGTH - 1)} barber`);
    expect(cut.endsWith('-')).toBe(false);
  });
});

describe('buildUniqueSlug', () => {
  it('usa el nombre tal cual cuando está libre', () => {
    expect(buildUniqueSlug('Royal Barber', [])).toBe('royal-barber');
  });

  it('desempata con un sufijo numérico, no con el id', () => {
    // La segunda sucursal de una cadena es el caso normal. Un uuid en la URL la
    // volvería incompartible, que es lo contrario de para qué existe el slug.
    expect(buildUniqueSlug('Royal Barber', ['royal-barber'])).toBe(
      'royal-barber-2',
    );
    expect(
      buildUniqueSlug('Royal Barber', ['royal-barber', 'royal-barber-2']),
    ).toBe('royal-barber-3');
  });

  it('no entrega un slug que ya es una ruta del sitio', () => {
    // `polariahq.com/privacy` es la política de privacidad: un negocio ahí
    // quedaría inalcanzable sin ningún error visible.
    expect(buildUniqueSlug('Privacy', [])).toBe('privacy-2');
  });

  it('cae al nombre genérico cuando el negocio no tiene forma ASCII', () => {
    expect(buildUniqueSlug('★★★', [])).toBe('negocio');
    expect(buildUniqueSlug('★★★', ['negocio'])).toBe('negocio-2');
  });

  it('deja lugar al sufijo al recortar un nombre largo', () => {
    const name = 'b'.repeat(MAX_SLUG_LENGTH + 10);
    const taken = [slugify(name)];

    const slug = buildUniqueSlug(name, taken);

    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(slug.endsWith('-2')).toBe(true);
  });
});
