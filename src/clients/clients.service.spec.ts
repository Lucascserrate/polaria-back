import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';

import { ClientsService } from './clients.service';
import { ClientSource, type Client } from './entities/client.entity';
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

  const match = ({ tenantId, phone, id }: Partial<Client>) =>
    rows.find(
      (row) =>
        (id === undefined || row.id === id) &&
        (tenantId === undefined || row.tenantId === tenantId) &&
        (phone === undefined || (row.phone ?? null) === phone),
    ) ?? null;

  const clientRepository = {
    /** El resolver la usa con `withDeleted`, así que ve también a los de baja. */
    findOne: jest.fn(({ where }: { where: Partial<Client> }) =>
      Promise.resolve(match(where)),
    ),
    /** Sin `withDeleted`: los dados de baja no aparecen, como en TypeORM. */
    findOneBy: jest.fn((where: Partial<Client>) => {
      const found = match(where);
      return Promise.resolve(found && !found.deletedAt ? found : null);
    }),
    restore: jest.fn((id: string) => {
      const found = rows.find((row) => row.id === id);
      if (found) found.deletedAt = null;
      return Promise.resolve({ affected: found ? 1 : 0 });
    }),
    create: jest.fn((data: Partial<Client>) => ({ ...data }) as Client),
    save: jest.fn((client: Client) => {
      /*
       * El índice único no distingue entre vivos y dados de baja: la fila
       * borrada lógicamente sigue ocupando su `(tenantId, phone)`. Es la razón
       * por la que el resolver tiene que buscar con `withDeleted`.
       */
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
      source: ClientSource.WHATSAPP,
      name: 'Usuario 3456',
    });

    const porLaWeb = await service.resolveByPhone({
      tenantId: 'tenant-1',
      phone: { kind: 'typed', value: '70123456' },
      source: ClientSource.WEB,
      name: 'Ana García',
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
      source: ClientSource.WEB,
      name: 'Ana García',
    });

    const otra = await service.resolveByPhone({
      tenantId: 'tenant-1',
      phone: { kind: 'whatsapp', value: '59170123456' },
      source: ClientSource.WHATSAPP,
      name: 'anita',
    });

    expect(otra.name).toBe('Ana García');
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
      source: ClientSource.WHATSAPP,
      name: 'Camilo',
    });

    expect(client.phone).toBe('573001234567');
  });

  it('separa a dos personas del mismo nombre con teléfonos distintos', async () => {
    const { service, rows } = setup();

    const una = await service.resolveByPhone({
      tenantId: 'tenant-1',
      phone: { kind: 'typed', value: '70123456' },
      source: ClientSource.WEB,
      name: 'Ana',
    });
    const otra = await service.resolveByPhone({
      tenantId: 'tenant-1',
      phone: { kind: 'typed', value: '70999888' },
      source: ClientSource.WEB,
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
      source: ClientSource.WHATSAPP,
      name: 'Ana',
    });
    const enOtro = await service.resolveByPhone({
      tenantId: 'tenant-2',
      phone: { kind: 'whatsapp', value: '59170123456' },
      source: ClientSource.WHATSAPP,
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
      source: ClientSource.WEB,
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
      source: ClientSource.WHATSAPP,
      name: 'Ana',
    });

    // El segundo webhook no vio nada al buscar, y recién al escribir choca.
    clientRepository.findOne.mockImplementationOnce(() =>
      Promise.resolve(null),
    );

    const perdedor = await service.resolveByPhone({
      tenantId: 'tenant-1',
      phone: { kind: 'whatsapp', value: '59170123456' },
      source: ClientSource.WHATSAPP,
      name: 'Ana',
    });

    expect(perdedor.id).toBe(ganador.id);
    expect(rows).toHaveLength(1);
  });

  it('guarda el resto de la ficha cuando el alta la trae', async () => {
    // El alta del panel manda email y cumpleaños en el mismo formulario. Se
    // perdían en silencio: el formulario los aceptaba y la ficha quedaba vacía.
    const { service } = setup();

    const client = await service.resolveByPhone({
      tenantId: 'tenant-1',
      phone: { kind: 'typed', value: '70123456' },
      source: ClientSource.PANEL,
      name: 'Ana García',
      profile: { email: 'ana@ejemplo.com', birthDate: '1994-03-17' },
    });

    expect(client.email).toBe('ana@ejemplo.com');
    expect(client.birthDate).toBe('1994-03-17');
  });

  it('no pisa la ficha del cliente que ya existe', async () => {
    // Misma regla que el nombre: lo cargado antes vale más que lo que trae este
    // formulario, que puede ser una carga apurada de alguien que no lo conocía.
    const { service } = setup();

    await service.resolveByPhone({
      tenantId: 'tenant-1',
      phone: { kind: 'typed', value: '70123456' },
      source: ClientSource.PANEL,
      name: 'Ana García',
      profile: { email: 'ana@ejemplo.com' },
    });

    const otra = await service.resolveByPhone({
      tenantId: 'tenant-1',
      phone: { kind: 'whatsapp', value: '59170123456' },
      source: ClientSource.WHATSAPP,
      name: 'Ana',
      profile: { email: 'otro@ejemplo.com' },
    });

    expect(otra.email).toBe('ana@ejemplo.com');
  });

  it('reactiva al cliente dado de baja que vuelve a reservar', async () => {
    /*
     * Su historial sigue siendo suyo, así que se lo devuelve al ruedo en vez de
     * crearle una ficha nueva. Y no es sólo una preferencia: la fila dada de
     * baja sigue ocupando su lugar en el índice único, así que insertar otra con
     * el mismo teléfono fallaría y la reserva se caería sin motivo visible.
     */
    const { service, rows } = setup();

    const original = await service.resolveByPhone({
      tenantId: 'tenant-1',
      phone: { kind: 'typed', value: '70123456' },
      source: ClientSource.PANEL,
      name: 'Ana García',
    });
    rows[0].deletedAt = new Date();

    const devuelto = await service.resolveByPhone({
      tenantId: 'tenant-1',
      phone: { kind: 'whatsapp', value: '59170123456' },
      source: ClientSource.WHATSAPP,
      name: 'Ana García',
    });

    expect(devuelto.id).toBe(original.id);
    expect(devuelto.deletedAt).toBeNull();
    expect(rows).toHaveLength(1);
  });

  it('rechaza un teléfono que no se puede usar', async () => {
    // Guardarlo inventado es peor: la cita queda con un contacto que no existe.
    const { service } = setup();

    await expect(
      service.resolveByPhone({
        tenantId: 'tenant-1',
        phone: { kind: 'typed', value: 'no tengo' },
        source: ClientSource.WEB,
        name: 'Ana',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
