import { AppointmentStatus } from '../appointments/entities/appointment.entity';
import { ReportPreset } from './utils/report-range.util';
import type { ReportTimeline } from './utils/report-timeline.util';

export interface ReportSummary {
  /** Suma de `priceAtBooking` de los servicios de citas completadas. */
  revenueTotal: number;
  completedCount: number;
  cancelledCount: number;
  /**
   * Citas que siguen abiertas: reservadas, pendientes o confirmadas. Ver
   * `OPEN_APPOINTMENT_STATUSES`. El desglose exacto está en `byStatus`.
   */
  pendingCount: number;
  /** Ingreso promedio por cita completada. */
  averageTicket: number;
  byStatus: Record<AppointmentStatus, number>;
}

export interface StaffRankingEntry {
  staffId: string;
  staffName: string;
  completedAppointments: number;
  revenue: number;
  /** Porcentaje configurado, o `null` si el negocio no definió comisión. */
  commissionRate: number | null;
  /** `revenue * commissionRate / 100`, o `null` si no hay tasa configurada. */
  estimatedCommission: number | null;
  /** `true` si el profesional ya no trabaja en el negocio. */
  isFormer: boolean;
}

export interface ServiceRankingEntry {
  serviceId: string;
  serviceName: string;
  timesPerformed: number;
  revenue: number;
}

export interface TenantReport {
  range: {
    preset: ReportPreset;
    from: string;
    to: string;
    timezone: string;
  };
  /** Moneda del negocio en ISO 4217, para que el cliente formatee los montos. */
  currency: string;
  summary: ReportSummary;
  /**
   * Cómo evolucionó la facturación dentro del período.
   *
   * `null` cuando el rango es de un solo día: una sola barra no compara nada.
   */
  timeline: ReportTimeline | null;
  staffRanking: StaffRankingEntry[];
  serviceRanking: ServiceRankingEntry[];
}
