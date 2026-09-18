import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';

import { ServiceCategoriesService } from './service-categories.service';
import { MoveDirection } from './dto/move-service-category.dto';
import type { ServiceCategory } from './entities/service-category.entity';

const TENANT = 'tenant-1';
const OTHER_TENANT = 'tenant-2';

/** El error que tira MySQL cuando choca el índice único. */
const duplicateEntry = () =>
  Object.assign(new Error('ER_DUP_ENTRY'), { code: 'ER_DUP_ENTRY' });

/**
 * Una base en memoria con lo que importa de esta tabla: que cada fila sea de un
 * negocio y que el nombre no se repita dentro de él.
 */
const setup = (seed: Array<Partial<ServiceCategory>> = []) => {
  const rows = seed.map(
    (row, index) =>
      ({
        id: row.id ?? `cat-${index + 1}`,
        tenantId: row.tenantId ?? TENANT,
        name: row.name ?? `Categoría ${index + 1}`,
        position: row.position ?? index,
      }) as ServiceCategory,
  );

  const matches = (row: ServiceCategory, where: Partial<ServiceCategory>) =>
    Object.entries(where).every(
      ([key, value]) => row[key as keyof ServiceCategory] === value,
    );

  const repository = {
    create: (data: Partial<ServiceCategory>) =>
      ({ ...data }) as ServiceCategory,

    save: jest.fn((category: ServiceCategory) => {
      const clash = rows.some(
        (row) =>
          row.tenantId === category.tenantId && row.name === category.name,
      );
      if (clash) return Promise.reject(duplicateEntry());

      const saved = {
        ...category,
        id: category.id ?? `cat-${rows.length + 1}`,
      };
      rows.push(saved);
      return Promise.resolve(saved);
    }),

    find: jest.fn(({ where }: { where: Partial<ServiceCategory> }) =>
      Promise.resolve(
        rows
          .filter((row) => matches(row, where))
          .sort(
            (a, b) => a.position - b.position || a.name.localeCompare(b.name),
          ),
      ),
    ),

    findOne: jest.fn(
      ({
        where,
        order,
      }: {
        where: Partial<ServiceCategory>;
        order?: { position?: 'ASC' | 'DESC' };
      }) => {
        const found = rows.filter((row) => matches(row, where));
        if (order?.position === 'DESC') {
          found.sort((a, b) => b.position - a.position);
        }
        return Promise.resolve(found[0] ?? null);
      },
    ),

    update: jest.fn(
      (where: Partial<ServiceCategory>, changes: Partial<ServiceCategory>) => {
        const target = rows.find((row) => matches(row, where));
        if (!target) return Promise.resolve({ affected: 0 });

        const clash = rows.some(
          (row) =>
            row !== target &&
            row.tenantId === target.tenantId &&
            row.name === changes.name,
        );
        if (clash) return Promise.reject(duplicateEntry());

        Object.assign(target, changes);
        return Promise.resolve({ affected: 1 });
      },
    ),

    /** Lo que usa `renumber`: escribe todas las posiciones o ninguna. */
    manager: {
      transaction: (run: (m: unknown) => Promise<void>) =>
        run({
          update: (
            _entity: unknown,
            where: { id: string },
            changes: { position: number },
          ) => {
            const row = rows.find((candidate) => candidate.id === where.id);
            if (row) row.position = changes.position;
            return Promise.resolve({ affected: row ? 1 : 0 });
          },
        }),
    },

    delete: jest.fn((where: Partial<ServiceCategory>) => {
      const index = rows.findIndex((row) => matches(row, where));
      if (index === -1) return Promise.resolve({ affected: 0 });

      rows.splice(index, 1);
      return Promise.resolve({ affected: 1 });
    }),
  };

  return {
    rows,
    service: new ServiceCategoriesService(
      repository as unknown as Repository<ServiceCategory>,
    ),
  };
};

