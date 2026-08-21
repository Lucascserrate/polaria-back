import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import {
  Appointment,
  AppointmentStatus,
  OPEN_APPOINTMENT_STATUSES,
} from '../appointments/entities/appointment.entity';
import { AppointmentService as AppointmentSegment } from '../appointments/entities/appointment_service.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { TenantError } from '../tenants/enums/tenant.enum';
import { ReportQueryDto } from './dto/report-query.dto';
import { ReportRange, resolveReportRange } from './utils/report-range.util';
import {
  ReportSummary,
  ServiceRankingEntry,
  StaffRankingEntry,
  TenantReport,
} from './reports.types';

const DEFAULT_TIMEZONE = 'America/La_Paz';

/** MySQL devuelve los `SUM`/`COUNT` y los `decimal` como string, o `null`. */
const toNumber = (value: string | number | null | undefined): number =>
  Number(value ?? 0);

/** Los montos se exponen ya redondeados: son plata, no promedios crudos. */
const toMoney = (value: number): number => Math.round(value * 100) / 100;

interface StatusCountRow {
  pending: string | null;
  confirmed: string | null;
  completed: string | null;
  cancelled: string | null;
}

interface StaffRankingRow {
  staffId: string;
  staffName: string;
  commissionRate: string | null;
  deletedAt: Date | null;
  completedAppointments: string;
  revenue: string | null;
}

interface ServiceRankingRow {
  serviceId: string;
  serviceName: string;
  timesPerformed: string;
  revenue: string | null;
}

