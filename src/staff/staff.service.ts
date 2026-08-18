import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';

import { Staff } from './entities/staff.entity';
import { StaffSchedule } from './entities/staff_schedule.entity';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { StaffScheduleDto } from './dto/staff-schedule.dto';
import { assertValidStaffSchedules } from './utils/staff-schedule.util';
import { Service } from '../services/entities/service.entity';
import { normalizePhoneNumber } from '../webhook/webhook-meta.util';

/**
 * Deja el teléfono como lo espera la API de Meta: solo `+` y dígitos.
 *
 * Se normaliza al guardar y no al enviar para que la columna tenga una sola
 * forma posible; si no, el mismo número cargado como `+591 700-00000` y como
 * `+59170000000` conviviría en la tabla y habría que limpiarlo en cada uso.
 *
 * Los tres valores de retorno son tres intenciones distintas: `undefined` es
 * "no se tocó el campo" —lo que `merge` ignora—, `null` es "borrarlo" y el
 * string es el número nuevo.
 */
function normalizeStaffPhone(
  phone: string | undefined,
): string | null | undefined {
  if (phone === undefined) return undefined;
  return normalizePhoneNumber(phone.trim()) || null;
}

@Injectable()
export class StaffService {
  constructor(
    @InjectRepository(Staff)
    private staffRepository: Repository<Staff>,
    @InjectRepository(Service)
    private serviceRepository: Repository<Service>,
  ) {}

  async create(createStaffDto: CreateStaffDto): Promise<Staff> {
    const { serviceIds, schedules, ...rest } = createStaffDto;

    assertValidStaffSchedules({
      usesCustomSchedule: rest.usesCustomSchedule ?? false,
      schedules: schedules ?? [],
    });

    const staff = this.staffRepository.create({
      ...rest,
      phone: normalizeStaffPhone(rest.phone),
    });

    if (Array.isArray(serviceIds) && serviceIds.length) {
      staff.services = await this.resolveServices(serviceIds, staff.tenantId);
    }

    return this.staffRepository.manager.transaction(async (manager) => {
      const saved = await manager.save(Staff, staff);
      saved.schedules = await this.replaceSchedules(
        manager,
        saved.id,
        schedules,
      );
      return saved;
    });
  }

  findAll(): Promise<Staff[]> {
    return this.staffRepository.find({
      relations: { services: true, schedules: true },
    });
  }

  findOne(id: string): Promise<Staff | null> {
    return this.staffRepository.findOne({
      where: { id },
      relations: { services: true, schedules: true },
    });
  }

  findByTenant(tenantId: string): Promise<Staff[]> {
    return this.staffRepository
      .createQueryBuilder('staff')
      .leftJoinAndSelect('staff.services', 'service')
      .leftJoinAndSelect('staff.schedules', 'schedule')
      .where('staff.tenantId = :tenantId', { tenantId })
      .orderBy('staff.name', 'ASC')
      .addOrderBy('schedule.dayOfWeek', 'ASC')
      .addOrderBy('schedule.startTime', 'ASC')
      .getMany();
  }

  async update(id: string, updateStaffDto: UpdateStaffDto) {
    const staff = await this.staffRepository.findOne({
      where: { id },
      relations: { services: true, schedules: true },
    });
    if (!staff) return null;

    const { serviceIds, schedules, ...rest } = updateStaffDto;

    // Se valida el estado resultante, no el payload: encender el flag sin
    // mandar franjas y vaciar las franjas con el flag ya encendido terminan en
    // el mismo lugar, y los dos dejarían al profesional fuera de la agenda.
    assertValidStaffSchedules({
      usesCustomSchedule: rest.usesCustomSchedule ?? staff.usesCustomSchedule,
      schedules: schedules ?? staff.schedules ?? [],
    });

    // `merge` saltea las columnas en `undefined`, así que mandar el teléfono
    // sin normalizar no pisaría nada cuando el patch no lo trae.
    this.staffRepository.merge(staff, {
      ...rest,
      phone: normalizeStaffPhone(rest.phone),
    });

    if (Array.isArray(serviceIds)) {
      staff.services = serviceIds.length
        ? await this.resolveServices(serviceIds, staff.tenantId)
        : [];
    }

    // El flag y las franjas viajan juntos: guardarlos por separado abriría una
    // ventana con la jornada propia encendida y sin franjas, que la
    // disponibilidad lee como "no trabaja ningún día".
    await this.staffRepository.manager.transaction(async (manager) => {
      await manager.save(Staff, staff);
      await this.replaceSchedules(manager, id, schedules);
    });

    return this.findOne(id);
  }

  /**
   * Baja lógica. Ver `Staff.deletedAt`: un `delete()` físico arrastraría en
   * cascada los segmentos de sus citas y borraría el historial del negocio.
   */
  async remove(id: string) {
    await this.staffRepository.softDelete(id);
    return { deleted: true };
  }

  /**
   * Reemplaza la jornada completa. `undefined` significa "no se tocó"; un array
   * vacío significa "borrar todas", que solo es válido con el flag apagado.
   */
  private async replaceSchedules(
    manager: EntityManager,
    staffId: string,
    schedules: StaffScheduleDto[] | undefined,
  ): Promise<StaffSchedule[]> {
    if (!Array.isArray(schedules)) return [];

    await manager.delete(StaffSchedule, { staffId });

    if (!schedules.length) return [];

    return manager.save(
      StaffSchedule,
      schedules.map((schedule) =>
        manager.create(StaffSchedule, { staffId, ...schedule }),
      ),
    );
  }

  private async resolveServices(
    serviceIds: string[],
    tenantId: string,
  ): Promise<Service[]> {
    const services = await this.serviceRepository.find({
      where: { id: In(serviceIds), tenantId },
      order: { name: 'ASC' },
    });

    if (services.length !== serviceIds.length) {
      throw new BadRequestException(
        'One or more services are invalid for this tenant',
      );
    }

    return services;
  }
}
