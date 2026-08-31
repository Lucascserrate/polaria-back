import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';

import { ClientsService } from './clients.service';
import type { Client } from './entities/client.entity';
import type { Tenant } from '../tenants/entities/tenant.entity';

/** El error que devuelve MySQL cuando choca el índice `(tenantId, phone)`. */
const duplicateEntry = () =>
  Object.assign(new Error('ER_DUP_ENTRY'), { code: 'ER_DUP_ENTRY' });

/**
 * Una base en memoria con la regla que importa: `(tenantId, phone)` es único.
 *
 * Se simula esa restricción y no sólo las llamadas porque es la que sostiene
 * todo el resolver. Un doble que acepte dos veces el mismo teléfono daría por
 * buenos exactamente los duplicados que este módulo existe para evitar.
 */
const setup = (options: { timezone?: string | null } = {}) => {
  const rows: Client[] = [];
  let nextId = 1;

  const clientRepository = {
    findOneBy: jest.fn(({ tenantId, phone }: Partial<Client>) =>
      Promise.resolve(
        rows.find(
          (row) => row.tenantId === tenantId && (row.phone ?? null) === phone,
        ) ?? null,
      ),
    ),
    create: jest.fn((data: Partial<Client>) => ({ ...data }) as Client),
    save: jest.fn((client: Client) => {
      if (
        client.phone &&
        rows.some(
          (row) =>
            row.tenantId === client.tenantId && row.phone === client.phone,
        )
      ) {
        return Promise.reject(duplicateEntry());
      }
      const saved = { ...client, id: `client-${nextId++}` } as Client;
      rows.push(saved);
      return Promise.resolve(saved);
    }),
  };

  const tenantRepository = {
    findOne: jest.fn(() =>
      Promise.resolve({
        id: 'tenant-1',
        timezone: options.timezone ?? 'America/La_Paz',
      } as Tenant),
    ),
  };

  const service = new ClientsService(
    clientRepository as unknown as Repository<Client>,
    tenantRepository as unknown as Repository<Tenant>,
  );

  return { service, clientRepository, rows };
};

describe('ClientsService.resolveByPhone', () => {
  it('reconoce por la web al cliente que ya había llegado por WhatsApp', async () => {
    // Es el escenario que justifica el módulo entero: la misma persona entrando
    // por dos puertas tiene que ser un solo cliente, con un solo historial.
    const { service, rows } = setup();

    const porWhatsApp = await service.resolveByPhone({
      tenantId: 'tenant-1',
      phone: { kind: 'whatsapp', value: '59170123456' },
      name: 'Usuario 3456',
    });

    const porLaWeb = await service.resolveByPhone({
      tenantId: 'tenant-1',
      phone: { kind: 'typed', value: '70123456' },
      name: 'Ana Quispe',
    });

    expect(porLaWeb.id).toBe(porWhatsApp.id);
    expect(rows).toHaveLength(1);
  });

  it('no pisa el nombre del cliente que ya existe', async () => {
    // El que cargó el negocio vale más que el del perfil de WhatsApp, que la
    // persona cambia cuando quiere.
    const { service } = setup();

    await service.resolveByPhone({
      tenantId: 'tenant-1',
      phone: { kind: 'typed', value: '70123456' },
      name: 'Ana Quispe',
    });

    const otra = await service.resolveByPhone({
      tenantId: 'tenant-1',
      phone: { kind: 'whatsapp', value: '59170123456' },
      name: 'anita',
    });

    expect(otra.name).toBe('Ana Quispe');
  });

  it('conserva el número del cliente extranjero que llega por WhatsApp', async () => {
    /*
     * El `wa_id` trae el país del cliente, no el del negocio. Aplicarle el
     * prefijo boliviano guardaba `591573001234567` —un número que no existe— y
     * el recordatorio de la cita se iba a la nada.
     */
    const { service } = setup({ timezone: 'America/La_Paz' });

    const client = await service.resolveByPhone({
      tenantId: 'tenant-1',
      phone: { kind: 'whatsapp', value: '573001234567' },
      name: 'Camilo',
    });

    expect(client.phone).toBe('573001234567');
  });

  it('separa a dos personas del mismo nombre con teléfonos distintos', async () => {
    const { service, rows } = setup();

    const una = await service.resolveByPhone({
      tenantId: 'tenant-1',
      phone: { kind: 'typed', value: '70123456' },
      name: 'Ana',
    });
    const otra = await service.resolveByPhone({
      tenantId: 'tenant-1',
      phone: { kind: 'typed', value: '70999888' },
      name: 'Ana',
    });

    expect(otra.id).not.toBe(una.id);
    expect(rows).toHaveLength(2);
  });

  it('no cruza clientes entre dos negocios', async () => {
    const { service, rows } = setup();

    const enUno = await service.resolveByPhone({
      tenantId: 'tenant-1',
      phone: { kind: 'whatsapp', value: '59170123456' },
      name: 'Ana',
    });
    const enOtro = await service.resolveByPhone({
      tenantId: 'tenant-2',
      phone: { kind: 'whatsapp', value: '59170123456' },
      name: 'Ana',
    });

    expect(enOtro.id).not.toBe(enUno.id);
    expect(rows).toHaveLength(2);
  });

  it('deduce el prefijo de la zona horaria del negocio', async () => {
    // Un negocio argentino tiene que interpretar "1123456789" como argentino.
    const { service } = setup({ timezone: 'America/Argentina/Cordoba' });

    const client = await service.resolveByPhone({
      tenantId: 'tenant-1',
      phone: { kind: 'typed', value: '1123456789' },
      name: 'Ana',
    });

    expect(client.phone).toBe('541123456789');
  });

  it('se queda con el cliente que ganó la carrera', async () => {
    /*
     * Dos mensajes seguidos del mismo número llegan como dos webhooks casi
     * simultáneos: los dos encuentran la base sin el cliente y los dos intentan
     * crearlo. El índice único frena al segundo, y devolver un 500 ahí perdería
     * el mensaje de alguien que está esperando respuesta.
     */
    const { service, clientRepository, rows } = setup();

    const ganador = await service.resolveByPhone({
      tenantId: 'tenant-1',
      phone: { kind: 'whatsapp', value: '59170123456' },
      name: 'Ana',
    });

    // El segundo webhook no vio nada al buscar, y recién al escribir choca.
    clientRepository.findOneBy.mockImplementationOnce(() =>
      Promise.resolve(null),
    );

    const perdedor = await service.resolveByPhone({
      tenantId: 'tenant-1',
      phone: { kind: 'whatsapp', value: '59170123456' },
      name: 'Ana',
    });

    expect(perdedor.id).toBe(ganador.id);
    expect(rows).toHaveLength(1);
  });

  it('rechaza un teléfono que no se puede usar', async () => {
    // Guardarlo inventado es peor: la cita queda con un contacto que no existe.
    const { service } = setup();

    await expect(
      service.resolveByPhone({
        tenantId: 'tenant-1',
        phone: { kind: 'typed', value: 'no tengo' },
        name: 'Ana',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('ClientsService.createUnidentified', () => {
  it('crea uno nuevo cada vez, porque no hay nada que reconocer', async () => {
    // Es el costo de no pedir el teléfono en la agenda, y la razón de cerrar ese
    // camino: dos "Ana" escritas a mano son dos clientes con historiales
    // separados.
    const { service, rows } = setup();

    const una = await service.createUnidentified('tenant-1', 'Ana');
    const otra = await service.createUnidentified('tenant-1', 'Ana');

    expect(otra.id).not.toBe(una.id);
    expect(una.phone).toBeNull();
    expect(rows).toHaveLength(2);
  });
});
