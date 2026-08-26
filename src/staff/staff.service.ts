import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';

import { Staff } from './entities/staff.entity';
import { StaffSchedule } from './entities/staff_schedule.entity';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { WeeklyRangeDto } from '../schedule/weekly-range.dto';
import { assertValidStaffSchedules } from './utils/staff-schedule.util';
import { displayNameOf } from './utils/display-name';
import { Service } from '../services/entities/service.entity';
import {
  Appointment,
  BLOCKING_APPOINTMENT_STATUSES,
} from '../appointments/entities/appointment.entity';
import { AppointmentService as AppointmentSegment } from '../appointments/entities/appointment_service.entity';
import {
  resolveStaffDeletion,
  type StaffDeletionCounts,
} from './utils/staff-deletion.util';
import { normalizePhoneNumber } from '../webhook/webhook-meta.util';
import { normalizeAccessEmail } from './staff-access';
import { Tenant } from '../tenants/entities/tenant.entity';
import { isDuplicateEntryError } from '../database/duplicate-entry.util';

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

/**
 * Un profesional con lo necesario para anticipar el efecto de eliminarlo.
 *
 * El panel lo usa para decir de antemano si la eliminación va a ser definitiva o
 * una baja que conserva el historial, en lugar de contarlo después de hecha.
 */
export type StaffWithHistory = Staff & {
  appointmentCount: number;
  futureAppointmentCount: number;
};

