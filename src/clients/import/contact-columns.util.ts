/**
 * Qué columna del CSV es cada dato.
 *
 * El archivo lo escribe Google Contacts, no Polaria, así que los encabezados no
 * se parecen a nuestras columnas: `First Name`, `Phone 1 - Value`, `E-mail 1 -
 * Value`. Pedirle al negocio que renombre columnas en una planilla antes de
 * subir el archivo sería pedirle que haga el trabajo que esta pantalla existe
 * para hacer.
 *
 * Google cambió el formato de su export en 2022 y los dos siguen circulando: el
 * viejo dice `Given Name` y `Family Name`, el nuevo dice `First Name` y `Last
 * Name`. Un negocio puede tener guardado un archivo de hace tres años, así que
 * se reconocen los dos.
 *
 * La detección propone; el negocio dispone. Todo lo de acá se puede corregir a
 * mano en la pantalla, porque adivinar bien el 95% de las veces y no dejar
 * arreglar el 5% restante es peor que no adivinar.
 */

/** Qué columnas alimentan cada campo, en orden. Ver `extractContacts`. */
export interface ColumnMapping {
  /** Se concatenan en este orden para formar el único `name` que tenemos. */
  nameColumns: string[];
  /** Se usa la primera que traiga algo: un contacto puede tener tres números. */
  phoneColumns: string[];
  emailColumns: string[];
}

/**
 * El encabezado reducido a lo comparable.
 *
 * `E-mail 1 - Value`, `Email 1 - Value` y `e-mail 1-value` son la misma columna
 * escrita por tres exports distintos. Sacando mayúsculas, espacios y signos
 * quedan las tres en `email1value`, y la tabla de sinónimos deja de tener que
 * enumerar variantes de puntuación.
 */
const key = (header: string): string =>
  header
    .toLowerCase()
    .normalize('NFD')
    // Los acentos se van, para que `Teléfono` y `Telefono` sean lo mismo.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

/**
 * Las tres partes del nombre, cada una con sus nombres posibles.
 *
 * El orden del arreglo **es** el orden en que se concatenan: nombre, segundo
 * nombre, apellido. Es el orden en que se lee un nombre en español, y es el que
 * hace que "Juan Carlos Pérez" no salga "Pérez Juan Carlos".
 */
const NAME_PARTS: string[][] = [
  ['firstname', 'givenname', 'nombre'],
  ['middlename', 'additionalname', 'segundonombre'],
  ['lastname', 'familyname', 'surname', 'apellido', 'apellidos'],
];

/** Cuando el archivo trae el nombre entero en una sola columna. */
const WHOLE_NAME = ['name', 'fullname', 'displayname', 'nombrecompleto'];

/**
 * Columnas de un solo valor, para archivos que no son de Google.
 *
 * No es soporte para otros CRMs —eso es otro trabajo— sino el piso que evita
 * que un CSV armado a mano con una columna `telefono` llegue sin detectar
 * nada.
 */
const SINGLE_PHONE = [
  'phone',
  'phonenumber',
  'mobile',
  'mobilephone',
  'telefono',
  'celular',
  'numero',
  'whatsapp',
];

const SINGLE_EMAIL = ['email', 'emailaddress', 'correo', 'correoelectronico'];

/**
 * `Phone 1 - Value`, `Phone 2 - Value`… en orden numérico.
 *
 * El `value` del final no es decorativo: Google escribe también `Phone 1 -
 * Label`, que dice "Mobile" o "Casa". Sin exigir el sufijo, la etiqueta se
 * importaría como si fuera un número.
 */
const numbered = (prefix: string, headers: string[]): string[] =>
  headers
    .map((header) => ({
      header,
      match: new RegExp(`^${prefix}(\\d+)value$`).exec(key(header)),
    }))
    .filter(
      (entry): entry is { header: string; match: RegExpExecArray } =>
        entry.match !== null,
    )
    .sort((a, b) => Number(a.match[1]) - Number(b.match[1]))
    .map((entry) => entry.header);

/** Las columnas del archivo que coinciden con alguno de esos nombres. */
const matching = (headers: string[], names: string[]): string[] =>
  headers.filter((header) => names.includes(key(header)));

/**
 * Qué columnas parecen ser el nombre, el teléfono y el email.
 *
 * Devuelve listas vacías cuando no reconoce nada, en lugar de arriesgar una
 * columna cualquiera: una lista vacía se ve en la pantalla como "elegí la
 * columna", y una adivinanza arriesgada se ve como mil contactos importados con
 * el número de la organización.
 */
export function detectColumns(headers: string[]): ColumnMapping {
  const nameParts = NAME_PARTS.map(
    (names) => matching(headers, names)[0],
  ).filter((header): header is string => header !== undefined);

  return {
    nameColumns:
      nameParts.length > 0
        ? nameParts
        : matching(headers, WHOLE_NAME).slice(0, 1),
    phoneColumns: [
      ...numbered('phone', headers),
      ...matching(headers, SINGLE_PHONE),
    ],
    emailColumns: [
      ...numbered('email', headers),
      ...matching(headers, SINGLE_EMAIL),
    ],
  };
}

/** Un contacto del archivo, ya armado pero todavía sin normalizar. */
export interface ContactRow {
  /** Número de fila en el archivo, sin contar el encabezado. Empieza en 1. */
  row: number;
  name: string | null;
  /** Tal como lo escribieron. Normalizarlo es trabajo de `ClientsImportService`. */
  phone: string | null;
  email: string | null;
}

/**
 * Google separa los valores múltiples de una misma celda con ` ::: `.
 *
 * Pasa cuando un contacto tiene dos teléfonos con la misma etiqueta. Se toma el
 * primero: es el que la persona puso primero, y guardar la cadena entera daría
 * un teléfono de veinte dígitos que no existe.
 */
const firstValue = (cell: string): string => cell.split(':::')[0].trim();

const cleanText = (value: string): string | null => {
  const trimmed = firstValue(value);
  return trimmed === '' ? null : trimmed;
};

/** Dónde cae cada columna elegida dentro de la fila. */
const indexesOf = (headers: string[], columns: string[]): number[] =>
  columns
    .map((column) => headers.indexOf(column))
    .filter((index) => index >= 0);

/**
 * Los contactos del archivo, según el mapeo elegido.
 *
 * El nombre se concatena y se limpia de espacios sobrantes: un contacto sin
 * segundo nombre deja esa celda vacía, y pegar las tres a lo bruto dejaría
 * "Juan  Pérez" con dos espacios en la ficha para siempre.
 */
export function extractContacts(
  headers: string[],
  rows: string[][],
  mapping: ColumnMapping,
): ContactRow[] {
  const nameIndexes = indexesOf(headers, mapping.nameColumns);
  const phoneIndexes = indexesOf(headers, mapping.phoneColumns);
  const emailIndexes = indexesOf(headers, mapping.emailColumns);

  /** La primera de las columnas mapeadas que traiga algo en esta fila. */
  const firstFilled = (cells: string[], indexes: number[]): string | null => {
    for (const index of indexes) {
      const value = cleanText(cells[index] ?? '');
      if (value) return value;
    }
    return null;
  };

  return rows.map((cells, position) => {
    const name = nameIndexes
      .map((index) => firstValue(cells[index] ?? ''))
      .filter((part) => part !== '')
      .join(' ')
      .trim();

    return {
      row: position + 1,
      name: name === '' ? null : name,
      phone: firstFilled(cells, phoneIndexes),
      email: firstFilled(cells, emailIndexes),
    };
  });
}
