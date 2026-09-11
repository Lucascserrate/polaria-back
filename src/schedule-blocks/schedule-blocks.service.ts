import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { ScheduleBlock } from './entities/schedule-block.entity';
import { CreateScheduleBlockDto } from './dto/create-schedule-block.dto';
import { Staff } from '../staff/entities/staff.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import {
  daysInRange,
  parseCalendarDate,
  rangeWindow,
} from '../appointments/appointment-window';

const DEFAULT_TIMEZONE = 'America/La_Paz';

/**
 * El mismo tope que la agenda. No es una regla de negocio: es lo que evita que
 * un `from` y un `to` mal armados barran la tabla entera.
 */
const MAX_RANGE_DAYS = 62;

/** Un bloqueo tal como lo lee el panel. */
export interface ScheduleBlockItem {
  id: string;
  /** `null` = todo el negocio. */
  staffId: string | null;
  /** Para poder decir de quién es sin pedir el equipo aparte. */
  staffName: string | null;
  startTime: string;
  endTime: string;
  reason: string | null;
}

/**
 * Las franjas que el negocio marcó como no disponibles.
 *
 * Un bloqueo no toca las citas que ya existen: si se corta la luz a las 15:00 y
 * había tres turnos, el bloqueo dice que no se agenden más, no que esos tres
 * dejaron de existir. Cancelarlos es una decisión aparte, y de la agenda.
 */
@Injectable()
export class ScheduleBlocksService {
  constructor(
    @InjectRepository(ScheduleBlock)
    private readonly scheduleBlockRepository: Repository<ScheduleBlock>,
    @InjectRepository(Staff)
    private readonly staffRepository: Repository<Staff>,
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
  ) {}

  async create(
    tenantId: string,
    dto: CreateScheduleBlockDto,
  ): Promise<ScheduleBlockItem> {
    const startTime = new Date(dto.startTime);
    if (Number.isNaN(startTime.getTime())) {
      throw new BadRequestException('startTime inválido');
    }

    const staffId = dto.staffId ?? null;

    /*
     * El profesional se verifica contra **este** negocio. Sin esto, un id de
     * otro tenant entraría por la clave ajena sin protestar y dejaría un bloqueo
     * que nadie de este negocio puede ver ni borrar.
     *
     * Un profesional dado de baja tampoco vale: la baja lógica lo saca del
     * `find` por defecto, y bloquearle horas a alguien que ya no atiende no
     * significa nada.
     */
    if (staffId) {
      const staff = await this.staffRepository.findOne({
        where: { id: staffId, tenantId },
      });

      if (!staff) {
        throw new BadRequestException('El profesional no existe en el negocio');
      }
    }

    const reason = dto.reason?.trim() || null;

    const saved = await this.scheduleBlockRepository.save(
      this.scheduleBlockRepository.create({
        tenantId,
        staffId,
        startTime,
        endTime: new Date(startTime.getTime() + dto.durationMinutes * 60_000),
        reason,
      }),
    );

    /*
     * Se vuelve a leer para responder con el nombre del profesional. Es una
     * consulta más, y la alternativa —devolver lo guardado y que el panel busque
     * el nombre en la lista del equipo que ya tiene— haría que la respuesta de
     * crear tenga otra forma que la de listar.
     */
    return this.findOne(tenantId, saved.id);
  }

  /**
   * Los bloqueos que caen en un rango de días, con los dos extremos incluidos.
   *
   * El filtro es por **solapamiento** y no por inicio, que es lo que hace la
   * consulta de citas. La diferencia es deliberada: una cita nace de una jornada
   * que cierra antes de medianoche, así que no puede empezar un día y terminar
   * el siguiente, pero un bloqueo se carga a mano sobre cualquier hueco y
   * "23:00, dos horas" es perfectamente cargable. Filtrando por inicio, su cola
   * desaparecería de la semana siguiente.
   *
   * El solapamiento no es un OR: son dos condiciones que se cumplen a la vez,
   * así que el índice `(tenantId, startTime)` sigue resolviendo el recorte.
   *
   * `onlyStaffId` acota a lo que le tapa horas a una persona: sus bloqueos y los
   * del negocio entero. Eso sí es un OR, y por eso el `where` viaja como dos
   * ramas.
   */
  async findRange(
    tenantId: string,
    from: string,
    to: string,
    onlyStaffId?: string,
  ): Promise<{
    items: ScheduleBlockItem[];
    from: string;
    to: string;
    timezone: string;
  }> {
    const timezone = await this.timezoneOf(tenantId);
    const { startUtc, endUtc } = this.resolveRangeWindow(from, to, timezone);

    const overlapping = {
      tenantId,
      startTime: LessThan(endUtc),
      endTime: MoreThan(startUtc),
    };

    const blocks = await this.scheduleBlockRepository.find({
      where: onlyStaffId
        ? [
            { ...overlapping, staffId: onlyStaffId },
            { ...overlapping, staffId: IsNull() },
          ]
        : overlapping,
      relations: { staff: true },
      // Sin esto, el bloqueo de alguien dado de baja llegaría sin nombre y en la
      // vista por columnas no tendría dónde ir.
      withDeleted: true,
      order: { startTime: 'ASC' },
    });

    return { items: blocks.map(toScheduleBlockItem), from, to, timezone };
  }

  async findOne(tenantId: string, id: string): Promise<ScheduleBlockItem> {
    const block = await this.scheduleBlockRepository.findOne({
      where: { id, tenantId },
      relations: { staff: true },
      withDeleted: true,
    });

    if (!block) throw new NotFoundException('El bloqueo no existe');

    return toScheduleBlockItem(block);
  }

  /**
   * Borra un bloqueo.
   *
   * El `tenantId` va en el `where` y no en una verificación previa: es una sola
   * consulta y no hay ventana entre comprobar de quién es y borrarlo.
   */
  async remove(tenantId: string, id: string): Promise<{ id: string }> {
    const result = await this.scheduleBlockRepository.delete({ id, tenantId });

    if (!result.affected) throw new NotFoundException('El bloqueo no existe');

    return { id };
  }

  private async timezoneOf(tenantId: string): Promise<string> {
    const tenant = await this.tenantRepository.findOne({
      where: { id: tenantId },
    });

    return tenant?.timezone || DEFAULT_TIMEZONE;
  }

  private resolveRangeWindow(from: string, to: string, timezone: string) {
    const start = parseCalendarDate(from);
    const end = parseCalendarDate(to);

    if (!start) {
      throw new BadRequestException(
        'from debe ser una fecha real con formato YYYY-MM-DD',
      );
    }
    if (!end) {
      throw new BadRequestException(
        'to debe ser una fecha real con formato YYYY-MM-DD',
      );
    }

    const days = daysInRange(start, end);
    if (days === 0) {
      throw new BadRequestException('to no puede ser anterior a from');
    }
    if (days > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `El rango no puede superar ${MAX_RANGE_DAYS} días`,
      );
    }

    return rangeWindow(timezone, start, end);
  }
}

const toScheduleBlockItem = (block: ScheduleBlock): ScheduleBlockItem => ({
  id: block.id,
  staffId: block.staffId,
  staffName: block.staff?.name ?? null,
  startTime: block.startTime.toISOString(),
  endTime: block.endTime.toISOString(),
  reason: block.reason,
});
