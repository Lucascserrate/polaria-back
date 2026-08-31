import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, EntityManager, Repository } from 'typeorm';

import {
  Appointment,
  BLOCKING_APPOINTMENT_STATUSES,
} from '../appointments/entities/appointment.entity';
import { isDuplicateEntryError } from '../database/duplicate-entry.util';
import { Tenant } from '../tenants/entities/tenant.entity';
import { dialCodeForTimeZone } from '../tenants/dial-code';
import { Client, ClientSource } from './entities/client.entity';
import { UpdateClientDto } from './dto/update-client.dto';
import { resolveClientPhone, type ClientPhoneInput } from './client-phone.util';
import {
  resolveClientDeletion,
  type ClientDeletionCounts,
} from './utils/client-deletion.util';

/** Lo que se le pide al resolver para reconocer o dar de alta a alguien. */
export interface ResolveClientParams {
  tenantId: string;
  /**
   * De dónde salió el teléfono y con qué valor. Para `typed` el prefijo del país
   * es opcional: si no viene, se deduce de la zona horaria del negocio.
   */
  phone:
    | { kind: 'whatsapp'; value: string }
    | { kind: 'typed'; value: string; dialCode?: string };
  /** Con qué nombre se crea, si todavía no existía. Nunca pisa el que ya tiene. */
  name?: string | null;
  /** Por qué puerta entró, si es un alta. Ver `ClientSource`. */
  source: ClientSource;
}

