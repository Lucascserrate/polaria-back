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
import { Staff } from '../staff/entities/staff.entity';
import {
  ReportRange,
  previousReportRange,
  resolveReportRange,
} from './utils/report-range.util';
import {
  estimateCommission,
  parseCommissionRate,
} from './utils/commission.util';
import { toMoney, toNumber } from './utils/report-numbers.util';
import {
  buildReportTimeline,
  type ReportTimeline,
} from './utils/report-timeline.util';
import {
  CurrencyEarnings,
  CurrencyRevenue,
  ReportSummary,
  ServiceRankingEntry,
  StaffRankingEntry,
  StaffReport,
  StaffSummary,
  TenantReport,
} from './reports.types';

const DEFAULT_TIMEZONE = 'America/La_Paz';

interface StatusCountRow {
  pending: string | null;
  confirmed: string | null;
  completed: string | null;
  cancelled: string | null;
}

/** Lo que devuelve el agregado de estados de un profesional. */
interface StaffCountRow {
  completed: string | null;
  cancelled: string | null;
  pending: string | null;
  clients: string | null;
}

interface StaffRankingRow {
  staffId: string;
  staffName: string;
  commissionRate: string | null;
  deletedAt: Date | null;
  completedAppointments: string;
  revenue: string | null;
  currency: string;
}

interface ServiceRankingRow {
  serviceId: string;
  serviceName: string;
  timesPerformed: string;
  revenue: string | null;
  currency: string;
}

/**
 * Lo facturado en una moneda: el agregado que devuelven todas las consultas de
 * plata desde que la moneda es del servicio y no del negocio.
 *
 * `appointments` son las citas **distintas** que tocaron esa moneda, y es el
 * divisor del promedio: dividir los dólares entre todas las citas del período
 * daría un promedio que no corresponde a nada.
 */
interface RevenueByCurrencyRow {
  currency: string;
  revenue: string | null;
  appointments: string | null;
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

    const [summary, timeline, staffRanking, serviceRanking] = await Promise.all(
      [
        this.getSummary(tenantId, range),
        this.getTimeline(tenantId, range, timezone),
        this.getStaffRanking(tenantId, range),
        this.getServiceRanking(tenantId, range),
      ],
    );

