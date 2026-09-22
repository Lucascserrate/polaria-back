import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { isDuplicateEntryError } from '../../database/duplicate-entry.util';
import { Client, ClientSource } from '../entities/client.entity';
import { ClientsService } from '../clients.service';
import { resolveClientPhone } from '../client-phone.util';
import {
  detectColumns,
  extractContacts,
  type ColumnMapping,
  type ContactRow,
} from './contact-columns.util';
import { decodeCsv, parseCsv } from './csv.util';

/**
 * Tope de contactos por archivo.
 *
 * Una agenda de teléfono personal no llega ni cerca; lo que llega a esto es un
 * export de otra cosa. El tope no está para ahorrar filas sino para que el
 * negocio reciba un mensaje claro en lugar de una pantalla colgada: el análisis
 * entero —parseo, normalización y consulta de existentes— ocurre dentro de una
 * sola petición HTTP.
 */
export const MAX_IMPORT_ROWS = 5000;

/**
 * Lo único que una ficha importada trae.
 *
 * Se declaran las columnas en lugar de un `Partial<Client>`: así lo que se
 * inserta no puede tocar relaciones ni fechas aunque el mapeo crezca, que es la
 * misma precaución que toma `updateByTenant`.
 */
type ImportedClient = Pick<
  Client,
  'tenantId' | 'phone' | 'name' | 'email' | 'createdVia'
>;

/** Cuántas fichas entran en cada `INSERT`. Ver `insertChunk`. */
const INSERT_CHUNK = 200;

/** Cuántos teléfonos se preguntan por consulta al buscar los que ya existen. */
const LOOKUP_CHUNK = 500;

/** Qué va a pasar con esta fila si se confirma la importación. */
export type ImportRowStatus = 'new' | 'existing' | 'skipped';

/** Por qué una fila se omite. Es lo que la pantalla traduce a una frase. */
export type ImportSkipReason =
  /** El contacto no tiene ningún teléfono. */
  | 'no_phone'
  /** Tiene algo en la columna del teléfono, pero no es un número utilizable. */
  | 'invalid_phone'
  /** Ese mismo teléfono ya apareció en una fila anterior del archivo. */
  | 'repeated_in_file'
  /** El cliente existe pero está dado de baja. Ver `ClientsImportService`. */
  | 'deleted';

/** Qué campos vacíos del cliente existente completaría el archivo. */
export type ImportFillableField = 'name' | 'email';

export interface ImportRow {
  /** Fila del archivo sin contar el encabezado, para poder ir a buscarla. */
  row: number;
  name: string | null;
  /**
   * El teléfono ya normalizado al formato de Polaria.
   *
   * Con `reason: 'invalid_phone'` trae lo que decía el archivo, sin normalizar:
   * es lo único que le permite al negocio encontrar esa fila y arreglarla.
   */
  phone: string | null;
  email: string | null;
  status: ImportRowStatus;
  reason?: ImportSkipReason;
  /** El cliente que ya existía, cuando lo hay y está activo. */
  clientId: string | null;
  /**
   * Los campos que se completarían. Se calcula siempre, aunque la casilla de
   * completar esté apagada: es lo que le deja a la pantalla mostrar qué se gana
   * al encenderla, sin volver a pedir el análisis.
   */
  fills: ImportFillableField[];
}

export interface ImportAnalysis {
  /** Los encabezados del archivo, para poder corregir el mapeo a mano. */
  headers: string[];
  mapping: ColumnMapping;
  /** El prefijo con el que se completaron los números sin país. */
  dialCode: string;
  total: number;
  counts: { toCreate: number; existing: number; skipped: number };
  rows: ImportRow[];
}

export interface ImportResult extends ImportAnalysis {
  /** Fichas creadas de verdad. Puede ser menor que `toCreate`: ver `insertChunk`. */
  created: number;
  /** Clientes existentes a los que se les completó algún campo vacío. */
  completed: number;
}

export interface ImportOptions {
  /** Lo que el negocio corrigió del mapeo detectado. */
  mapping?: Partial<ColumnMapping>;
  /** Prefijo para los números sin país. Por defecto, el del negocio. */
  dialCode?: string;
  /** Completar los campos vacíos de los clientes que ya existen. */
  fillMissing?: boolean;
}

