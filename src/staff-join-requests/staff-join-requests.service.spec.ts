import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';

import { StaffJoinRequestsService } from './staff-join-requests.service';
import type { StaffJoinRequest } from './entities/staff-join-request.entity';
import type { StaffService } from '../staff/staff.service';
import type { TenantsService } from '../tenants/tenants.service';

const TENANT = 'tenant-1';

type Row = Partial<StaffJoinRequest> & { id: string };

/**
 * Los dobles reproducen las dos reglas que sostienen esto: que un negocio exista
 * y que una cuenta ya tenga ficha. Lo demás —el índice único— se prueba contra la
 * base, no acá.
 */
const setup = (
  options: { rows?: Row[]; staffExists?: boolean; tenantExists?: boolean } = {},
) => {
  const rows: Row[] = options.rows ?? [];
  let nextId = rows.length + 1;

  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(
      ([key, value]) => (row as Record<string, unknown>)[key] === value,
    );

  const requestRepository = {
    create: jest.fn((data: Row) => ({ ...data })),
    save: jest.fn((row: Row) => {
      if (!row.id) {
        const saved = { ...row, id: `req-${nextId++}` };
        rows.push(saved);
        return Promise.resolve(saved);
      }

      const index = rows.findIndex((candidate) => candidate.id === row.id);
      if (index >= 0) rows[index] = { ...rows[index], ...row };
      return Promise.resolve(row);
    }),
    count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.filter((row) => matches(row, where)).length),
    ),
    find: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.filter((row) => matches(row, where))),
    ),
    findOne: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.find((row) => matches(row, where)) ?? null),
    ),
  };

  const tenantsService = {
    findOne: jest.fn(() =>
      Promise.resolve(
        options.tenantExists === false
          ? null
          : { id: TENANT, name: 'La Mafia' },
      ),
    ),
    searchJoinable: jest.fn(() => Promise.resolve([])),
  };

  const staffService = {
    findByGoogleAccount: jest.fn(() =>
      Promise.resolve(options.staffExists ? { id: 'staff-1' } : null),
    ),
    create: jest.fn(() => Promise.resolve({ id: 'staff-nuevo' })),
    grantAccess: jest.fn(() => Promise.resolve({ id: 'staff-nuevo' })),
  };

  const service = new StaffJoinRequestsService(
    requestRepository as unknown as Repository<StaffJoinRequest>,
    tenantsService as unknown as TenantsService,
    staffService as unknown as StaffService,
  );

  return { service, rows, staffService };
};

const identity = {
  tenantId: TENANT,
  googleId: 'g-1',
  email: 'juan@gmail.com',
  name: 'Juan Pérez',
};

describe('StaffJoinRequestsService.request', () => {
  it('deja el pedido pendiente', async () => {
    const { service, rows } = setup();

    await service.request(identity);

    expect(rows[0]).toMatchObject({
      tenantId: TENANT,
      googleId: 'g-1',
      email: 'juan@gmail.com',
      status: 'pending',
    });
  });

  /* Sin correo el negocio no tiene con qué darle acceso: no hay pedido posible. */
  it('rechaza una cuenta sin correo', async () => {
    const { service } = setup();

    await expect(
      service.request({ ...identity, email: null }),
    ).rejects.toThrow();
  });

  it('rechaza si el negocio no existe', async () => {
    const { service } = setup({ tenantExists: false });

    await expect(service.request(identity)).rejects.toThrow(NotFoundException);
  });

  /*
   * Quien ya tiene ficha no tiene nada que pedir: tiene que volver a entrar. Es
   * el caso de quien pide dos veces porque no entendió que ya lo agregaron.
   */
  it('rechaza si esa cuenta ya tiene acceso en algún negocio', async () => {
    const { service } = setup({ staffExists: true });

    await expect(service.request(identity)).rejects.toThrow(ConflictException);
  });

  it('corta al llegar al tope de pedidos pendientes', async () => {
    const pending = Array.from({ length: 5 }, (_, index) => ({
      id: `req-${index}`,
      googleId: 'g-1',
      status: 'pending' as const,
      tenantId: `otro-${index}`,
    }));

    const { service } = setup({ rows: pending });

    await expect(service.request(identity)).rejects.toThrow(ConflictException);
  });
});

describe('StaffJoinRequestsService.approve', () => {
  const pendingRow = {
    id: 'req-1',
    tenantId: TENANT,
    googleId: 'g-1',
    email: 'juan@gmail.com',
    name: 'Juan Pérez',
    status: 'pending' as const,
  };

  /*
   * Lo que importa es que pase por `grantAccess`: es quien sabe rechazar un
   * correo que ya es de otra cuenta, que es justamente el choque del incidente.
   */
  it('crea la ficha y le da el acceso con ese correo', async () => {
    const { service, staffService } = setup({ rows: [{ ...pendingRow }] });

    await service.approve(TENANT, 'req-1');

    expect(staffService.create).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, providesServices: false }),
    );
    expect(staffService.grantAccess).toHaveBeenCalledWith(
      'staff-nuevo',
      'juan@gmail.com',
    );
  });

  it('deja el pedido como aprobado', async () => {
    const { service, rows } = setup({ rows: [{ ...pendingRow }] });

    await service.approve(TENANT, 'req-1');

    expect(rows[0].status).toBe('approved');
    expect(rows[0].resolvedAt).toBeInstanceOf(Date);
  });

  /* El `tenantId` va en el `where`: un id de otro negocio no encuentra fila. */
  it('no aprueba el pedido de otro negocio', async () => {
    const { service, staffService } = setup({ rows: [{ ...pendingRow }] });

    await expect(service.approve('otro-tenant', 'req-1')).rejects.toThrow(
      NotFoundException,
    );
    expect(staffService.create).not.toHaveBeenCalled();
  });

  it('no aprueba dos veces', async () => {
    const { service } = setup({
      rows: [{ ...pendingRow, status: 'approved' as const }],
    });

    await expect(service.approve(TENANT, 'req-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('StaffJoinRequestsService.search', () => {
  /* El mínimo vive en el servicio y no solo en el DTO: ver su comentario. */
  it('con menos de tres letras no consulta nada', async () => {
    const { service } = setup();

    await expect(service.search('la')).resolves.toEqual([]);
  });
});
