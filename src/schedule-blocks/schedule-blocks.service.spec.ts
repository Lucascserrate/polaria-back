import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FindOperator, type Repository } from 'typeorm';

import { ScheduleBlocksService } from './schedule-blocks.service';
import type { ScheduleBlock } from './entities/schedule-block.entity';
import type { Staff } from '../staff/entities/staff.entity';
import type { Tenant } from '../tenants/entities/tenant.entity';

const TENANT = 'tenant-1';
const OTHER_TENANT = 'tenant-2';

/**
 * Evalúa una condición de TypeORM contra un valor.
 *
 * Se interpretan los operadores que el servicio usa en lugar de espiar el
 * `where` que recibió el repositorio. Es la diferencia entre probar la regla y
 * probar la llamada: un `where` con los extremos invertidos pasaría igual una
 * aserción sobre su forma, y es justo el error que este módulo no puede tener.
 */
const satisfies = (value: unknown, condition: unknown): boolean => {
  if (condition instanceof FindOperator) {
    switch (condition.type) {
      case 'lessThan':
        return (value as Date) < (condition.value as Date);
      case 'moreThan':
        return (value as Date) > (condition.value as Date);
      case 'isNull':
        return value === null || value === undefined;
      default:
        throw new Error(`Operador no simulado: ${condition.type}`);
    }
  }

  return value === condition;
};

/**
 * Una base en memoria con lo que importa de esta tabla: que el recorte por
 * rango sea por solapamiento y que un `where` en dos ramas signifique OR.
 */
const setup = (
  options: {
    timezone?: string | null;
    staff?: Array<{ id: string; tenantId: string; name: string }>;
  } = {},
) => {
  const rows: ScheduleBlock[] = [];
  const staffRows = options.staff ?? [
    { id: 'staff-1', tenantId: TENANT, name: 'Diego' },
  ];
  let nextId = 1;

  const matchesWhere = (row: ScheduleBlock, where: object) =>
    Object.entries(where).every(([key, condition]) =>
      satisfies((row as unknown as Record<string, unknown>)[key], condition),
    );

  // `Array.isArray` estrecha a `any[]`, así que las ramas se re-tipan a mano.
  const matches = (row: ScheduleBlock, where: object | object[]) =>
    Array.isArray(where)
      ? (where as object[]).some((branch) => matchesWhere(row, branch))
      : matchesWhere(row, where);

  /** Lo que haría `relations: { staff: true }`. */
  const withStaff = (row: ScheduleBlock): ScheduleBlock => ({
    ...row,
    staff: (staffRows.find((staff) => staff.id === row.staffId) ??
      null) as Staff | null,
  });

  const scheduleBlockRepository = {
    create: jest.fn(
      (data: Partial<ScheduleBlock>) => ({ ...data }) as ScheduleBlock,
    ),
    save: jest.fn((block: ScheduleBlock) => {
      const saved = { ...block, id: `block-${nextId++}` } as ScheduleBlock;
      rows.push(saved);
      return Promise.resolve(saved);
    }),
    find: jest.fn(({ where }: { where: object | object[] }) =>
      Promise.resolve(
        rows
          .filter((row) => matches(row, where))
          // El servicio pide `order: { startTime: 'ASC' }`.
          .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
          .map(withStaff),
      ),
    ),
    findOne: jest.fn(({ where }: { where: object }) =>
      Promise.resolve(
        rows.filter((row) => matches(row, where)).map(withStaff)[0] ?? null,
      ),
    ),
    delete: jest.fn((where: Partial<ScheduleBlock>) => {
      const index = rows.findIndex((row) => matchesWhere(row, where));
      if (index === -1) return Promise.resolve({ affected: 0 });

      rows.splice(index, 1);
      return Promise.resolve({ affected: 1 });
    }),
  };

  const staffRepository = {
    findOne: jest.fn(({ where }: { where: Partial<Staff> }) =>
      Promise.resolve(
        (staffRows.find(
          (staff) =>
            staff.id === where.id &&
            (where.tenantId === undefined || staff.tenantId === where.tenantId),
        ) ?? null) as Staff | null,
      ),
    ),
  };

  const tenantRepository = {
    findOne: jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve({
        id: where.id,
        timezone: options.timezone ?? 'America/La_Paz',
      } as Tenant),
    ),
  };

  const service = new ScheduleBlocksService(
    scheduleBlockRepository as unknown as Repository<ScheduleBlock>,
    staffRepository as unknown as Repository<Staff>,
    tenantRepository as unknown as Repository<Tenant>,
  );

  return { service, rows };
};