@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(
    @InjectRepository(Staff)
    private staffRepository: Repository<Staff>,
    @InjectRepository(Service)
    private serviceRepository: Repository<Service>,
    @InjectRepository(Tenant)
    private tenantRepository: Repository<Tenant>,
  ) {}

  /**
   * Habilita el acceso de un miembro del equipo con un correo.
   *
   * Se comprueba contra `tenants.email` además del propio equipo, y esa es la
   * comprobación que importa: si el correo de un dueño se pudiera invitar como
   * miembro, el login tendría dos respuestas válidas para la misma cuenta de
   * Google —el negocio y la ficha— y elegiría una de las dos según el orden de las
   * consultas. Es la clase de ambigüedad que después se manifiesta como "a veces
   * entro y veo otra cosa".
   *
   * Los choques dentro del equipo los ataja el índice único, pero se consultan
   * primero para poder responder de quién es el correo en lugar de un error de
   * base de datos.
   */
  async grantAccess(id: string, email: string): Promise<Staff | null> {
    const accessEmail = normalizeAccessEmail(email);

    const staff = await this.staffRepository.findOne({ where: { id } });
    if (!staff) return null;

    const owner = await this.tenantRepository.findOne({
      where: { email: accessEmail },
    });
    if (owner) {
      throw new ConflictException(
        'Ese correo ya es de una cuenta de Polaria. Usá otro para este miembro del equipo.',
      );
    }

    const taken = await this.staffRepository.findOne({
      where: { accessEmail },
    });
    if (taken && taken.id !== id) {
      throw new ConflictException(
        'Ese correo ya tiene acceso a Polaria con otra ficha.',
      );
    }

    /*
     * Cambiar el correo desvincula la cuenta de Google.
     *
     * Si no, corregir el correo dejaría a la persona entrando con la cuenta
     * anterior: lo que autentica es `accessGoogleId`, y el correo nuevo no sería
     * más que decoración. Al borrarlo, la invitación vuelve a estar pendiente y se
     * revincula con la cuenta que efectivamente entre.
     */
    if (staff.accessEmail !== accessEmail) {
      staff.accessGoogleId = null;
    }

    staff.accessEmail = accessEmail;
    staff.accessGrantedAt = staff.accessGrantedAt ?? new Date();

    try {
      await this.staffRepository.save(staff);
    } catch (error: unknown) {
      // El índice único cerró una carrera entre dos invitaciones al mismo correo.
      if (!isDuplicateEntryError(error)) throw error;
      throw new ConflictException(
        'Ese correo ya tiene acceso a Polaria con otra ficha.',
      );
    }

    this.logger.log(
      `Acceso habilitado (staffId=${id}, tenantId=${staff.tenantId}, role=${staff.accessRole}).`,
    );

    return this.findOne(id);
  }

  /**
   * Quita el acceso. La ficha y su historial quedan intactos.
   *
   * Se borran los dos campos y no solo el correo: dejar el `accessGoogleId` haría
   * que volver a invitar al mismo correo reviviera la sesión de una cuenta que ya
   * no debería entrar, sin que nadie lo pidiera.
   */
  async revokeAccess(id: string): Promise<Staff | null> {
    const staff = await this.staffRepository.findOne({ where: { id } });
    if (!staff) return null;

    staff.accessEmail = null;
    staff.accessGoogleId = null;
    staff.accessGrantedAt = null;
    await this.staffRepository.save(staff);

    this.logger.log(`Acceso revocado (staffId=${id}).`);
    return this.findOne(id);
  }

  /**
   * A quién le corresponde una cuenta de Google que está entrando.
   *
   * Primero por `accessGoogleId`, que es la vinculación ya hecha. Si no hay, por
   * correo: esa es la invitación pendiente, y entrar es lo que la acepta.
   *
   * Se exige que la ficha esté activa y sin baja lógica. Desactivar a alguien tiene
   * que cerrarle la puerta además de sacarlo de la agenda; si no, el negocio creería
   * que lo dio de baja y la persona seguiría entrando a ver sus números.
   */
  async findByGoogleAccount(params: {
    googleId: string;
    email?: string;
  }): Promise<Staff | null> {
    const linked = await this.staffRepository.findOne({
      where: { accessGoogleId: params.googleId, isActive: true },
    });
    if (linked) return linked;

    if (!params.email) return null;

    return this.staffRepository.findOne({
      where: {
        accessEmail: normalizeAccessEmail(params.email),
        isActive: true,
      },
    });
  }

  /** Vincula la cuenta al aceptar la invitación entrando por primera vez. */
  async linkGoogleAccount(id: string, googleId: string): Promise<void> {
    await this.staffRepository.update(id, { accessGoogleId: googleId });
    this.logger.log(`Invitación aceptada (staffId=${id}).`);
  }

  async create(createStaffDto: CreateStaffDto): Promise<Staff> {
    const { serviceIds, schedules, ...rest } = createStaffDto;

    assertValidStaffSchedules({
      usesCustomSchedule: rest.usesCustomSchedule ?? false,
      schedules: schedules ?? [],
    });

    const staff = this.staffRepository.create({
      ...rest,
      // `name` es una proyección, no un dato de entrada: ver `display-name.ts`.
      name: displayNameOf(rest),
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

  /**
   * El equipo, con lo que hace falta para saber qué pasaría al eliminar a cada
   * uno.
   *
   * Los conteos van en una consulta aparte y no como subconsulta de la anterior:
   * esa ya trae dos `leftJoinAndSelect`, y agregarle una agregación multiplicaría
   * filas o exigiría agrupar por todas las columnas.
   */
  async findByTenant(tenantId: string): Promise<StaffWithHistory[]> {
    const staff = await this.staffRepository
      .createQueryBuilder('staff')
      .leftJoinAndSelect('staff.services', 'service')
      .leftJoinAndSelect('staff.schedules', 'schedule')
      .where('staff.tenantId = :tenantId', { tenantId })
      .orderBy('staff.name', 'ASC')
      .addOrderBy('schedule.dayOfWeek', 'ASC')
      .addOrderBy('schedule.startTime', 'ASC')
      .getMany();

    const counts = await this.countHistoryByTenant(tenantId);

    return staff.map((member) => ({
      ...member,
      appointmentCount: counts.get(member.id)?.totalSegments ?? 0,
      futureAppointmentCount:
        counts.get(member.id)?.futureActiveAppointments ?? 0,
    }));
  }

  /** Segmentos y citas futuras por profesional, en una sola consulta agrupada. */
  private async countHistoryByTenant(
    tenantId: string,
  ): Promise<Map<string, StaffDeletionCounts>> {
    const rows = await this.staffRepository.manager
      .createQueryBuilder(AppointmentSegment, 'segment')
      .innerJoin(
        Appointment,
        'appointment',
        'appointment.id = segment.appointmentId',
      )
      .select('segment.staffId', 'staffId')
      .addSelect('COUNT(*)', 'total')
      .addSelect(
        `SUM(CASE WHEN appointment.status IN (:...activeStatuses) AND appointment.startTime >= :now THEN 1 ELSE 0 END)`,
        'future',
      )
      .where('appointment.tenantId = :tenantId', { tenantId })
      .setParameters({
        activeStatuses: [...BLOCKING_APPOINTMENT_STATUSES],
        now: new Date(),
      })
      .withDeleted()
      .groupBy('segment.staffId')
      .getRawMany<{ staffId: string; total: string; future: string | null }>();

    return new Map(
      rows.map((row) => [
        row.staffId,
        {
          totalSegments: Number(row.total ?? 0),
          futureActiveAppointments: Number(row.future ?? 0),
        },
      ]),
    );
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

    /*
     * El nombre para mostrar se recalcula sobre la entidad ya combinada y no
     * sobre el patch: un cambio de apellido llega sin el nombre, y derivarlo del
     * patch produciría "Serrate" a secas. Después de `merge`, la entidad tiene el
     * estado final de los dos campos.
     */
    staff.name = displayNameOf(staff);

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
   * Elimina un profesional, físicamente o dándolo de baja según su historial.
   *
   * La distinción no es cosmética. `appointment_services.staff` tiene
   * `onDelete: CASCADE`, y en esa tabla viven `priceAtBooking` y
   * `durationAtBooking`: un borrado físico de alguien con historial no le borra
   * "el profesional", le borra **los segmentos facturados de todas sus citas**.
   * Desaparece el dinero, no solo el nombre.
   *
   * Por eso solo se borra de verdad a quien nunca tuvo un segmento, que es el
   * caso del profesional cargado por error.
   */
  async remove(id: string): Promise<{ deleted: true; mode: 'HARD' | 'SOFT' }> {
    return this.staffRepository.manager.transaction(async (manager) => {
      // Se toma la fila para que dos eliminaciones simultáneas no decidan cada
      // una sobre el mismo profesional con la misma información.
      const staff = await manager.findOne(Staff, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!staff) {
        throw new BadRequestException('Staff not found');
      }

      const counts = await this.countDeletionRelevant(manager, id);
      const plan = resolveStaffDeletion(counts);

      if (plan.mode === 'BLOCKED') {
        throw new ConflictException({
          message:
            'El profesional tiene citas próximas. Reasignalas o cancelalas antes de eliminarlo.',
          futureAppointments: plan.futureAppointments,
        });
      }

      /*
       * Deja de ofrecerse antes de borrar nada.
       *
       * Con `deletedAt` alcanzaría para que la disponibilidad lo ignore, pero
       * escribir `isActive` explícitamente hace que, si alguna vez se restaura la
       * fila, el profesional vuelva inactivo y no directamente tomando reservas.
       */
      staff.isActive = false;
      await manager.save(Staff, staff);

      if (plan.mode === 'HARD') {
        const hardDeleted = await this.hardDelete(manager, id);
        if (hardDeleted) {
          this.logger.log(`Profesional eliminado (staffId=${id}).`);
          return { deleted: true, mode: 'HARD' };
        }

        // Apareció un segmento entre el conteo y el borrado. La condición del
        // `DELETE` lo detectó y ahora corresponde la baja lógica.
        this.logger.warn(
          `Profesional con historial recién creado, se da de baja (staffId=${id}).`,
        );
      }

      await manager.softDelete(Staff, id);
      this.logger.log(
        `Profesional dado de baja conservando historial (staffId=${id}, segmentos=${counts.totalSegments}).`,
      );
      return { deleted: true, mode: 'SOFT' };
    });
  }

  /**
   * Segmentos totales y citas futuras que todavía ocupan agenda.
   *
   * Una sola consulta agrupada: las dos preguntas se responden sobre el mismo
   * conjunto de filas.
   */
  private async countDeletionRelevant(
    manager: EntityManager,
    staffId: string,
  ): Promise<StaffDeletionCounts> {
    const row = await manager
      .createQueryBuilder(AppointmentSegment, 'segment')
      .innerJoin(
        Appointment,
        'appointment',
        'appointment.id = segment.appointmentId',
      )
      .select('COUNT(*)', 'total')
      .addSelect(
        `SUM(CASE WHEN appointment.status IN (:...activeStatuses) AND appointment.startTime >= :now THEN 1 ELSE 0 END)`,
        'future',
      )
      .where('segment.staffId = :staffId', { staffId })
      .setParameters({
        activeStatuses: [...BLOCKING_APPOINTMENT_STATUSES],
        now: new Date(),
      })
      // Sin esto, un segmento de una cita cuya fila fue borrada lógicamente
      // dejaría de contarse y habilitaría un borrado físico.
      .withDeleted()
      .getRawOne<{ total: string; future: string | null }>();

    return {
      totalSegments: Number(row?.total ?? 0),
      futureActiveAppointments: Number(row?.future ?? 0),
    };
  }

  /**
   * Borrado físico condicionado a que siga sin historial.
   *
   * El `NOT EXISTS` va dentro del `DELETE` y no en una comprobación previa: es
   * lo único que cierra la ventana entre contar cero segmentos y borrar. Si en
   * ese instante alguien reservó con este profesional, el borrado no afecta
   * ninguna fila y el llamador cae a la baja lógica —en lugar de que el
   * `CASCADE` se lleve un segmento recién creado sin dejar rastro.
   */
  private async hardDelete(
    manager: EntityManager,
    staffId: string,
  ): Promise<boolean> {
    // `query` devuelve `any`; el tipo describe lo que manda el driver de MySQL
    // para un DELETE.
    const result: { affectedRows?: number } = await manager.query(
      [
        'DELETE FROM staff',
        'WHERE id = ?',
        '  AND NOT EXISTS (',
        '    SELECT 1 FROM appointment_services WHERE staffId = ?',
        '  )',
      ].join(String.fromCharCode(10)),
      [staffId, staffId],
    );

    return (result.affectedRows ?? 0) === 1;
  }

  /**
   * Reemplaza la jornada completa. `undefined` significa "no se tocó"; un array
   * vacío significa "borrar todas", que solo es válido con el flag apagado.
   */
  private async replaceSchedules(
    manager: EntityManager,
    staffId: string,
    schedules: WeeklyRangeDto[] | undefined,
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
