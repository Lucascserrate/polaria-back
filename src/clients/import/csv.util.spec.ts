import { decodeCsv, parseCsv } from './csv.util';

describe('parseCsv', () => {
  it('separa celdas y filas', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('respeta las comas que van dentro de una celda entrecomillada', () => {
    expect(parseCsv('name,org\n"Pérez, Juan","Barbería, SRL"')).toEqual([
      ['name', 'org'],
      ['Pérez, Juan', 'Barbería, SRL'],
    ]);
  });

  it('lee dos comillas seguidas como una comilla literal', () => {
    expect(parseCsv('a\n"Le dicen ""Chino"""')).toEqual([
      ['a'],
      ['Le dicen "Chino"'],
    ]);
  });

  it('admite saltos de línea dentro de una celda', () => {
    const csv = 'name,notes\nAna,"Vino el martes.\nPrefiere la tarde."';
    expect(parseCsv(csv)).toEqual([
      ['name', 'notes'],
      ['Ana', 'Vino el martes.\nPrefiere la tarde.'],
    ]);
  });

  it('termina la fila con CRLF, LF o CR suelto', () => {
    const esperado = [
      ['a', 'b'],
      ['1', '2'],
    ];
    expect(parseCsv('a,b\r\n1,2')).toEqual(esperado);
    expect(parseCsv('a,b\n1,2')).toEqual(esperado);
    expect(parseCsv('a,b\r1,2')).toEqual(esperado);
  });

  it('descarta el salto final y las filas vacías', () => {
    expect(parseCsv('a,b\n1,2\n\n,,\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('conserva las celdas vacías del medio', () => {
    expect(parseCsv('a,b,c\n1,,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });

  it('no se queda con la fila entera cuando faltan comillas de cierre', () => {
    // Un archivo roto no puede tirar el import: se lee lo que se puede.
    expect(parseCsv('a,b\n"sin cerrar,2')).toEqual([
      ['a', 'b'],
      ['sin cerrar,2'],
    ]);
  });
});

describe('decodeCsv', () => {
  const contenido = 'First Name,Phone 1 - Value\nAna,+591 71234567';

  it('lee UTF-8 sin BOM', () => {
    expect(decodeCsv(Buffer.from(contenido, 'utf8'))).toBe(contenido);
  });

  it('saca el BOM de UTF-8 para que el primer encabezado no quede sucio', () => {
    const conBom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(contenido, 'utf8'),
    ]);

    expect(decodeCsv(conBom)).toBe(contenido);
    expect(parseCsv(decodeCsv(conBom))[0][0]).toBe('First Name');
  });

  it('lee UTF-16LE, que es como vuelve un CSV guardado desde Excel', () => {
    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(contenido, 'utf16le'),
    ]);

    expect(decodeCsv(utf16)).toBe(contenido);
  });

  it('lee UTF-16BE invirtiendo los pares de bytes', () => {
    const body = Buffer.from(contenido, 'utf16le');
    const utf16be = Buffer.concat([
      Buffer.from([0xfe, 0xff]),
      Buffer.from(body).swap16(),
    ]);

    expect(decodeCsv(utf16be)).toBe(contenido);
  });

  it('conserva los acentos', () => {
    expect(decodeCsv(Buffer.from('María Gómez', 'utf8'))).toBe('María Gómez');
  });
});