/**
 * Métricas del negocio calculadas sobre las citas, que son la fuente de verdad.
 *
 * No hay tabla de historial: una cita completada ya guarda todo lo necesario
 * para reconstruir lo facturado, porque cada servicio prestado congela su precio
 * en `priceAtBooking` al momento de reservar. Cambiar la lista de precios hoy no
 * mueve los números de los meses anteriores.
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Appointment)
    private readonly appointmentRepository: Repository<Appointment>,
    @InjectRepository(AppointmentSegment)
    private readonly segmentRepository: Repository<AppointmentSegment>,
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
  ) {}

  async getReport(
    tenantId: string,
    query: ReportQueryDto,
  ): Promise<TenantReport> {
    const tenant = await this.tenantRepository.findOneBy({ id: tenantId });
    if (!tenant) {
      throw new NotFoundException(TenantError.NOT_FOUND);
    }

    const timezone = tenant.timezone || DEFAULT_TIMEZONE;
    const range = resolveReportRange(query, timezone, new Date());

    const [summary, staffRanking, serviceRanking] = await Promise.all([
      this.getSummary(tenantId, range),
      this.getStaffRanking(tenantId, range),
      this.getServiceRanking(tenantId, range),
    ]);

    return {
      range: {
        preset: query.preset ?? 'today',
        from: range.from,
        to: range.to,
        timezone,
      },
      currency: tenant.currency,
      summary,
      staffRanking,
      serviceRanking,
    };
  }

  /**
   * Citas del negocio dentro del período, filtradas por `startTime`: lo que
   * importa es cuándo se prestó el servicio, no cuándo se cargó la reserva.
   */
  private appointmentsInRange(
    tenantId: string,
    range: ReportRange,
  ): SelectQueryBuilder<Appointment> {
    return this.appointmentRepository
      .createQueryBuilder('appointment')
      .where('appointment.tenantId = :tenantId', { tenantId })
      .andWhere('appointment.startTime >= :startUtc', {
        startUtc: range.startUtc,
      })
      .andWhere('appointment.startTime < :endUtc', { endUtc: range.endUtc });
  }

  /**
   * Servicios efectivamente prestados y cobrados en el período: una fila por
   * servicio, con el precio congelado al reservar.
   *
   * El grano es el segmento y no la cita porque una misma cita puede repartirse
   * entre varios profesionales; agregando por cita no habría forma de atribuirle
   * a cada uno lo suyo.
   */
  private billedSegments(
    tenantId: string,
    range: ReportRange,
  ): SelectQueryBuilder<AppointmentSegment> {
    return this.segmentRepository
      .createQueryBuilder('segment')
      .innerJoin('segment.appointment', 'appointment')
      .where('appointment.tenantId = :tenantId', { tenantId })
      .andWhere('appointment.status = :status', {
        status: AppointmentStatus.COMPLETED,
      })
      .andWhere('appointment.startTime >= :startUtc', {
        startUtc: range.startUtc,
      })
      .andWhere('appointment.startTime < :endUtc', { endUtc: range.endUtc });
  }

  private async getSummary(
    tenantId: string,
    range: ReportRange,
  ): Promise<ReportSummary> {
    const [counts, revenueRow] = await Promise.all([
      this.appointmentsInRange(tenantId, range)
        .select(
          'SUM(CASE WHEN appointment.status = :pending THEN 1 ELSE 0 END)',
          'pending',
        )
        .addSelect(
          'SUM(CASE WHEN appointment.status = :confirmed THEN 1 ELSE 0 END)',
          'confirmed',
        )
        .addSelect(
          'SUM(CASE WHEN appointment.status = :completed THEN 1 ELSE 0 END)',
          'completed',
        )
        .addSelect(
          'SUM(CASE WHEN appointment.status = :cancelled THEN 1 ELSE 0 END)',
          'cancelled',
        )
        .setParameters({
          pending: AppointmentStatus.PENDING,
          confirmed: AppointmentStatus.CONFIRMED,
          completed: AppointmentStatus.COMPLETED,
          cancelled: AppointmentStatus.CANCELLED,
        })
        .getRawOne<StatusCountRow>(),

      this.billedSegments(tenantId, range)
        .select('SUM(segment.priceAtBooking)', 'revenue')
        .getRawOne<{ revenue: string | null }>(),
    ]);

    const byStatus: Record<AppointmentStatus, number> = {
      [AppointmentStatus.PENDING]: toNumber(counts?.pending),
      [AppointmentStatus.CONFIRMED]: toNumber(counts?.confirmed),
      [AppointmentStatus.COMPLETED]: toNumber(counts?.completed),
      [AppointmentStatus.CANCELLED]: toNumber(counts?.cancelled),
    };

    const revenueTotal = toNumber(revenueRow?.revenue);
    const completedCount = byStatus[AppointmentStatus.COMPLETED];

    return {
      revenueTotal: toMoney(revenueTotal),
      completedCount,
      cancelledCount: byStatus[AppointmentStatus.CANCELLED],
      pendingCount: OPEN_APPOINTMENT_STATUSES.reduce(
        (sum, status) => sum + byStatus[status],
        0,
      ),
      averageTicket: completedCount
        ? toMoney(revenueTotal / completedCount)
        : 0,
      byStatus,
    };
  }

  private async getStaffRanking(
    tenantId: string,
    range: ReportRange,
  ): Promise<StaffRankingEntry[]> {
    const rows = await this.billedSegments(tenantId, range)
      .innerJoin('segment.staff', 'staff')
      // El profesional dado de baja siguió facturando mientras trabajó: sin esto
      // su parte del período desaparecería del ranking.
      .withDeleted()
      .select('staff.id', 'staffId')
      .addSelect('staff.name', 'staffName')
      .addSelect('staff.commissionRate', 'commissionRate')
      .addSelect('staff.deletedAt', 'deletedAt')
      // DISTINCT porque una cita con dos servicios del mismo profesional es una
      // sola cita atendida, aunque sean dos segmentos.
      .addSelect('COUNT(DISTINCT appointment.id)', 'completedAppointments')
      .addSelect('SUM(segment.priceAtBooking)', 'revenue')
      .groupBy('staff.id')
      .addGroupBy('staff.name')
      .addGroupBy('staff.commissionRate')
      .addGroupBy('staff.deletedAt')
      .orderBy('revenue', 'DESC')
      .getRawMany<StaffRankingRow>();

    return rows.map((row) => {
      const revenue = toNumber(row.revenue);
      const commissionRate =
        row.commissionRate === null ? null : Number(row.commissionRate);

      return {
        staffId: row.staffId,
        staffName: row.staffName,
        completedAppointments: toNumber(row.completedAppointments),
        revenue: toMoney(revenue),
        commissionRate,
        estimatedCommission:
          commissionRate === null
            ? null
            : toMoney((revenue * commissionRate) / 100),
        isFormer: row.deletedAt !== null,
      };
    });
  }

  private async getServiceRanking(
    tenantId: string,
    range: ReportRange,
  ): Promise<ServiceRankingEntry[]> {
    const rows = await this.billedSegments(tenantId, range)
      .innerJoin('segment.service', 'service')
      .select('service.id', 'serviceId')
      .addSelect('service.name', 'serviceName')
      .addSelect('COUNT(*)', 'timesPerformed')
      .addSelect('SUM(segment.priceAtBooking)', 'revenue')
      .groupBy('service.id')
      .addGroupBy('service.name')
      .orderBy('revenue', 'DESC')
      .getRawMany<ServiceRankingRow>();

    return rows.map((row) => ({
      serviceId: row.serviceId,
      serviceName: row.serviceName,
      timesPerformed: toNumber(row.timesPerformed),
      revenue: toMoney(toNumber(row.revenue)),
    }));
  }
}