    return {
      range: {
        preset: query.preset ?? 'today',
        from: range.from,
        to: range.to,
        timezone,
      },
      currency: tenant.currency,
      summary,
      timeline,
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

  /**
   * Lo facturado en el período, una fila por moneda.
   *
   * Agrupa por `currencyAtBooking` —la congelada al reservar— y no por la moneda
   * que el servicio tiene hoy: cambiarle la moneda a un servicio no puede
   * reescribir lo que ya se cobró.
   */
  private revenueByCurrency(
    query: SelectQueryBuilder<AppointmentSegment>,
  ): Promise<RevenueByCurrencyRow[]> {
    return query
      .select('segment.currencyAtBooking', 'currency')
      .addSelect('SUM(segment.priceAtBooking)', 'revenue')
      .addSelect('COUNT(DISTINCT appointment.id)', 'appointments')
      .groupBy('segment.currencyAtBooking')
      .orderBy('revenue', 'DESC')
      .getRawMany<RevenueByCurrencyRow>();
  }

  /** Las filas crudas por moneda, ya con el promedio hecho. */
  private toCurrencyRevenue(rows: RevenueByCurrencyRow[]): CurrencyRevenue[] {
    return rows.map((row) => {
      const amount = toNumber(row.revenue);
      const appointments = toNumber(row.appointments);

      return {
        currency: row.currency,
        amount: toMoney(amount),
        averageTicket: appointments ? toMoney(amount / appointments) : 0,
      };
    });
  }

  /** Lo mismo, con la parte del profesional agregada a cada moneda. */
  private toCurrencyEarnings(
    rows: RevenueByCurrencyRow[],
    commissionRate: number | null,
  ): CurrencyEarnings[] {
    return this.toCurrencyRevenue(rows).map((entry) => ({
      ...entry,
      estimatedCommission: estimateCommission(entry.amount, commissionRate),
    }));
  }

  private async getSummary(
    tenantId: string,
    range: ReportRange,
  ): Promise<ReportSummary> {
    const [counts, revenueRows] = await Promise.all([
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

      this.revenueByCurrency(this.billedSegments(tenantId, range)),
    ]);

    const byStatus: Record<AppointmentStatus, number> = {
      [AppointmentStatus.PENDING]: toNumber(counts?.pending),
      [AppointmentStatus.CONFIRMED]: toNumber(counts?.confirmed),
      [AppointmentStatus.COMPLETED]: toNumber(counts?.completed),
      [AppointmentStatus.CANCELLED]: toNumber(counts?.cancelled),
    };

    return {
      revenue: this.toCurrencyRevenue(revenueRows),
      completedCount: byStatus[AppointmentStatus.COMPLETED],
      cancelledCount: byStatus[AppointmentStatus.CANCELLED],
      pendingCount: OPEN_APPOINTMENT_STATUSES.reduce(
        (sum, status) => sum + byStatus[status],
        0,
      ),
      byStatus,
    };
  }

  /**
   * La evolución de la facturación dentro del período.
   *
   * Trae las filas y agrupa en memoria en lugar de pedirle a MySQL un
   * `GROUP BY` por fecha. El día que interesa es el del negocio: agrupando por
   * fecha UTC, las citas de la tarde-noche caerían en el día siguiente, y
   * `CONVERT_TZ` exige las tablas de zonas cargadas. Son las mismas filas que ya
   * recorren los otros agregados, con dos columnas.
   */
  private async getTimeline(
    tenantId: string,
    range: ReportRange,
    timezone: string,
  ): Promise<ReportTimeline | null> {
    const rows = await this.billedSegments(tenantId, range)
      .select('appointment.id', 'appointmentId')
      .addSelect('appointment.startTime', 'startTime')
      .addSelect('segment.priceAtBooking', 'price')
      .addSelect('segment.currencyAtBooking', 'currency')
      .getRawMany<{
        appointmentId: string;
        startTime: Date | string;
        price: string | number;
        currency: string;
      }>();

    return buildReportTimeline({
      from: range.from,
      to: range.to,
      timezone,
      entries: rows.map((row) => ({
        appointmentId: row.appointmentId,
        startTime: new Date(row.startTime),
        price: toNumber(row.price),
        currency: row.currency,
      })),
    });
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
      // La moneda entra al agrupamiento: quien cobra en dos monedas produce dos
      // filas, que después se juntan en un solo profesional del ranking.
      .addSelect('segment.currencyAtBooking', 'currency')
      .groupBy('staff.id')
      .addGroupBy('staff.name')
      .addGroupBy('staff.commissionRate')
      .addGroupBy('staff.deletedAt')
      .addGroupBy('segment.currencyAtBooking')
      .orderBy('revenue', 'DESC')
      .getRawMany<StaffRankingRow>();

    /*
     * Una entrada por profesional, con sus monedas adentro.
     *
     * El `GROUP BY` devuelve una fila por profesional **y** moneda; el ranking se
     * lee por persona. Se junta acá, conservando el orden de llegada, que ya
     * viene por facturación descendente: el primero en aparecer es el que más
     * factura en su moneda principal.
     */
    const byStaff = new Map<string, StaffRankingEntry>();

    for (const row of rows) {
      const commissionRate = parseCommissionRate(row.commissionRate);
      const entry = byStaff.get(row.staffId) ?? {
        staffId: row.staffId,
        staffName: row.staffName,
        completedAppointments: 0,
        earnings: [],
        commissionRate,
        isFormer: row.deletedAt !== null,
      };

      const amount = toMoney(toNumber(row.revenue));
      const appointments = toNumber(row.completedAppointments);

      /*
       * Las citas se suman entre monedas y el promedio se calcula por moneda.
       * Una cita que mezcla dos monedas se cuenta en las dos: es una cita que el
       * profesional atendió, y no hay forma de partirla en media.
       */
      entry.completedAppointments += appointments;
      entry.earnings.push({
        currency: row.currency,
        amount,
        averageTicket: appointments ? toMoney(amount / appointments) : 0,
        estimatedCommission: estimateCommission(amount, commissionRate),
      });

      byStaff.set(row.staffId, entry);
    }

    return [...byStaff.values()];
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
      // Por moneda además de por servicio: un servicio que cambió de moneda a
      // mitad del período produce una fila por cada una, que es lo que
      // realmente se cobró.
      .addSelect('segment.currencyAtBooking', 'currency')
      .groupBy('service.id')
      .addGroupBy('service.name')
      .addGroupBy('segment.currencyAtBooking')
      .orderBy('revenue', 'DESC')
      .getRawMany<ServiceRankingRow>();

    return rows.map((row) => ({
      serviceId: row.serviceId,
      serviceName: row.serviceName,
      timesPerformed: toNumber(row.timesPerformed),
      revenue: toMoney(toNumber(row.revenue)),
      currency: row.currency,
    }));
  }

  /**
   * El reporte de un profesional sobre su propio trabajo.
   *
   * Reutiliza los mismos constructores de consulta que el reporte del negocio
   * —`appointmentsInRange` y `billedSegments`— con un filtro más por `staffId`. Es
   * lo que garantiza que los dos cuenten lo mismo de la misma forma: si la
   * definición de "facturado" cambia, cambia para los dos a la vez.
   *
   * El `staffId` lo pone el controlador desde el token. Acá se recibe como
   * parámetro obligatorio y no como filtro opcional a propósito: un parámetro que
   * se puede omitir es un parámetro que alguien va a omitir.
   */
  async getStaffReport(
    tenantId: string,
    staffId: string,
    query: ReportQueryDto,
  ): Promise<StaffReport> {
    const tenant = await this.tenantRepository.findOneBy({ id: tenantId });
    if (!tenant) {
      throw new NotFoundException(TenantError.NOT_FOUND);
    }

    const staff = await this.tenantRepository.manager.findOne(Staff, {
      where: { id: staffId, tenantId },
      withDeleted: true,
    });
    if (!staff) {
      throw new NotFoundException('Miembro del equipo no encontrado');
    }

    const timezone = tenant.timezone || DEFAULT_TIMEZONE;
    const now = new Date();
    const preset = query.preset ?? 'today';
    const range = resolveReportRange(query, timezone, now);
    const previousRange = previousReportRange(range, preset, timezone);

    /*
     * La tasa se lee una vez y se le pasa a los dos resúmenes. Es a propósito que
     * al período anterior se le aplique la tasa de hoy y no la que regía entonces:
     * la comparación tiene que responder "trabajé más o menos", y con dos tasas
     * distintas respondería "me cambiaron la comisión", que es otra pregunta.
     */
    const commissionRate = parseCommissionRate(staff.commissionRate);

    const [summary, previousSummary, timeline, serviceRanking, currentMonth] =
      await Promise.all([
        this.getStaffSummary(tenantId, staffId, range, commissionRate),
        this.getStaffSummary(tenantId, staffId, previousRange, commissionRate),
        this.getStaffTimeline(tenantId, staffId, range, timezone),
        this.getStaffServiceRanking(tenantId, staffId, range),
        this.getStaffCurrentMonth(
          tenantId,
          staffId,
          timezone,
          now,
          commissionRate,
        ),
      ]);

    return {
      range: {
        preset,
        from: range.from,
        to: range.to,
        timezone,
      },
      currency: tenant.currency,
      staff: { id: staff.id, name: staff.name, commissionRate },
      currentMonth,
      summary,
      comparison: {
        range: { from: previousRange.from, to: previousRange.to },
        summary: previousSummary,
      },
      timeline,
      serviceRanking,
    };
  }

  /** Los segmentos facturados **de este profesional**. */
  private billedSegmentsForStaff(
    tenantId: string,
    staffId: string,
    range: ReportRange,
  ): SelectQueryBuilder<AppointmentSegment> {
    return this.billedSegments(tenantId, range).andWhere(
      'segment.staffId = :staffId',
      { staffId },
    );
  }

  /**
   * El resumen de un profesional en un rango cualquiera.
   *
   * La tasa entra por parámetro en vez de leerse acá adentro porque el reporte
   * llama a este método dos veces —el período y el anterior— y una segunda lectura
   * de la misma fila sería una consulta de más para el mismo dato.
   */
  private async getStaffSummary(
    tenantId: string,
    staffId: string,
    range: ReportRange,
    commissionRate: number | null,
  ): Promise<StaffSummary> {
    const [counts, revenueRows, billed] = await Promise.all([
      /*
       * Los estados se cuentan sobre citas **distintas** en las que tenga algún
       * segmento. Sin el `DISTINCT`, una cita en la que presta dos servicios se
       * contaría dos veces: sus "citas completadas" crecerían con la cantidad de
       * servicios en lugar de con la de gente que atendió.
       */
      this.appointmentsInRange(tenantId, range)
        .innerJoin(
          'appointment.services',
          'segment',
          'segment.staffId = :staffId',
          { staffId },
        )
        .select(
          'COUNT(DISTINCT CASE WHEN appointment.status = :completed THEN appointment.id END)',
          'completed',
        )
        .addSelect(
          'COUNT(DISTINCT CASE WHEN appointment.status = :cancelled THEN appointment.id END)',
          'cancelled',
        )
        .addSelect(
          'COUNT(DISTINCT CASE WHEN appointment.status IN (:...open) THEN appointment.id END)',
          'pending',
        )
        .addSelect(
          'COUNT(DISTINCT CASE WHEN appointment.status = :completed THEN appointment.clientId END)',
          'clients',
        )
        .setParameters({
          completed: AppointmentStatus.COMPLETED,
          cancelled: AppointmentStatus.CANCELLED,
          open: [...OPEN_APPOINTMENT_STATUSES],
        })
        .getRawOne<StaffCountRow>(),

      this.revenueByCurrency(
        this.billedSegmentsForStaff(tenantId, staffId, range),
      ),

      // El grano acá sí es el segmento: cada uno es un servicio prestado. Va
      // aparte de la plata porque contar trabajo no se parte por moneda.
      this.billedSegmentsForStaff(tenantId, staffId, range)
        .select('COUNT(*)', 'services')
        .getRawOne<{ services: string | null }>(),
    ]);

    return {
      earnings: this.toCurrencyEarnings(revenueRows, commissionRate),
      completedCount: toNumber(counts?.completed),
      cancelledCount: toNumber(counts?.cancelled),
      pendingCount: toNumber(counts?.pending),
      clientsServed: toNumber(counts?.clients),
      servicesPerformed: toNumber(billed?.services),
    };
  }

  /**
   * Lo generado en el mes en curso, al margen del período elegido.
   *
   * Un agregado y no tres: hoy y la semana ya son dos opciones del selector, así
   * que sus totales se calculan cuando alguien los pide. El mes es el único que
   * hace falta tener siempre a mano, porque es el contexto de un "hoy" que recién
   * empieza.
   */
  private async getStaffCurrentMonth(
    tenantId: string,
    staffId: string,
    timezone: string,
    now: Date,
    commissionRate: number | null,
  ): Promise<StaffReport['currentMonth']> {
    const range = resolveReportRange({ preset: 'month' }, timezone, now);
    const rows = await this.revenueByCurrency(
      this.billedSegmentsForStaff(tenantId, staffId, range),
    );

    return { earnings: this.toCurrencyEarnings(rows, commissionRate) };
  }

  private async getStaffTimeline(
    tenantId: string,
    staffId: string,
    range: ReportRange,
    timezone: string,
  ): Promise<ReportTimeline | null> {
    const rows = await this.billedSegmentsForStaff(tenantId, staffId, range)
      .select('appointment.id', 'appointmentId')
      .addSelect('appointment.startTime', 'startTime')
      .addSelect('segment.priceAtBooking', 'price')
      .addSelect('segment.currencyAtBooking', 'currency')
      .getRawMany<{
        appointmentId: string;
        startTime: Date | string;
        price: string | number;
        currency: string;
      }>();

    return buildReportTimeline({
      from: range.from,
      to: range.to,
      timezone,
      entries: rows.map((row) => ({
        appointmentId: row.appointmentId,
        startTime: new Date(row.startTime),
        price: toNumber(row.price),
        currency: row.currency,
      })),
    });
  }

  private async getStaffServiceRanking(
    tenantId: string,
    staffId: string,
    range: ReportRange,
  ): Promise<ServiceRankingEntry[]> {
    const rows = await this.billedSegmentsForStaff(tenantId, staffId, range)
      .innerJoin('segment.service', 'service')
      .select('service.id', 'serviceId')
      .addSelect('service.name', 'serviceName')
      .addSelect('COUNT(*)', 'timesPerformed')
      .addSelect('SUM(segment.priceAtBooking)', 'revenue')
      // Por moneda además de por servicio: un servicio que cambió de moneda a
      // mitad del período produce una fila por cada una, que es lo que
      // realmente se cobró.
      .addSelect('segment.currencyAtBooking', 'currency')
      .groupBy('service.id')
      .addGroupBy('service.name')
      .addGroupBy('segment.currencyAtBooking')
      .orderBy('revenue', 'DESC')
      .getRawMany<ServiceRankingRow>();

    return rows.map((row) => ({
      serviceId: row.serviceId,
      serviceName: row.serviceName,
      timesPerformed: toNumber(row.timesPerformed),
      revenue: toMoney(toNumber(row.revenue)),
      currency: row.currency,
    }));
  }
}
