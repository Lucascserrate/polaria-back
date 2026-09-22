import {
  detectColumns,
  extractContacts,
  type ColumnMapping,
} from './contact-columns.util';
import { parseCsv } from './csv.util';

/** El encabezado que exporta Google Contacts hoy, recortado a lo que importa. */
const GOOGLE_NUEVO =
  'First Name,Middle Name,Last Name,Phonetic First Name,Name Prefix,Nickname,File As,Organization Name,Birthday,Notes,Labels,E-mail 1 - Label,E-mail 1 - Value,E-mail 2 - Label,E-mail 2 - Value,Phone 1 - Label,Phone 1 - Value,Phone 2 - Label,Phone 2 - Value';

/** El de antes de 2022. Sigue circulando: los negocios guardan archivos viejos. */
const GOOGLE_VIEJO =
  'Name,Given Name,Additional Name,Family Name,Yomi Name,E-mail 1 - Type,E-mail 1 - Value,Phone 1 - Type,Phone 1 - Value';

const headersOf = (line: string) => parseCsv(line)[0];

describe('detectColumns', () => {
  it('reconoce el export actual de Google Contacts', () => {
    expect(detectColumns(headersOf(GOOGLE_NUEVO))).toEqual<ColumnMapping>({
      nameColumns: ['First Name', 'Middle Name', 'Last Name'],
      phoneColumns: ['Phone 1 - Value', 'Phone 2 - Value'],
      emailColumns: ['E-mail 1 - Value', 'E-mail 2 - Value'],
    });
  });

  it('reconoce el export viejo, que llama distinto a las mismas columnas', () => {
    expect(detectColumns(headersOf(GOOGLE_VIEJO))).toEqual<ColumnMapping>({
      nameColumns: ['Given Name', 'Additional Name', 'Family Name'],
      phoneColumns: ['Phone 1 - Value'],
      emailColumns: ['E-mail 1 - Value'],
    });
  });

  it('no confunde la etiqueta del teléfono con el teléfono', () => {
    // `Phone 1 - Label` dice "Mobile", no un número.
    const { phoneColumns } = detectColumns(headersOf(GOOGLE_NUEVO));
    expect(phoneColumns).not.toContain('Phone 1 - Label');
  });

  it('no toma "Phonetic First Name" como el nombre', () => {
    const { nameColumns } = detectColumns(headersOf(GOOGLE_NUEVO));
    expect(nameColumns).not.toContain('Phonetic First Name');
  });

  it('ordena los teléfonos por su número, no por cómo vienen', () => {
    const headers = headersOf(
      'Phone 3 - Value,Phone 1 - Value,Phone 2 - Value',
    );
    expect(detectColumns(headers).phoneColumns).toEqual([
      'Phone 1 - Value',
      'Phone 2 - Value',
      'Phone 3 - Value',
    ]);
  });

  it('entiende un CSV hecho a mano, con acentos y una sola columna', () => {
    const headers = headersOf('Nombre,Teléfono,Correo');
    expect(detectColumns(headers)).toEqual<ColumnMapping>({
      nameColumns: ['Nombre'],
      phoneColumns: ['Teléfono'],
      emailColumns: ['Correo'],
    });
  });

  it('no arriesga nada cuando no reconoce ninguna columna', () => {
    expect(detectColumns(headersOf('col1,col2'))).toEqual<ColumnMapping>({
      nameColumns: [],
      phoneColumns: [],
      emailColumns: [],
    });
  });
});

describe('extractContacts', () => {
  const build = (csv: string) => {
    const [headers, ...rows] = parseCsv(csv);
    return extractContacts(headers, rows, detectColumns(headers));
  };

  it('junta las tres partes del nombre en el orden en que se lee', () => {
    const contactos = build(
      'First Name,Middle Name,Last Name,Phone 1 - Value\nJuan,Carlos,Pérez,71234567',
    );

    expect(contactos[0].name).toBe('Juan Carlos Pérez');
  });

  it('no deja espacios de más cuando falta el segundo nombre', () => {
    const contactos = build(
      'First Name,Middle Name,Last Name,Phone 1 - Value\nAna,,Gómez,71234567',
    );

    expect(contactos[0].name).toBe('Ana Gómez');
  });

  it('cae al segundo teléfono cuando el primero viene vacío', () => {
    const contactos = build(
      'First Name,Phone 1 - Value,Phone 2 - Value\nAna,,71234567',
    );

    expect(contactos[0].phone).toBe('71234567');
  });

  it('se queda con el primero de los valores múltiples de Google', () => {
    const contactos = build(
      'First Name,Phone 1 - Value\nAna,+591 71234567 ::: +591 76543210',
    );

    expect(contactos[0].phone).toBe('+591 71234567');
  });

  it('deja en null lo que el contacto no tiene', () => {
    const contactos = build(
      'First Name,Last Name,Phone 1 - Value,E-mail 1 - Value\n,,71234567,',
    );

    expect(contactos[0]).toEqual({
      row: 1,
      name: null,
      phone: '71234567',
      email: null,
    });
  });

  it('numera las filas como las ve quien abre el archivo', () => {
    const contactos = build(
      'First Name,Phone 1 - Value\nAna,71234567\nBeto,76543210',
    );

    expect(contactos.map((contacto) => contacto.row)).toEqual([1, 2]);
  });
});