/** Deja unos bloqueos cargados y devuelve el servicio para consultarlos. */
const withBlocks = async (
  blocks: Array<{
    startTime: string;
    durationMinutes: number;
    staffId?: string | null;
  }>,
  options: Parameters<typeof setup>[0] = {},
) => {
  const context = setup(options);

  for (const block of blocks) {
    await context.service.create(TENANT, block);
  }

  return context;
};

describe('ScheduleBlocksService.create', () => {
  it('deriva el final de la duración', async () => {
    const { service } = setup();

    const block = await service.create(TENANT, {
      startTime: '2026-09-10T17:00:00.000Z',
      durationMinutes: 90,
      staffId: 'staff-1',
    });

    expect(block.startTime).toBe('2026-09-10T17:00:00.000Z');
    expect(block.endTime).toBe('2026-09-10T18:30:00.000Z');
  });

  it('acepta un bloqueo sin profesional: es todo el negocio', async () => {
    const { service } = setup();

    const block = await service.create(TENANT, {
      startTime: '2026-09-10T17:00:00.000Z',
      durationMinutes: 60,
    });

    expect(block.staffId).toBeNull();
    expect(block.staffName).toBeNull();
  });

  it('responde con el nombre del profesional', async () => {
    const { service } = setup();

    const block = await service.create(TENANT, {
      startTime: '2026-09-10T17:00:00.000Z',
      durationMinutes: 60,
      staffId: 'staff-1',
    });

    expect(block.staffName).toBe('Diego');
  });

  /*
   * La clave ajena aceptaría el id sin protestar: el profesional existe, sólo
   * que en otro negocio. El bloqueo quedaría cargado donde nadie puede verlo.
   */
  it('rechaza a un profesional de otro negocio', async () => {
    const { service } = setup({
      staff: [{ id: 'staff-9', tenantId: OTHER_TENANT, name: 'Ajeno' }],
    });

    await expect(
      service.create(TENANT, {
        startTime: '2026-09-10T17:00:00.000Z',
        durationMinutes: 60,
        staffId: 'staff-9',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('normaliza un motivo en blanco a null', async () => {
    const { service } = setup();

    const block = await service.create(TENANT, {
      startTime: '2026-09-10T17:00:00.000Z',
      durationMinutes: 60,
      reason: '   ',
    });

    expect(block.reason).toBeNull();
  });

  it('recorta los espacios del motivo', async () => {
    const { service } = setup();

    const block = await service.create(TENANT, {
      startTime: '2026-09-10T17:00:00.000Z',
      durationMinutes: 60,
      reason: '  Turno médico  ',
    });

    expect(block.reason).toBe('Turno médico');
  });
});

describe('ScheduleBlocksService.findRange', () => {
  /*
   * La ventana se resuelve en la zona del negocio: en La Paz (UTC-4) el día
   * arranca a las 04:00 UTC. Con la zona del servidor, un bloqueo de las 21:00
   * caería en el día siguiente.
   */
  it('toma el día en la zona del negocio', async () => {
    const { service } = await withBlocks([
      // 21:00 del 10 en La Paz.
      { startTime: '2026-09-11T01:00:00.000Z', durationMinutes: 60 },
    ]);

    const sameDay = await service.findRange(TENANT, '2026-09-10', '2026-09-10');
    expect(sameDay.items).toHaveLength(1);
    expect(sameDay.timezone).toBe('America/La_Paz');

    const nextDay = await service.findRange(TENANT, '2026-09-11', '2026-09-11');
    expect(nextDay.items).toHaveLength(0);
  });

  /*
   * El motivo de filtrar por solapamiento y no por inicio, que es lo que hace
   * la consulta de citas: un bloqueo se carga a mano sobre cualquier hueco, así
   * que puede empezar un día y terminar el siguiente.
   */
  it('incluye la cola de un bloqueo que empezó el día anterior', async () => {
    const { service } = await withBlocks([
      // 23:00 del 10 en La Paz, dos horas: termina a la 01:00 del 11.
      { startTime: '2026-09-11T03:00:00.000Z', durationMinutes: 120 },
    ]);

    const nextDay = await service.findRange(TENANT, '2026-09-11', '2026-09-11');

    expect(nextDay.items).toHaveLength(1);
  });

  it('deja afuera lo que termina justo cuando arranca el rango', async () => {
    const { service } = await withBlocks([
      // Termina a la medianoche del 11 en La Paz, que es donde empieza el rango.
      { startTime: '2026-09-11T03:00:00.000Z', durationMinutes: 60 },
    ]);

    const nextDay = await service.findRange(TENANT, '2026-09-11', '2026-09-11');

    expect(nextDay.items).toHaveLength(0);
  });

  it('devuelve la semana entera con los dos extremos incluidos', async () => {
    const { service } = await withBlocks([
      { startTime: '2026-09-07T17:00:00.000Z', durationMinutes: 60 },
      { startTime: '2026-09-13T17:00:00.000Z', durationMinutes: 60 },
      { startTime: '2026-09-14T17:00:00.000Z', durationMinutes: 60 },
    ]);

    const week = await service.findRange(TENANT, '2026-09-07', '2026-09-13');

    expect(week.items).toHaveLength(2);
  });

  it('ordena por inicio', async () => {
    const { service } = await withBlocks([
      { startTime: '2026-09-10T19:00:00.000Z', durationMinutes: 60 },
      { startTime: '2026-09-10T15:00:00.000Z', durationMinutes: 60 },
    ]);

    const day = await service.findRange(TENANT, '2026-09-10', '2026-09-10');

    expect(day.items.map((item) => item.startTime)).toEqual([
      '2026-09-10T15:00:00.000Z',
      '2026-09-10T19:00:00.000Z',
    ]);
  });

  /*
   * Un profesional ve lo que le tapa horas: lo suyo y lo del negocio entero. El
   * bloqueo de un compañero no es asunto suyo.
   */
  it('acotado a un profesional, suma los del negocio y descarta los ajenos', async () => {
    const { service } = await withBlocks(
      [
        {
          startTime: '2026-09-10T15:00:00.000Z',
          durationMinutes: 60,
          staffId: 'staff-1',
        },
        {
          startTime: '2026-09-10T16:00:00.000Z',
          durationMinutes: 60,
          staffId: 'staff-2',
        },
        { startTime: '2026-09-10T17:00:00.000Z', durationMinutes: 60 },
      ],
      {
        staff: [
          { id: 'staff-1', tenantId: TENANT, name: 'Diego' },
          { id: 'staff-2', tenantId: TENANT, name: 'Carlos' },
        ],
      },
    );

    const scoped = await service.findRange(
      TENANT,
      '2026-09-10',
      '2026-09-10',
      'staff-1',
    );

    expect(scoped.items.map((item) => item.staffId)).toEqual(['staff-1', null]);
  });

  it('no cruza negocios', async () => {
    const { service } = await withBlocks([
      { startTime: '2026-09-10T17:00:00.000Z', durationMinutes: 60 },
    ]);

    const other = await service.findRange(
      OTHER_TENANT,
      '2026-09-10',
      '2026-09-10',
    );

    expect(other.items).toHaveLength(0);
  });

  it('rechaza un rango invertido', async () => {
    const { service } = setup();

    await expect(
      service.findRange(TENANT, '2026-09-13', '2026-09-07'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza una fecha que no existe', async () => {
    const { service } = setup();

    await expect(
      service.findRange(TENANT, '2026-02-31', '2026-02-31'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza un rango más largo que el tope', async () => {
    const { service } = setup();

    await expect(
      service.findRange(TENANT, '2026-01-01', '2026-12-31'),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('ScheduleBlocksService.remove', () => {
  it('borra el bloqueo del negocio', async () => {
    const { service, rows } = setup();

    const block = await service.create(TENANT, {
      startTime: '2026-09-10T17:00:00.000Z',
      durationMinutes: 60,
    });

    await expect(service.remove(TENANT, block.id)).resolves.toEqual({
      id: block.id,
    });
    expect(rows).toHaveLength(0);
  });

  /* El `tenantId` va en el `where`, así que un id ajeno no encuentra fila. */
  it('no borra el de otro negocio', async () => {
    const { service, rows } = setup();

    const block = await service.create(TENANT, {
      startTime: '2026-09-10T17:00:00.000Z',
      durationMinutes: 60,
    });

    await expect(service.remove(OTHER_TENANT, block.id)).rejects.toThrow(
      NotFoundException,
    );
    expect(rows).toHaveLength(1);
  });

  it('avisa cuando el bloqueo no existe', async () => {
    const { service } = setup();

    await expect(service.remove(TENANT, 'block-404')).rejects.toThrow(
      NotFoundException,
    );
  });
});