/** Una página de la lista de clientes del panel. */
export interface ClientPage {
  items: Client[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

const INVALID_PHONE_MESSAGE =
  'El teléfono no parece válido. Revisalo y probá de nuevo.';

/** Tope por página. El mismo que usa el listado de citas. */
const MAX_PAGE_SIZE = 100;

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(
    @InjectRepository(Client)
    private clientRepository: Repository<Client>,
    @InjectRepository(Tenant)
    private tenantRepository: Repository<Tenant>,
  ) {}

  /**
   * Una página de la lista de clientes, con el buscador ya aplicado.
   *
   * Pagina en el servidor porque la lista no tiene techo: un negocio con dos años
   * de WhatsApp encima acumula miles de clientes, y devolverlos todos para que el
   * navegador filtre es una descarga que crece sola y una tabla que se traba.
   *
   * El buscador mira nombre, teléfono y email a la vez. Que el teléfono esté ahí
   * importa más de lo que parece: es el único dato con el que el negocio puede
   * distinguir a dos personas que se llaman igual.
   */
  async findPageByTenant(
    tenantId: string,
    options: { page?: number; limit?: number; search?: string } = {},
  ): Promise<ClientPage> {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(Math.max(1, options.limit ?? 20), MAX_PAGE_SIZE);

    const query = this.clientRepository
      .createQueryBuilder('client')
      .where('client.tenantId = :tenantId', { tenantId });

    const search = options.search?.trim();
    if (search) {
      query.andWhere(
        new Brackets((where) => {
          where
            .where('LOWER(client.name) LIKE LOWER(:search)', {
              search: `%${search}%`,
            })
            .orWhere('client.phone LIKE :search', { search: `%${search}%` })
            .orWhere('LOWER(client.email) LIKE LOWER(:search)', {
              search: `%${search}%`,
            });
        }),
      );
    }

    const [items, total] = await query
      .orderBy('client.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      items,
      total,
      page,
      limit,
      hasMore: (page - 1) * limit + items.length < total,
    };
  }

  findOne(id: string): Promise<Client | null> {
    return this.clientRepository.findOneBy({ id });
  }

  /** El cliente, comprobando que sea de este negocio. Lanza 404 si no. */
  async findOneByTenant(id: string, tenantId: string): Promise<Client> {
    const client = await this.clientRepository.findOneBy({ id, tenantId });
    if (!client) {
      throw new NotFoundException('El cliente no existe.');
    }
    return client;
  }

  async update(id: string, updateClientDto: UpdateClientDto) {
    await this.clientRepository.update(id, updateClientDto);
    return this.findOne(id);
  }

  /**
   * Guarda la ficha editada desde el panel.
   *
   * El teléfono vuelve a pasar por la normalización: si se guardara tal como se
   * escribió, una corrección a mano dejaría a ese cliente fuera del formato con
   * el que lo buscan WhatsApp y la página, y dejaría de reconocerse a sí mismo.
   *
   * Los campos vacíos se guardan como `NULL` y no como cadena vacía, que es la
   * forma que tiene el formulario de decir "borralo".
   */
  async updateByTenant(
    id: string,
    tenantId: string,
    dto: UpdateClientDto,
  ): Promise<Client> {
    await this.findOneByTenant(id, tenantId);

    /*
     * Se declaran sólo las columnas editables en vez de un `Partial<Client>`:
     * así lo que llega del formulario no puede tocar `tenantId`, `createdVia` ni
     * las relaciones, ni aunque un campo nuevo del DTO se olvide de filtrarse.
     */
    const changes: Pick<
      Partial<Client>,
      'name' | 'notes' | 'email' | 'birthDate' | 'phone'
    > = {};

    if (dto.name !== undefined) changes.name = dto.name.trim() || undefined;
    if (dto.notes !== undefined) changes.notes = dto.notes.trim() || undefined;
    if (dto.email !== undefined) changes.email = dto.email.trim() || null;
    if (dto.birthDate !== undefined) changes.birthDate = dto.birthDate || null;

    if (dto.phone !== undefined) {
      const typed = dto.phone.trim();
      /*
       * Vaciar el teléfono no se permite: es la identidad del cliente entre
       * canales, y dejarlo en `NULL` lo volvería irreconocible para siempre sin
       * que nada en la pantalla lo diga.
       */
      if (!typed) {
        throw new BadRequestException('El cliente necesita un teléfono.');
      }

      const phone = resolveClientPhone({
        kind: 'typed',
        value: typed,
        dialCode: await this.dialCodeFor(tenantId),
      });
      if (!phone) {
        throw new BadRequestException(INVALID_PHONE_MESSAGE);
      }
      changes.phone = phone;
    }

    try {
      await this.clientRepository.update(id, changes);
    } catch (error: unknown) {
      /*
       * El teléfono corregido ya es de otro cliente del mismo negocio. Es un
       * caso real —dos fichas de la misma persona, y el negocio arreglando una
       * para que coincida— y merece decir qué pasó, no un 500.
       */
      if (isDuplicateEntryError(error)) {
        throw new ConflictException(
          'Ya existe otro cliente con ese teléfono en este negocio.',
        );
      }
      throw error;
    }

    return this.findOneByTenant(id, tenantId);
  }

  /**
   * Quién es el cliente detrás de este teléfono. **El único camino** por el que
   * una reserva consigue su cliente, venga del canal que venga.
   *
   * Existe porque las tres puertas de entrada —WhatsApp, la página pública y el
   * panel— escribían el teléfono cada una a su manera, y el índice único
   * `(tenantId, phone)` sólo reconoce a la misma persona si las tres escriben
   * igual. La página normalizaba, WhatsApp guardaba el `wa_id` crudo y el panel
   * hacía un `trim()`: la misma persona entraba hasta tres veces y su historial
   * quedaba partido en tres.
   *
   * Normalizar acá adentro y no en el llamador es la parte que importa. Mientras
   * la normalización fue responsabilidad de quien llamaba, alcanzaba con que una
   * puerta nueva se olvidara de hacerla para volver a duplicar clientes, y nadie
   * se enteraba hasta que un cliente reclamaba que "no le aparecen sus turnos".
   *
   * No pisa el nombre de un cliente que ya existe: el que cargó el negocio a
   * mano —con apellido, o con "Ana la del turno de los martes"— vale más que el
   * que viene del perfil de WhatsApp. Ascenderlo cuando el guardado es peor que
   * el nuevo es una regla del asistente y vive allá.
   */
  async resolveByPhone(params: ResolveClientParams): Promise<Client> {
    const { tenantId } = params;

    const phoneInput: ClientPhoneInput =
      params.phone.kind === 'whatsapp'
        ? params.phone
        : {
            kind: 'typed',
            value: params.phone.value,
            dialCode:
              params.phone.dialCode ?? (await this.dialCodeFor(tenantId)),
          };

    const phone = resolveClientPhone(phoneInput);
    if (!phone) {
      throw new BadRequestException(INVALID_PHONE_MESSAGE);
    }

    /*
     * La búsqueda incluye a los dados de baja, y no es un detalle: la fila dada
     * de baja sigue ocupando su lugar en el índice único `(tenantId, phone)`, así
     * que ignorarla no crearía un cliente nuevo, fallaría con un choque de índice
     * y la reserva se caería sin motivo visible.
     */
    const existing = await this.clientRepository.findOne({
      where: { tenantId, phone },
      withDeleted: true,
    });

    if (existing) {
      return existing.deletedAt ? this.restore(existing) : existing;
    }

    const name = params.name?.trim() || null;

    try {
      return await this.clientRepository.save(
        this.clientRepository.create({
          tenantId,
          phone,
          name: name ?? undefined,
          createdVia: params.source,
        }),
      );
    } catch (error: unknown) {
      /*
       * Otro mensaje del mismo cliente llegó entre la búsqueda y la escritura.
       * Pasa de verdad: WhatsApp entrega dos webhooks casi simultáneos cuando
       * alguien manda dos mensajes seguidos, y los dos encontraban la base sin
       * el cliente. El índice único frena al segundo, y lo que corresponde es
       * quedarse con el que ganó, no devolver un 500 y perder el mensaje.
       */
      if (isDuplicateEntryError(error)) {
        const winner = await this.clientRepository.findOneBy({
          tenantId,
          phone,
        });
        if (winner) return winner;
      }
      throw error;
    }
  }

  /**
   * Da de alta a alguien de quien no se tiene el teléfono.
   *
   * Es el cliente que el panel crea al reservar escribiendo sólo un nombre. Sin
   * teléfono no hay forma de reconocerlo: queda con `phone` en `NULL`, fuera del
   * índice único, y el día que esa misma persona reserve por WhatsApp va a
   * entrar como un cliente nuevo.
   *
   * Existe aparte de `resolveByPhone`, y no como un parámetro opcional suyo,
   * para que se vea que es la excepción y no una variante: acá no se resuelve
   * nada, se crea siempre. Desaparece cuando el panel pida el teléfono al elegir
   * el cliente de una reserva.
   */
  createUnidentified(tenantId: string, name: string): Promise<Client> {
    this.logger.warn(
      `Cliente creado sin teléfono desde el panel (tenantId=${tenantId}). No se va a poder reconocer en otros canales.`,
    );

    return this.clientRepository.save(
      this.clientRepository.create({
        tenantId,
        phone: null,
        name: name.trim() || undefined,
        createdVia: ClientSource.PANEL,
      }),
    );
  }

  /**
   * Devuelve al ruedo a un cliente dado de baja que volvió a reservar.
   *
   * Se lo reactiva y no se crea otro porque su historial sigue ahí y es suyo. La
   * diferencia con un profesional dado de baja —que no vuelve solo— es de quién
   * es la decisión: que un profesional vuelva a atender lo decide el negocio, y
   * que un cliente vuelva a reservar lo decide el cliente.
   */
  private async restore(client: Client): Promise<Client> {
    await this.clientRepository.restore(client.id);
    this.logger.log(
      `Cliente reactivado al volver a reservar (clientId=${client.id}).`,
    );

    return (await this.clientRepository.findOneBy({ id: client.id })) ?? client;
  }

  /**
   * Elimina a un cliente, o lo da de baja, o se niega. Ver `resolveClientDeletion`.
   *
   * La transacción y el lock existen porque la decisión se toma a partir de un
   * conteo: sin ellos, una reserva entrando en el mismo instante haría que se
   * borrara físicamente a alguien que acaba de sacar turno, y la cita se iría en
   * la cascada de `appointments.clientId` sin dejar rastro.
   */
  async removeByTenant(
    id: string,
    tenantId: string,
  ): Promise<{ deleted: true; mode: 'HARD' | 'SOFT' }> {
    return this.clientRepository.manager.transaction(async (manager) => {
      const client = await manager.findOne(Client, {
        where: { id, tenantId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!client) {
        throw new NotFoundException('El cliente no existe.');
      }

      const counts = await this.countDeletionRelevant(manager, id);
      const plan = resolveClientDeletion(counts);

      if (plan.mode === 'BLOCKED') {
        throw new ConflictException({
          message:
            'El cliente tiene citas próximas. Cancelalas antes de eliminarlo.',
          futureAppointments: plan.futureAppointments,
        });
      }

      if (plan.mode === 'HARD') {
        await manager.delete(Client, id);
        this.logger.log(`Cliente eliminado (clientId=${id}).`);
        return { deleted: true, mode: 'HARD' };
      }

      await manager.softDelete(Client, id);
      this.logger.log(
        `Cliente dado de baja conservando historial (clientId=${id}, citas=${counts.totalAppointments}).`,
      );
      return { deleted: true, mode: 'SOFT' };
    });
  }

  /**
   * Citas totales y próximas de un cliente, en una sola consulta agrupada.
   *
   * Las dos preguntas se responden sobre el mismo conjunto de filas, y hacerlo de
   * una evita que las dos cuentas vean estados distintos de la base.
   */
  private async countDeletionRelevant(
    manager: EntityManager,
    clientId: string,
  ): Promise<ClientDeletionCounts> {
    const row = await manager
      .createQueryBuilder(Appointment, 'appointment')
      .select('COUNT(*)', 'total')
      .addSelect(
        `SUM(CASE WHEN appointment.status IN (:...activeStatuses) AND appointment.startTime >= :now THEN 1 ELSE 0 END)`,
        'future',
      )
      .where('appointment.clientId = :clientId', { clientId })
      .setParameters({
        activeStatuses: [...BLOCKING_APPOINTMENT_STATUSES],
        now: new Date(),
      })
      .getRawOne<{ total: string; future: string | null }>();

    return {
      totalAppointments: Number(row?.total ?? 0),
      futureActiveAppointments: Number(row?.future ?? 0),
    };
  }

  /** El prefijo del país del negocio, deducido de su zona horaria. */
  private async dialCodeFor(tenantId: string): Promise<string> {
    const tenant = await this.tenantRepository.findOne({
      where: { id: tenantId },
      select: { id: true, timezone: true },
    });

    return dialCodeForTimeZone(tenant?.timezone);
  }
}
