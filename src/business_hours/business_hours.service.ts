import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BusinessHour } from './entities/business_hour.entity';
import { CreateBusinessHourDto } from './dto/create-business_hour.dto';
import { UpdateBusinessHourDto } from './dto/update-business_hour.dto';
import {
  assertValidWeeklySchedule,
  type WeeklyScheduleRange,
} from '../schedule/weekly-schedule.util';

/** MySQL devuelve las columnas `time` como `HH:MM:SS`; afuera se usa `HH:MM`. */
const normalizeTime = (value: string): string => {
  if (!value) return '00:00';
  return value.length >= 5 ? value.slice(0, 5) : value;
};

const byDayThenStart = (a: WeeklyScheduleRange, b: WeeklyScheduleRange) =>
  a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime);

@Injectable()
export class BusinessHoursService {
  constructor(
    @InjectRepository(BusinessHour)
    private businessHourRepository: Repository<BusinessHour>,
  ) {}

  create(createBusinessHourDto: CreateBusinessHourDto): Promise<BusinessHour> {
    const businessHour = this.businessHourRepository.create(
      createBusinessHourDto,
    );
    return this.businessHourRepository.save(businessHour);
  }

  findAll(): Promise<BusinessHour[]> {
    return this.businessHourRepository.find();
  }

  findOne(id: string): Promise<BusinessHour | null> {
    return this.businessHourRepository.findOneBy({ id });
  }

  findByTenant(tenantId: string): Promise<BusinessHour[]> {
    return this.businessHourRepository.find({
      where: { tenantId },
      order: { dayOfWeek: 'ASC', startTime: 'ASC' },
    });
  }

  /**
   * El horario del negocio tal como se edita: una franja por fila, con el día
   * adentro. Un día sin franjas es un día cerrado, la misma convención que usa
   * `staff_schedules`.
   */
  async getTenantSchedule(tenantId: string): Promise<WeeklyScheduleRange[]> {
    const businessHours = await this.findByTenant(tenantId);

    return businessHours
      .map((hour) => ({
        dayOfWeek: hour.dayOfWeek,
        startTime: normalizeTime(hour.startTime),
        endTime: normalizeTime(hour.endTime),
      }))
      .sort(byDayThenStart);
  }

  /**
   * Reemplaza la semana completa.
   *
   * Es un reemplazo y no un merge porque la pantalla edita la jornada entera:
   * un día que dejó de venir es un día que el negocio cerró, y no hay forma de
   * expresar eso con altas y bajas parciales.
   *
   * Va en una transacción porque el estado intermedio —las filas viejas ya
   * borradas y las nuevas todavía no— es un negocio cerrado toda la semana, y
   * cualquier reserva que consulte disponibilidad en esa ventana no encontraría
   * un solo turno.
   */
  async replaceTenantSchedule(
    tenantId: string,
    ranges: WeeklyScheduleRange[],
  ): Promise<WeeklyScheduleRange[]> {
    // Sin esto, destildar todos los días deja al negocio sin un solo turno
    // disponible y sin ninguna señal de por qué. Cerrar por vacaciones es otra
    // cosa: son excepciones por fecha, no el horario semanal.
    if (ranges.length === 0) {
      throw new BadRequestException(
        'El negocio necesita al menos un día con horario de atención.',
      );
    }

    assertValidWeeklySchedule(ranges);

    await this.businessHourRepository.manager.transaction(async (manager) => {
      await manager.delete(BusinessHour, { tenantId });
      await manager.save(
        BusinessHour,
        ranges.map((range) =>
          manager.create(BusinessHour, {
            tenantId,
            dayOfWeek: range.dayOfWeek,
            startTime: normalizeTime(range.startTime),
            endTime: normalizeTime(range.endTime),
          }),
        ),
      );
    });

    return this.getTenantSchedule(tenantId);
  }

  async update(id: string, updateBusinessHourDto: UpdateBusinessHourDto) {
    await this.businessHourRepository.update(id, updateBusinessHourDto);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.businessHourRepository.delete(id);
    return { deleted: true };
  }
}