/**
 * Importar la agenda de contactos del negocio.
 *
 * El caso real que resuelve: alguien que atendió tres años por WhatsApp tiene a
 * sus clientes en Google Contacts y no los va a cargar de a uno. Sin esto, la
 * cartera de Polaria empieza vacía y se llena recién a medida que la gente
 * vuelve a reservar, que son meses.
 *
 * ## La regla que sostiene todo: negocio + teléfono normalizado = un cliente
 *
 * Es la misma de `resolveByPhone` y la misma que el índice único
 * `(tenantId, phone)`. Acá se aplica en lote y en dos pasos —analizar, y recién
 * después escribir— porque una importación es irreversible en la práctica: nadie
 * va a borrar mil fichas a mano. La vista previa existe para que la decisión se
 * tome antes y no después.
 *
 * ## Qué **no** hace, a propósito
 *
 * **No sobrescribe nada.** De un cliente que ya existe sólo se completan los
 * campos vacíos, y sólo si el negocio lo pidió. El archivo tiene la información
 * que alguien cargó en su teléfono hace años; la ficha tiene la que se fue
 * corrigiendo con cada cita. Ante el conflicto gana la ficha.
 *
 * **No reactiva a los dados de baja.** Dar de baja a un cliente fue una decisión
 * del negocio; que su número siga en la agenda del teléfono no la revoca. Se
 * informan como omitidos, que es distinto de esconderlos.
 *
 * **No adivina por nombre.** Dos "Ana" no son la misma persona ni son dos, y no
 * hay forma de saberlo. El teléfono es lo único que identifica.
 */
@Injectable()
export class ClientsImportService {
  private readonly logger = new Logger(ClientsImportService.name);

  constructor(
    @InjectRepository(Client)
    private readonly clientRepository: Repository<Client>,
    private readonly clientsService: ClientsService,
  ) {}

  /**
   * Lee el archivo y dice qué pasaría, sin tocar nada.
   *
   * Tolera un archivo cuyo teléfono no se pudo mapear: devuelve todas las filas
   * omitidas y el mapeo vacío, que es justamente lo que la pantalla necesita
   * mostrar para pedir que se elija la columna. Negarse con un error dejaría al
   * negocio sin la lista de encabezados con la que corregirlo.
   */
  async analyze(
    tenantId: string,
    file: Buffer,
    options: ImportOptions = {},
  ): Promise<ImportAnalysis> {
    const { headers, body } = this.read(file);
    const mapping = this.resolveMapping(headers, options.mapping);
    const contacts = extractContacts(headers, body, mapping);
    const dialCode =
      options.dialCode ?? (await this.clientsService.dialCodeFor(tenantId));

    const normalized = contacts.map((contact) => ({
      contact: { ...contact, email: this.normalizeEmail(contact.email) },
      phone: this.normalize(contact.phone, dialCode),
    }));

    const existing = await this.findExisting(
      tenantId,
      normalized
        .map(({ phone }) => phone)
        .filter((phone): phone is string => phone !== null),
    );

    const seen = new Set<string>();
    const rows = normalized.map(({ contact, phone }) =>
      this.classify(contact, phone, existing, seen),
    );

    return {
      headers,
      mapping,
      dialCode,
      total: rows.length,
      counts: {
        toCreate: rows.filter((row) => row.status === 'new').length,
        existing: rows.filter((row) => row.status === 'existing').length,
        skipped: rows.filter((row) => row.status === 'skipped').length,
      },
      rows,
    };
  }

  /**
   * Analiza otra vez y recién entonces escribe.
   *
   * El análisis se rehace en lugar de confiar en el que el navegador ya tiene:
   * lo que llega del cliente es un archivo y un mapeo, nunca una lista de "estos
   * son nuevos". Entre la vista previa y la confirmación pudo entrar una reserva
   * por WhatsApp que creó a una de esas personas, y esa fila tiene que dejar de
   * ser nueva sola.
   */
  async run(
    tenantId: string,
    file: Buffer,
    options: ImportOptions = {},
  ): Promise<ImportResult> {
    const analysis = await this.analyze(tenantId, file, options);

    if (analysis.mapping.phoneColumns.length === 0) {
      throw new BadRequestException(
        'Elegí cuál de las columnas del archivo tiene el teléfono.',
      );
    }

    const created = await this.createAll(tenantId, analysis.rows);
    const completed = options.fillMissing
      ? await this.completeAll(analysis.rows)
      : 0;

    this.logger.log(
      `Importación de clientes (tenantId=${tenantId}, filas=${analysis.total}, creados=${created}, completados=${completed}, omitidos=${analysis.counts.skipped}).`,
    );

    return { ...analysis, created, completed };
  }

