/**
 * Un CSV convertido en filas y celdas.
 *
 * Es un parser propio y no una dependencia porque lo que hay que leer está
 * acotado: el archivo que exporta Google Contacts, que es RFC 4180 de manual.
 * Traer una librería para esto sumaría superficie de actualización a cambio de
 * las cien líneas de acá, y el mismo criterio ya rige en `client-phone.util` y
 * en `dial-code`.
 *
 * Lo que sí hay que respetar es el formato de verdad y no la versión ingenua de
 * "cortar por comas": los contactos reales traen comas dentro del nombre de la
 * organización, comillas escapadas y notas con saltos de línea adentro de una
 * celda. Un `split(',')` parte esas filas al medio y corre todas las columnas
 * siguientes, que es la clase de error que se descubre recién cuando el teléfono
 * importado no existe.
 */

const BOM_UTF8 = [0xef, 0xbb, 0xbf];
const BOM_UTF16_LE = [0xff, 0xfe];
const BOM_UTF16_BE = [0xfe, 0xff];

const startsWith = (buffer: Buffer, bytes: number[]): boolean =>
  buffer.length >= bytes.length && bytes.every((byte, i) => buffer[i] === byte);

/**
 * El texto del archivo, sea cual sea la codificación con la que lo guardaron.
 *
 * Google exporta UTF-8, pero el archivo pasa por manos antes de llegar acá: se
 * abre en Excel, se guarda, y en Windows eso puede volver como UTF-16. Los tres
 * casos se distinguen por el BOM, que son los primeros bytes que el archivo trae
 * justamente para anunciar su codificación.
 *
 * Sin esto, un UTF-16 leído como UTF-8 no falla: entrega una cadena llena de
 * bytes nulos donde cada encabezado parece texto y ninguno coincide con nada. El
 * negocio vería "no encontramos ninguna columna" sobre un archivo perfectamente
 * válido.
 */
export function decodeCsv(buffer: Buffer): string {
  if (startsWith(buffer, BOM_UTF16_LE)) {
    return buffer.subarray(2).toString('utf16le');
  }

  if (startsWith(buffer, BOM_UTF16_BE)) {
    /*
     * Node no sabe leer UTF-16 big endian. Se invierte cada par de bytes y pasa
     * a ser el little endian que sí sabe leer; `swap16` exige largo par, así que
     * un archivo truncado a la mitad de un carácter se descarta antes.
     */
    const body = buffer.subarray(2);
    const even = body.subarray(0, body.length - (body.length % 2));
    return Buffer.from(even).swap16().toString('utf16le');
  }

  if (startsWith(buffer, BOM_UTF8)) {
    return buffer.subarray(3).toString('utf8');
  }

  return buffer.toString('utf8');
}

/**
 * Las filas del CSV, cada una con sus celdas en crudo.
 *
 * Una máquina de estados de dos estados —dentro y fuera de comillas— porque es
 * la única forma de que un separador o un salto de línea dentro de una celda
 * entrecomillada se lean como texto y no como estructura.
 *
 * Reglas que implementa, todas de RFC 4180 y todas presentes en un export real:
 * la coma separa celdas; las comillas envuelven una celda y no se guardan; dos
 * comillas seguidas dentro de una celda entrecomillada son una comilla literal;
 * `\r\n`, `\n` y `\r` sueltos terminan la fila.
 *
 * La última fila vacía se descarta: casi todos los archivos terminan con un
 * salto de línea y esa fila fantasma se contaría como un contacto sin teléfono.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char !== '"') {
        cell += char;
        continue;
      }

      // Comilla escapada: `""` adentro de la celda es una comilla de verdad.
      if (text[i + 1] === '"') {
        cell += '"';
        i++;
        continue;
      }

      quoted = false;
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }

    if (char === ',') {
      row.push(cell);
      cell = '';
      continue;
    }

    if (char === '\n' || char === '\r') {
      // `\r\n` es un solo final de línea, no dos.
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  // Lo que quedó sin cerrar: la última fila si el archivo no termina en salto.
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((cells) => !isEmptyRow(cells));
}

/**
 * Una fila que no dice nada.
 *
 * No es sólo la del salto final: los exports que pasaron por una planilla traen
 * filas de separación con las comas puestas y todas las celdas vacías.
 */
const isEmptyRow = (cells: string[]): boolean =>
  cells.every((cell) => cell.trim() === '');
