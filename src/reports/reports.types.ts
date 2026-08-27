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

/**
 * Lo que se le informa a un profesional sobre su propio trabajo.
 *
 * No es `TenantReport` recortado, y la diferencia no es de tamaño sino de grano.
 * Los números del negocio se cuentan por **cita**; los de una persona se cuentan
 * por **segmento**, porque una cita puede repartirse entre dos profesionales y a
 * cada uno le corresponde lo suyo. Contar citas acá le atribuiría a cada uno el
 * total de una cita que hizo a medias.
 *
 * Tampoco lleva `staffRanking`: comparar a alguien con sus compañeros es
 * exactamente lo que no le toca ver.
 */
export interface StaffReport {
  range: {
    preset: ReportPreset;
    from: string;
    to: string;
    timezone: string;
  };
  currency: string;
  staff: {
    id: string;
    name: string;
  };
  /**
   * Facturado hoy, en la semana y en el mes, al margen del período elegido.
   *
   * Van siempre y no dependen del selector porque responden la pregunta con la que
   * un profesional abre esta pantalla —"cómo vengo"— y esa no debería costar tres
   * clicks. El resto de las métricas sí sigue al período.
   */
  revenueSnapshots: {
    today: number;
    week: number;
    month: number;
  };
  summary: {
    /** Suma de `priceAtBooking` de **sus** segmentos en citas completadas. */
    revenueTotal: number;
    /** Citas completadas en las que participó. Distintas, no segmentos. */
    completedCount: number;
    cancelledCount: number;
    /** Citas suyas que siguen abiertas. */
    pendingCount: number;
    /** Personas distintas que atendió. Un cliente que volvió tres veces cuenta una. */
    clientsServed: number;
    /** Servicios prestados. Acá sí el grano es el segmento: son unidades de trabajo. */
    servicesPerformed: number;
    /** Ingreso promedio por cita completada. */
    averageTicket: number;
  };
  timeline: ReportTimeline | null;
  serviceRanking: ServiceRankingEntry[];
}
