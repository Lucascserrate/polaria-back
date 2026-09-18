import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { StaffJoinRequest } from './entities/staff-join-request.entity';
import { StaffService } from '../staff/staff.service';
import { TenantsService } from '../tenants/tenants.service';
import { isDuplicateEntryError } from '../database/duplicate-entry.util';

/**
 * Cuántas letras hacen falta para buscar.
 *
 * Tres, y no es rendimiento: este es el único lugar donde una cuenta cualquiera
 * puede preguntar qué negocios existen en Polaria. Con una letra la respuesta se
 * parece demasiado al padrón entero.
 */
const MIN_QUERY_LENGTH = 3;

/** Tope de resultados. Quien busca ya sabe cómo se llama su trabajo. */
const SEARCH_LIMIT = 8;

/**
 * Cuántos pedidos pendientes puede tener una misma cuenta a la vez.
 *
 * El índice único ya impide repetir el pedido al **mismo** negocio; esto acota
 * el otro abuso, que es pedirle a treinta. Cinco alcanza para quien se equivocó
 * de local dos veces y no para quien está tocando puertas.
 */
const MAX_PENDING_PER_ACCOUNT = 5;

/** Un negocio en el buscador de alta: lo justo para reconocerlo. */
export interface JoinableBusiness {
  id: string;
  name: string;
  /** Quién lo tiene, para distinguir dos negocios con el mismo nombre. */
  ownerName: string | null;
  logoUrl: string | null;
}

/** Un pedido tal como lo ve el negocio que tiene que resolverlo. */
export interface JoinRequestView {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
}

/**
 * Pedidos de acceso: el camino de quien ya trabaja en un negocio que usa
 * Polaria y todavía no tiene ficha.
 *
 * Existe por el incidente que hizo que el login deje de crear negocios: el
 * empleado se quedaba sin salida, y la salida no puede ser que Polaria le abra
 * una barbería. Ahora busca su trabajo y pide entrar.
 *
 * Nada de esto da acceso solo. Aprobar es una acción del negocio, y sin eso el
 * pedido no es más que un renglón: si alcanzara con pedirlo, cualquiera con una
 * cuenta de Google entraría al panel de cualquier negocio.
 */
@Injectable()
export class StaffJoinRequestsService {
  private readonly logger = new Logger(StaffJoinRequestsService.name);

  constructor(
    @InjectRepository(StaffJoinRequest)
    private readonly requestRepository: Repository<StaffJoinRequest>,
    private readonly tenantsService: TenantsService,
    private readonly staffService: StaffService,
  ) {}

  /**
   * Los negocios que coinciden con lo que se escribió.
   *
   * Devuelve una forma recortada a mano y no la entidad: acá el que pregunta es
   * un desconocido, así que lo que sale es el mínimo para reconocer el local
   * —nombre, logo y de quién es— y nada de teléfono, dirección ni correo.
   */
  async search(query: string): Promise<JoinableBusiness[]> {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) return [];

    const tenants = await this.tenantsService.searchJoinable(
      trimmed,
      SEARCH_LIMIT,
    );