  /** El encabezado y las filas del archivo, o el error que explica por qué no. */
  private read(file: Buffer): { headers: string[]; body: string[][] } {
    const rows = parseCsv(decodeCsv(file));

    if (rows.length === 0) {
      throw new BadRequestException('El archivo está vacío.');
    }

    const [headers, ...body] = rows;

    if (body.length === 0) {
      throw new BadRequestException(
        'El archivo sólo tiene el encabezado: no hay contactos para importar.',
      );
    }

    if (body.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(
        `El archivo tiene ${body.length} contactos y el máximo es ${MAX_IMPORT_ROWS}. Dividilo en varios archivos.`,
      );
    }

    return { headers, body };
  }

  /**
   * El mapeo detectado, con lo que el negocio haya corregido encima.
   *
   * Una columna elegida que no está en el archivo es un error del que conviene
   * enterarse: significa que se subió otro archivo del que se mapeó, y seguir
   * adelante importaría todo vacío.
   */
  private resolveMapping(
    headers: string[],
    overrides?: Partial<ColumnMapping>,
  ): ColumnMapping {
    const detected = detectColumns(headers);
    const merged: ColumnMapping = {
      nameColumns: overrides?.nameColumns ?? detected.nameColumns,
      phoneColumns: overrides?.phoneColumns ?? detected.phoneColumns,
      emailColumns: overrides?.emailColumns ?? detected.emailColumns,
    };

    const unknown = [
      ...merged.nameColumns,
      ...merged.phoneColumns,
      ...merged.emailColumns,
    ].find((column) => !headers.includes(column));

    if (unknown) {
      throw new BadRequestException(
        `El archivo no tiene ninguna columna llamada "${unknown}".`,
      );
    }

    return merged;
  }

  /**
   * El email del archivo, o nada.
   *
   * El alta manual exige un email válido —`@IsEmail` en el DTO— y la
   * importación no puede ser la puerta por la que entra basura a la misma
   * columna. Una celda que no es un email no frena la fila: el contacto se
   * importa igual, sin email, porque lo que hace falta de verdad es el teléfono.
   * La vista previa muestra la celda vacía, así que no desaparece en silencio.
   */
  private normalizeEmail(raw: string | null): string | null {
    if (!raw) return null;

    const email = raw.trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
  }

  /**
   * El teléfono del archivo, en el formato con el que Polaria reconoce a una
   * persona en todos sus canales.
   *
   * Pasa por `resolveClientPhone` con `kind: 'typed'`, que es exactamente el
   * camino del alta manual: lo que hay en un CSV lo escribió una persona en la
   * agenda de su teléfono, con o sin prefijo, con guiones o con paréntesis.
   */
  private normalize(raw: string | null, dialCode: string): string | null {
    if (!raw) return null;
    return resolveClientPhone({ kind: 'typed', value: raw, dialCode });
  }

  /**
   * Los clientes del negocio que ya tienen alguno de esos teléfonos.
   *
   * Incluye a los dados de baja —`withDeleted`— porque su fila sigue ocupando su
   * lugar en el índice único: ignorarlos no crearía un cliente nuevo, haría
   * fallar el `INSERT` del lote entero.
   *
   * Se pregunta de a tandas y no por todos los clientes del negocio: una cartera
   * de veinte mil no tiene por qué viajar entera para cotejar mil teléfonos.
   */
  private async findExisting(
    tenantId: string,
    phones: string[],
  ): Promise<Map<string, Client>> {
    const unique = [...new Set(phones)];
    const found = new Map<string, Client>();

    for (let i = 0; i < unique.length; i += LOOKUP_CHUNK) {
      const chunk = unique.slice(i, i + LOOKUP_CHUNK);
      const clients = await this.clientRepository.find({
        where: { tenantId, phone: In(chunk) },
        withDeleted: true,
      });

      clients.forEach((client) => {
        if (client.phone) found.set(client.phone, client);
      });
    }

    return found;
  }

