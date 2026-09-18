import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';

import { ServicesService } from './services.service';
import type { Service } from './entities/service.entity';
import type { Tenant } from '../tenants/entities/tenant.entity';
import type { ServiceCategoriesService } from '../service-categories/service-categories.service';

const TENANT = 'tenant-1';

/**
 * Lo mínimo para ejercitar la frontera entre un servicio y su categoría: qué
 * llega a guardarse y qué se rechaza antes.
 *
 * `categoriesService` se simula en lugar de armar otra base en memoria: acá se
 * prueba que servicios **consulte** la pertenencia y respete la respuesta, no
 * cómo se resuelve —eso lo cubre `service-categories.service.spec.ts`—.
 */
const setup = (ownCategories: string[] = []) => {
  const saved: Array<Partial<Service>> = [];
  const updated: Array<Partial<Service>> = [];

  const serviceRepository = {
    create: (data: Partial<Service>) => data as Service,
    save: jest.fn((service: Service) => {
      saved.push(service);
      return Promise.resolve(service);
    }),
    update: jest.fn((_where: unknown, changes: Partial<Service>) => {
      updated.push(changes);
      return Promise.resolve({ affected: 1 });
    }),
    findOne: jest.fn(() => Promise.resolve(null)),
  };

  const tenantRepository = {
    findOne: jest.fn(() => Promise.resolve({ currency: 'BOB' })),
  };

  const categoriesService = {
    assertBelongsToTenant: jest.fn((id: string, tenantId: string) => {
      if (tenantId === TENANT && ownCategories.includes(id)) {
        return Promise.resolve();
      }
      return Promise.reject(new NotFoundException('Esa categoría no existe.'));
    }),
  };

  return {
    saved,
    updated,
    categoriesService,
    service: new ServicesService(
      serviceRepository as unknown as Repository<Service>,
      tenantRepository as unknown as Repository<Tenant>,
      categoriesService as unknown as ServiceCategoriesService,
    ),
  };
};

const draft = {
  name: 'Corte de pelo',
  price: 25,
  timezone: 'America/La_Paz',
  durationMinutes: 30,
};

describe('ServicesService y la categoría', () => {
  it('no deja guardar un servicio en la categoría de otro negocio', async () => {
    // El id existe y la foreign key lo aceptaría: el que tiene que decir que no
    // es el servicio, comparando el negocio.
    const { service, saved } = setup([]);

    await expect(
      service.create({ ...draft, tenantId: TENANT, categoryId: 'ajena' }),
    ).rejects.toThrow(NotFoundException);
    expect(saved).toHaveLength(0);
  });

  it('guarda el servicio en una categoría propia', async () => {
    const { service, saved } = setup(['cat-1']);

    await service.create({ ...draft, tenantId: TENANT, categoryId: 'cat-1' });

    expect(saved[0]).toMatchObject({ categoryId: 'cat-1' });
  });

  it('un servicio sin categoría no consulta nada', async () => {
    const { service, categoriesService } = setup([]);

    await service.create({ ...draft, tenantId: TENANT });

    expect(categoriesService.assertBelongsToTenant).not.toHaveBeenCalled();
  });

  it('sacarlo de su categoría es un null, y tampoco consulta', async () => {
    // `null` y `undefined` se escriben distinto: uno borra la categoría y el
    // otro la deja como estaba. Ninguno apunta a una fila que comprobar.
    const { service, categoriesService, updated } = setup([]);

    await service.updateByTenant('svc-1', TENANT, { categoryId: null });

    expect(categoriesService.assertBelongsToTenant).not.toHaveBeenCalled();
    expect(updated[0]).toMatchObject({ categoryId: null });
  });

  it('tampoco al editar se puede mover a la categoría de otro negocio', async () => {
    const { service, updated } = setup([]);

    await expect(
      service.updateByTenant('svc-1', TENANT, { categoryId: 'ajena' }),
    ).rejects.toThrow(NotFoundException);
    expect(updated).toHaveLength(0);
  });
});
