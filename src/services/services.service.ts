import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Service } from './entities/service.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { DEFAULT_CURRENCY } from '../tenants/currency';
import { isSelfBookable } from './booking-policy';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

@Injectable()
export class ServicesService {
  constructor(
    @InjectRepository(Service)
    private serviceRepository: Repository<Service>,
    /*
     * Sólo para leer la moneda por defecto del negocio. Va el repositorio y no
     * `TenantsService` porque tenants ya depende de servicios en otras ramas, y
     * un módulo no debería importar al otro para resolver un valor por defecto.
     */
    @InjectRepository(Tenant)
    private tenantRepository: Repository<Tenant>,
  ) {}

  async create(createServiceDto: CreateServiceDto): Promise<Service> {
    const service = this.serviceRepository.create({
      ...createServiceDto,
      // La moneda del negocio es el valor por defecto de un servicio nuevo, no
      // la moneda de todos: quien cobra en dos monedas la cambia en este mismo
      // formulario, servicio por servicio.
      currency:
        createServiceDto.currency ??
        (await this.defaultCurrency(createServiceDto.tenantId)),
    });
    return this.serviceRepository.save(service);
  }

  /**
   * La moneda con la que nace un servicio si nadie eligió otra.
   *
   * Sale del negocio, donde se dedujo de la zona horaria al registrarse. Un
   * negocio que no aparezca —no debería, el alta valida el dueño— cae al mismo
   * valor por defecto que la columna, que es preferible a un precio sin unidad.
   */
  private async defaultCurrency(tenantId?: string): Promise<string> {
    if (!tenantId) return DEFAULT_CURRENCY;

    const tenant = await this.tenantRepository.findOne({
      where: { id: tenantId },
      select: { currency: true },
    });

    return tenant?.currency ?? DEFAULT_CURRENCY;
  }

  /**
   * Todo el catálogo vigente del negocio.
   *
   * Incluye los que el cliente **no** puede reservar solo, y eso es a propósito:
   * esta lista contesta "qué ofrece el negocio", que es lo que necesitan el
   * asistente —para poder explicar por qué una ortodoncia no se agenda sola en
   * lugar de contestar que no la ofrecen—, el onboarding y la página pública.
   *
   * Para "qué puede elegir el cliente", que es otra pregunta, está
   * `findSelfBookableByTenant`.
   */
  findActiveByTenant(tenantId: string): Promise<Service[]> {
    return this.serviceRepository.find({
      where: { tenantId, isActive: true },
      order: { name: 'ASC' },
    });
  }

  /**
   * De un grupo de negocios, cuáles ofrecen algo hoy.
   *
   * Lo usa el buscador para no listar cuentas a medio configurar: un negocio
   * sin servicios activos tiene página pública, pero es una página donde no hay
   * nada que reservar.
   *
   * Una consulta para todos y no una por negocio: la alternativa es pedir la
   * carta completa de cada uno para terminar preguntando si está vacía. Y
   * siempre acotada por `tenantIds` —nunca un `DISTINCT` sobre la tabla
   * entera—, que es lo que la mantiene barata cuando el listado crezca.
   */
  async tenantIdsWithActiveServices(tenantIds: string[]): Promise<Set<string>> {
    if (tenantIds.length === 0) return new Set();

    const rows = await this.serviceRepository
      .createQueryBuilder('service')
      .select('DISTINCT service.tenantId', 'tenantId')
      .where('service.tenantId IN (:...tenantIds)', { tenantIds })
      .andWhere('service.isActive = :isActive', { isActive: true })
      .getRawMany<{ tenantId: string }>();

    return new Set(rows.map((row) => row.tenantId));
  }

  /**
   * Los servicios que un cliente puede elegir por su cuenta.
   *
   * Es el listado de los canales donde reserva el cliente: el flujo de WhatsApp y
   * el Flow. Filtra en memoria y no en el `WHERE` para que la regla la decida
   * `isSelfBookable` en un solo lugar —incluido el criterio de qué hacer con una
   * fila cuyo valor no reconocemos— y no quede escrita dos veces, una en SQL y
   * otra en TypeScript.
   *
   * Esconderlos de acá es la comodidad; la regla es el rechazo al confirmar, que
   * vive en cada canal junto al chequeo de `isActive`.
   */
  async findSelfBookableByTenant(tenantId: string): Promise<Service[]> {
    const services = await this.findActiveByTenant(tenantId);
    return services.filter((service) => isSelfBookable(service.bookingPolicy));
  }

  findOneByTenant(id: string, tenantId: string): Promise<Service | null> {
    return this.serviceRepository.findOne({
      where: { id, tenantId },
    });
  }

  async updateByTenant(
    id: string,
    tenantId: string,
    updateServiceDto: UpdateServiceDto,
  ) {
    await this.serviceRepository.update({ id, tenantId }, updateServiceDto);
    return this.findOneByTenant(id, tenantId);
  }

  async removeByTenant(id: string, tenantId: string) {
    await this.serviceRepository.update({ id, tenantId }, { isActive: false });
    return this.findOneByTenant(id, tenantId);
  }
}