    return tenants.map((tenant) => ({
      id: tenant.id,
      name: tenant.name,
      ownerName: shortOwnerName(tenant.name, tenant.email),
      logoUrl: tenant.logoUrl,
    }));
  }

  /**
   * Pide acceso a un negocio.
   *
   * Se rechaza si esa cuenta ya tiene ficha en ese negocio: ahí no hay nada que
   * pedir, hay que entrar. Es el caso de quien pide dos veces porque la primera
   * no entendió que ya lo habían agregado.
   */
  async request(input: {
    tenantId: string;
    googleId: string;
    email: string | null;
    name: string | null;
  }): Promise<{ id: string }> {
    if (!input.email) {
      throw new BadRequestException(
        'Tu cuenta de Google no informó un correo, y el negocio necesita uno para darte acceso.',
      );
    }

    const tenant = await this.tenantsService.findOne(input.tenantId);
    if (!tenant) throw new NotFoundException('El negocio no existe.');

    const already = await this.staffService.findByGoogleAccount({
      googleId: input.googleId,
      email: input.email,
    });
    if (already) {
      throw new ConflictException(
        'Ya tenés acceso a un negocio con esta cuenta. Volvé a entrar con Google.',
      );
    }

    const pending = await this.requestRepository.count({
      where: { googleId: input.googleId, status: 'pending' },
    });
    if (pending >= MAX_PENDING_PER_ACCOUNT) {
      throw new ConflictException(
        'Tenés varios pedidos esperando respuesta. Esperá a que alguno se resuelva.',
      );
    }

    try {
      const saved = await this.requestRepository.save(
        this.requestRepository.create({
          tenantId: input.tenantId,
          googleId: input.googleId,
          email: input.email,
          name: input.name,
          status: 'pending',
        }),
      );

      this.logger.log(
        `Pedido de acceso creado tenantId=${input.tenantId} email=${input.email}`,
      );

      return { id: saved.id };
    } catch (error: unknown) {
      /*
       * El índice único `(tenantId, googleId, status)` ya rechazó un pedido
       * repetido. No es un error para quien lo hizo: es que ya está pedido, que
       * es exactamente lo que quería.
       */
      if (!isDuplicateEntryError(error)) throw error;

      const existing = await this.requestRepository.findOne({
        where: {
          tenantId: input.tenantId,
          googleId: input.googleId,
          status: 'pending',
        },
      });

      if (!existing) throw error;
      return { id: existing.id };
    }
  }

  /** Los pedidos pendientes de una cuenta, para la pantalla de espera. */
  async pendingForAccount(
    googleId: string,
  ): Promise<Array<{ id: string; businessName: string; createdAt: string }>> {
    const requests = await this.requestRepository.find({
      where: { googleId, status: 'pending' },
      relations: { tenant: true },
      order: { createdAt: 'DESC' },
    });

    return requests.map((request) => ({
      id: request.id,
      businessName: request.tenant?.name ?? 'El negocio',
      createdAt: request.createdAt.toISOString(),
    }));
  }

  /** Los pedidos que este negocio tiene sin resolver. */
  async pendingForTenant(tenantId: string): Promise<JoinRequestView[]> {
    const requests = await this.requestRepository.find({
      where: { tenantId, status: 'pending' },
      order: { createdAt: 'ASC' },
    });

    return requests.map((request) => ({
      id: request.id,
      email: request.email,
      name: request.name,
      createdAt: request.createdAt.toISOString(),
    }));
  }

  /**
   * Aprobar: crear la ficha del equipo y darle el acceso.
   *
   * Reusa `create` y `grantAccess` en lugar de escribir la fila a mano, y no es
   * comodidad: `grantAccess` es quien sabe rechazar un correo que ya pertenece a
   * otra cuenta —el choque que causó el incidente— y quien desvincula la cuenta
   * de Google si el correo cambia. Un `INSERT` propio acá sería una segunda
   * versión de esas reglas.
   *
   * Nace **sin** atender clientes: alta como persona del equipo y nada más. Que
   * tome turnos, con qué servicios y con qué horario lo decide el negocio en su
   * ficha, que es donde ya se decide para todos los demás.
   */
  async approve(tenantId: string, id: string): Promise<{ staffId: string }> {
    const request = await this.requestRepository.findOne({
      where: { id, tenantId, status: 'pending' },
    });

    // Filtrado por `tenantId`: sin eso, el id de un pedido de otro negocio
    // alcanzaría para aprobarlo desde acá.
    if (!request) throw new NotFoundException('El pedido no existe.');

    const staff = await this.staffService.create({
      tenantId,
      firstName: request.name?.trim() || request.email,
      providesServices: false,
    });

    await this.staffService.grantAccess(staff.id, request.email);

    request.status = 'approved';
    request.resolvedAt = new Date();
    await this.requestRepository.save(request);

    this.logger.log(
      `Pedido aprobado tenantId=${tenantId} email=${request.email} staffId=${staff.id}`,
    );

    return { staffId: staff.id };
  }

  async reject(tenantId: string, id: string): Promise<{ id: string }> {
    const request = await this.requestRepository.findOne({
      where: { id, tenantId, status: 'pending' },
    });

    if (!request) throw new NotFoundException('El pedido no existe.');

    request.status = 'rejected';
    request.resolvedAt = new Date();
    await this.requestRepository.save(request);

    this.logger.log(
      `Pedido rechazado tenantId=${tenantId} email=${request.email}`,
    );

    return { id: request.id };
  }
}

/**
 * De quién es el negocio, en la forma corta.
 *
 * Nombre y la inicial del apellido —"Juan G."— y no el nombre completo ni el
 * correo: alcanza para distinguir dos locales que se llaman parecido, que es
 * para lo que está, y no entrega el dato de contacto de nadie a quien esté
 * navegando el buscador.
 *
 * Sale del nombre del negocio cuando no hay otro dato, porque una cuenta recién
 * registrada se llama como la persona que la creó. Si el negocio ya tiene nombre
 * propio, no hay de quién hablar y se devuelve `null` en lugar de inventarlo.
 */
const shortOwnerName = (
  businessName: string,
  email: string | null,
): string | null => {
  if (!email) return null;

  const [first, second] = businessName.trim().split(/\s+/);
  if (!first) return null;

  return second ? `${first} ${second.charAt(0).toUpperCase()}.` : first;
};