describe('ServiceCategoriesService', () => {
  it('la categoría nueva va al final, no arriba de las que ya estaban', async () => {
    const { service } = setup([
      { name: 'Cabello', position: 0 },
      { name: 'Barbería', position: 1 },
    ]);

    const created = await service.create(TENANT, { name: 'Uñas' });

    expect(created.position).toBe(2);
  });

  it('la primera categoría de un negocio arranca en cero', async () => {
    // Las de otro negocio no cuentan: cada catálogo ordena el suyo.
    const { service } = setup([{ tenantId: OTHER_TENANT, position: 7 }]);

    const created = await service.create(TENANT, { name: 'Cabello' });

    expect(created.position).toBe(0);
  });

  it('repetir un nombre se contesta, no se rompe', async () => {
    const { service } = setup([{ name: 'Cabello' }]);

    await expect(service.create(TENANT, { name: 'Cabello' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('el mismo nombre en otro negocio es una categoría distinta', async () => {
    const { service } = setup([{ tenantId: OTHER_TENANT, name: 'Cabello' }]);

    await expect(
      service.create(TENANT, { name: 'Cabello' }),
    ).resolves.toMatchObject({ name: 'Cabello', tenantId: TENANT });
  });

  it('renombrar a un nombre que ya existe se contesta igual', async () => {
    const { service } = setup([
      { id: 'cat-1', name: 'Cabello' },
      { id: 'cat-2', name: 'Uñas' },
    ]);

    await expect(
      service.updateByTenant('cat-2', TENANT, { name: 'Cabello' }),
    ).rejects.toThrow(ConflictException);
  });

  it('no se puede renombrar la categoría de otro negocio', async () => {
    const { rows, service } = setup([
      { id: 'cat-1', tenantId: OTHER_TENANT, name: 'Cabello' },
    ]);

    await expect(
      service.updateByTenant('cat-1', TENANT, { name: 'Robada' }),
    ).rejects.toThrow(NotFoundException);
    expect(rows[0].name).toBe('Cabello');
  });

  it('no se puede borrar la categoría de otro negocio', async () => {
    const { rows, service } = setup([{ id: 'cat-1', tenantId: OTHER_TENANT }]);

    await expect(service.removeByTenant('cat-1', TENANT)).rejects.toThrow(
      NotFoundException,
    );
    expect(rows).toHaveLength(1);
  });

  it('las categorías vacías se devuelven igual que las llenas', async () => {
    // La recién creada no tiene servicios todavía, y es la que hay que ver para
    // poder llenarla.
    const { service } = setup([{ name: 'Uñas' }]);

    await expect(service.findByTenant(TENANT)).resolves.toHaveLength(1);
  });

  it('una categoría de otro negocio no pasa la verificación de pertenencia', async () => {
    const { service } = setup([{ id: 'cat-1', tenantId: OTHER_TENANT }]);

    await expect(
      service.assertBelongsToTenant('cat-1', TENANT),
    ).rejects.toThrow(NotFoundException);
  });

  describe('reordenar', () => {
    const catalogo = () => [
      { id: 'a', name: 'Cabello', position: 0 },
      { id: 'b', name: 'Uñas', position: 1 },
      { id: 'c', name: 'Barbería', position: 2 },
    ];

    const nombres = (categories: Array<{ name: string }>) =>
      categories.map((category) => category.name);

    it('subir una categoría la pone antes de la que tenía encima', async () => {
      const { service } = setup(catalogo());

      const result = await service.moveByTenant('c', TENANT, MoveDirection.UP);

      expect(nombres(result)).toEqual(['Cabello', 'Barbería', 'Uñas']);
    });

    it('bajar una categoría la pone después de la siguiente', async () => {
      const { service } = setup(catalogo());

      const result = await service.moveByTenant(
        'a',
        TENANT,
        MoveDirection.DOWN,
      );

      expect(nombres(result)).toEqual(['Uñas', 'Cabello', 'Barbería']);
    });

    it('las posiciones quedan contiguas desde cero', async () => {
      // Con huecos, `nextPosition` puede repetir una posición y el orden pasaría
      // a depender del desempate por nombre.
      const { rows, service } = setup(catalogo());

      await service.moveByTenant('c', TENANT, MoveDirection.UP);

      expect(rows.map((row) => row.position).sort()).toEqual([0, 1, 2]);
    });

    it('subir la primera no es un error: devuelve la lista como está', async () => {
      // El botón está deshabilitado en la punta, pero entre que se dibuja y se
      // toca la lista pudo cambiar. Eso no es culpa de quien tocó.
      const { service } = setup(catalogo());

      const result = await service.moveByTenant('a', TENANT, MoveDirection.UP);

      expect(nombres(result)).toEqual(['Cabello', 'Uñas', 'Barbería']);
    });

    it('bajar la última tampoco', async () => {
      const { service } = setup(catalogo());

      const result = await service.moveByTenant(
        'c',
        TENANT,
        MoveDirection.DOWN,
      );

      expect(nombres(result)).toEqual(['Cabello', 'Uñas', 'Barbería']);
    });

    it('no se puede mover la categoría de otro negocio', async () => {
      const { service } = setup([{ id: 'x', tenantId: OTHER_TENANT }]);

      await expect(
        service.moveByTenant('x', TENANT, MoveDirection.UP),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
