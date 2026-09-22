import { BadRequestException } from '@nestjs/common';
import type { FindOperator, Repository } from 'typeorm';

import {
  ClientsImportService,
  MAX_IMPORT_ROWS,
} from './clients-import.service';
import type { ClientsService } from '../clients.service';
import { ClientSource, type Client } from '../entities/client.entity';

const TENANT = 'tenant-1';

/** El encabezado que exporta Google Contacts, recortado a lo que se importa. */
const HEADER =
  'First Name,Middle Name,Last Name,E-mail 1 - Value,Phone 1 - Label,Phone 1 - Value';

const csv = (...lines: string[]) => Buffer.from([HEADER, ...lines].join('\n'));

/**
 * Una base en memoria con la regla que importa: `(tenantId, phone)` es único.
 *
 * Se simula la restricción y no sólo las llamadas, igual que en el test del
 * resolver: un doble que acepte dos veces el mismo teléfono daría por buenos
 * exactamente los duplicados que este módulo existe para evitar.
 */
const setup = (existing: Partial<Client>[] = []) => {
  const rows: Partial<Client>[] = existing.map((row) => ({ ...row }));

  const clientRepository = {
    find: jest.fn(
      ({
        where,
      }: {
        where: { tenantId: string; phone: FindOperator<string> };
      }) => {
        const phones = where.phone.value as unknown as string[];

        return Promise.resolve(
          rows.filter(
            (row) =>
              row.tenantId === where.tenantId &&
              row.phone &&
              phones.includes(row.phone),
          ),
        );
      },
    ),

    insert: jest.fn((payload: Partial<Client> | Partial<Client>[]) => {
      const incoming = Array.isArray(payload) ? payload : [payload];

      incoming.forEach((row) => {
        const taken = rows.some(
          (existingRow) =>
            existingRow.tenantId === row.tenantId &&
            existingRow.phone === row.phone,
        );

        // El índice único no distingue entre vivos y dados de baja.
        if (taken) {
          throw Object.assign(new Error('ER_DUP_ENTRY'), {
            code: 'ER_DUP_ENTRY',
          });
        }

        rows.push({ id: `nuevo-${rows.length}`, ...row });
      });

      return Promise.resolve({ identifiers: [] });
    }),

    update: jest.fn((id: string, changes: Partial<Client>) => {
      const found = rows.find((row) => row.id === id);
      if (found) Object.assign(found, changes);
      return Promise.resolve({ affected: found ? 1 : 0 });
    }),
  };

  const clientsService = { dialCodeFor: jest.fn(() => Promise.resolve('591')) };

  const service = new ClientsImportService(
    clientRepository as unknown as Repository<Client>,
    clientsService as unknown as ClientsService,
  );

  return { service, rows, clientRepository };
};