  /** Qué va a pasar con esta fila, y por qué. */
  private classify(
    contact: ContactRow,
    phone: string | null,
    existing: Map<string, Client>,
    seen: Set<string>,
  ): ImportRow {
    const base = {
      row: contact.row,
      name: contact.name,
      email: contact.email,
      clientId: null,
      fills: [],
    };

    if (!contact.phone) {
      return { ...base, phone: null, status: 'skipped', reason: 'no_phone' };
    }

    if (!phone) {
      // Se devuelve el original: es con lo que se encuentra la fila en el CSV.
      return {
        ...base,
        phone: contact.phone,
        status: 'skipped',
        reason: 'invalid_phone',
      };
    }

    if (seen.has(phone)) {
      return {
        ...base,
        phone,
        status: 'skipped',
        reason: 'repeated_in_file',
      };
    }
    seen.add(phone);

    const client = existing.get(phone);

    if (!client) {
      return { ...base, phone, status: 'new' };
    }

    if (client.deletedAt) {
      return { ...base, phone, status: 'skipped', reason: 'deleted' };
    }

    return {
      ...base,
      phone,
      status: 'existing',
      clientId: client.id,
      fills: this.fillableFields(client, contact),
    };
  }

  /**
   * Qué campos del cliente están vacíos y el archivo puede llenar.
   *
   * Sólo se mira el vacío. Un nombre distinto no es un dato mejor: la ficha se
   * fue corrigiendo con cada cita y el contacto del teléfono quedó como se
   * guardó el primer día, muchas veces como "Ana Uña" o "Juan Barbería".
   */
  private fillableFields(
    client: Client,
    contact: ContactRow,
  ): ImportFillableField[] {
    const fills: ImportFillableField[] = [];

    if (contact.name && !client.name?.trim()) fills.push('name');
    if (contact.email && !client.email?.trim()) fills.push('email');

    return fills;
  }

  /** Crea las fichas nuevas, de a lotes. Devuelve cuántas entraron. */
  private async createAll(
    tenantId: string,
    rows: ImportRow[],
  ): Promise<number> {
    const pending: ImportedClient[] = rows
      .filter((row) => row.status === 'new' && row.phone)
      .map((row) => ({
        tenantId,
        phone: row.phone,
        name: row.name ?? undefined,
        email: row.email ?? null,
        createdVia: ClientSource.IMPORT,
      }));

    let created = 0;
    for (let i = 0; i < pending.length; i += INSERT_CHUNK) {
      created += await this.insertChunk(pending.slice(i, i + INSERT_CHUNK));
    }

    return created;
  }

  /**
   * Un lote de fichas nuevas.
   *
   * Si el lote choca contra el índice único, se reintenta fila por fila en lugar
   * de perderlo entero: entre el análisis y la escritura pudo entrar un mensaje
   * de WhatsApp que creó a esa persona, y que un contacto se adelante no es
   * motivo para que los otros ciento noventa y nueve no se importen.
   */
  private async insertChunk(rows: ImportedClient[]): Promise<number> {
    if (rows.length === 0) return 0;

    try {
      await this.clientRepository.insert(rows);
      return rows.length;
    } catch (error: unknown) {
      if (!isDuplicateEntryError(error)) throw error;

      let created = 0;
      for (const row of rows) {
        try {
          await this.clientRepository.insert(row);
          created++;
        } catch (cause: unknown) {
          if (!isDuplicateEntryError(cause)) throw cause;
        }
      }

      return created;
    }
  }

  /** Completa los campos vacíos de los que ya existían. */
  private async completeAll(rows: ImportRow[]): Promise<number> {
    const pending = rows.filter(
      (row) =>
        row.status === 'existing' && row.clientId && row.fills.length > 0,
    );

    let completed = 0;
    for (const row of pending) {
      if (!row.clientId) continue;

      const changes: Pick<Partial<Client>, 'name' | 'email'> = {};
      if (row.fills.includes('name') && row.name) changes.name = row.name;
      if (row.fills.includes('email') && row.email) changes.email = row.email;

      await this.clientRepository.update(row.clientId, changes);
      completed++;
    }

    return completed;
  }
}