describe('ClientsImportService.analyze', () => {
  it('detecta las columnas de Google y normaliza los teléfonos', async () => {
    const { service } = setup();

    const analysis = await service.analyze(
      TENANT,
      csv(
        'Juan,Carlos,Pérez,juan@gmail.com,Mobile,+591 71234567',
        'María,,Gómez,,Mobile,(591) 76543210',
        'Carlos,,Rojas,,Mobile,70123456',
      ),
    );

    expect(analysis.mapping.phoneColumns).toEqual(['Phone 1 - Value']);
    expect(analysis.rows.map((row) => row.phone)).toEqual([
      '59171234567',
      '59176543210',
      // Sin país: se completa con el del negocio.
      '59170123456',
    ]);
    expect(analysis.rows[0].name).toBe('Juan Carlos Pérez');
    expect(analysis.counts).toEqual({ toCreate: 3, existing: 0, skipped: 0 });
  });

  it('reconoce al cliente que ya existe en lugar de duplicarlo', async () => {
    const { service } = setup([
      { id: 'c1', tenantId: TENANT, phone: '59171234567', name: 'Juan' },
    ]);

    const analysis = await service.analyze(
      TENANT,
      csv('Juan,,Pérez,,Mobile,71234567'),
    );

    expect(analysis.rows[0]).toMatchObject({
      status: 'existing',
      clientId: 'c1',
    });
    expect(analysis.counts.existing).toBe(1);
  });

  it('no mira los clientes de otro negocio', async () => {
    const { service } = setup([
      { id: 'ajeno', tenantId: 'otro-negocio', phone: '59171234567' },
    ]);

    const analysis = await service.analyze(
      TENANT,
      csv('Juan,,Pérez,,Mobile,71234567'),
    );

    expect(analysis.rows[0].status).toBe('new');
  });

  it('omite al cliente dado de baja sin reactivarlo', async () => {
    const { service } = setup([
      {
        id: 'c1',
        tenantId: TENANT,
        phone: '59171234567',
        deletedAt: new Date(),
      },
    ]);

    const analysis = await service.analyze(
      TENANT,
      csv('Juan,,Pérez,,Mobile,71234567'),
    );

    expect(analysis.rows[0]).toMatchObject({
      status: 'skipped',
      reason: 'deleted',
      clientId: null,
    });
  });

  it('conserva la primera aparición de un teléfono repetido en el archivo', async () => {
    const { service } = setup();

    const analysis = await service.analyze(
      TENANT,
      csv(
        'Juan,,Pérez,,Mobile,71234567',
        // El mismo número escrito de otra forma: es la misma persona.
        'Juancito,,,,Mobile,+591 7123-4567',
      ),
    );

    expect(analysis.rows[0].status).toBe('new');
    expect(analysis.rows[1]).toMatchObject({
      status: 'skipped',
      reason: 'repeated_in_file',
    });
  });

  it('separa al contacto sin teléfono del que tiene uno ilegible', async () => {
    const { service } = setup();

    const analysis = await service.analyze(
      TENANT,
      csv('Pedro,,,,Mobile,', 'Ana,,,,Mobile,911'),
    );

    expect(analysis.rows[0]).toMatchObject({
      status: 'skipped',
      reason: 'no_phone',
      phone: null,
    });
    expect(analysis.rows[1]).toMatchObject({
      status: 'skipped',
      reason: 'invalid_phone',
      // Devuelve lo que decía el archivo: es con lo que se encuentra la fila.
      phone: '911',
    });
  });

  it('marca qué campos vacíos completaría, sin proponer pisar los que están', async () => {
    const { service } = setup([
      {
        id: 'c1',
        tenantId: TENANT,
        phone: '59171234567',
        name: 'Juan P.',
        email: null,
      },
      {
        id: 'c2',
        tenantId: TENANT,
        phone: '59176543210',
        name: 'María',
        email: 'maria@polaria.app',
      },
    ]);

    const analysis = await service.analyze(
      TENANT,
      csv(
        'Juan,,Pérez,juan@gmail.com,Mobile,71234567',
        'María,,Gómez,otro@gmail.com,Mobile,76543210',
      ),
    );

    // Le falta el email: se completa. El nombre ya lo tiene: no se toca.
    expect(analysis.rows[0].fills).toEqual(['email']);
    expect(analysis.rows[1].fills).toEqual([]);
  });

  it('descarta la celda que no es un email en vez de importarla', async () => {
    const { service } = setup();

    const analysis = await service.analyze(
      TENANT,
      csv('Ana,,Uña,no-es-un-email,Mobile,71234567'),
    );

    // La fila entra igual: lo que hace falta de verdad es el teléfono.
    expect(analysis.rows[0]).toMatchObject({ status: 'new', email: null });
  });

  it('usa el prefijo pedido en lugar del país del negocio', async () => {
    const { service } = setup();

    const analysis = await service.analyze(
      TENANT,
      csv('Ana,,,,Mobile,1123456789'),
      { dialCode: '54' },
    );

    expect(analysis.rows[0].phone).toBe('541123456789');
  });

  it('se niega ante un archivo sin contactos', async () => {
    const { service } = setup();

    await expect(service.analyze(TENANT, Buffer.from(HEADER))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('se niega ante un archivo más grande que el tope', async () => {
    const { service } = setup();
    const lines = Array.from(
      { length: MAX_IMPORT_ROWS + 1 },
      (_, i) => `Ana,,,,Mobile,7${String(i).padStart(7, '0')}`,
    );

    await expect(service.analyze(TENANT, csv(...lines))).rejects.toThrow(
      /máximo/,
    );
  });

  it('avisa cuando la columna elegida no está en el archivo', async () => {
    const { service } = setup();

    await expect(
      service.analyze(TENANT, csv('Ana,,,,Mobile,71234567'), {
        mapping: { phoneColumns: ['Celular'] },
      }),
    ).rejects.toThrow(/Celular/);
  });
});

describe('ClientsImportService.run', () => {
  it('crea sólo las fichas nuevas, con el origen de la importación', async () => {
    const { service, rows } = setup([
      { id: 'c1', tenantId: TENANT, phone: '59171234567', name: 'Juan' },
    ]);

    const result = await service.run(
      TENANT,
      csv(
        'Juan,,Pérez,,Mobile,71234567',
        'María,,Gómez,,Mobile,76543210',
        'Pedro,,,,Mobile,911',
      ),
    );

    expect(result.created).toBe(1);
    expect(result.counts).toEqual({ toCreate: 1, existing: 1, skipped: 1 });

    const creada = rows.find((row) => row.phone === '59176543210');
    expect(creada).toMatchObject({
      name: 'María Gómez',
      createdVia: ClientSource.IMPORT,
    });
  });

  it('completa los campos vacíos cuando se lo piden, y sólo esos', async () => {
    const { service, rows } = setup([
      {
        id: 'c1',
        tenantId: TENANT,
        phone: '59171234567',
        name: 'Juan P.',
        email: null,
      },
    ]);

    const result = await service.run(
      TENANT,
      csv('Juan,,Pérez,juan@gmail.com,Mobile,71234567'),
      { fillMissing: true },
    );

    expect(result.completed).toBe(1);
    expect(rows[0]).toMatchObject({
      // El nombre de la ficha gana sobre el del archivo.
      name: 'Juan P.',
      email: 'juan@gmail.com',
    });
  });

  it('no toca al cliente existente si no se lo piden', async () => {
    const { service, rows } = setup([
      { id: 'c1', tenantId: TENANT, phone: '59171234567', email: null },
    ]);

    const result = await service.run(
      TENANT,
      csv('Juan,,Pérez,juan@gmail.com,Mobile,71234567'),
      { fillMissing: false },
    );

    expect(result.completed).toBe(0);
    expect(rows[0].email).toBeNull();
  });

  it('no resucita al cliente dado de baja', async () => {
    const { service, rows } = setup([
      {
        id: 'c1',
        tenantId: TENANT,
        phone: '59171234567',
        deletedAt: new Date(),
      },
    ]);

    const result = await service.run(
      TENANT,
      csv('Juan,,Pérez,,Mobile,71234567'),
      { fillMissing: true },
    );

    expect(result.created).toBe(0);
    expect(result.completed).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].deletedAt).toBeInstanceOf(Date);
  });

  it('se niega a importar si no hay columna de teléfono', async () => {
    const { service } = setup();

    await expect(
      service.run(TENANT, csv('Ana,,,,Mobile,71234567'), {
        mapping: { phoneColumns: [] },
      }),
    ).rejects.toThrow(/teléfono/);
  });

  it('salva el lote cuando una fila choca contra el índice único', async () => {
    const { service, rows, clientRepository } = setup();

    /*
     * Alguien escribió por WhatsApp entre el análisis y la escritura: su ficha
     * ya existe cuando el lote intenta entrar. Las demás tienen que importarse
     * igual.
     */
    clientRepository.find.mockResolvedValueOnce([]);
    rows.push({ id: 'c1', tenantId: TENANT, phone: '59171234567' });

    const result = await service.run(
      TENANT,
      csv('Juan,,Pérez,,Mobile,71234567', 'María,,Gómez,,Mobile,76543210'),
    );

    expect(result.created).toBe(1);
    expect(rows.some((row) => row.phone === '59176543210')).toBe(true);
  });
});
