import { AppointmentStatus } from '../appointments/entities/appointment.entity';
import { ReportPreset } from './utils/report-range.util';
import type { ReportTimeline } from './utils/report-timeline.util';

/**
 * Lo facturado en una moneda, dentro de un período.
 *
 * Los totales son una lista y no un número porque un catálogo puede cobrar en
 * dos monedas: la psicóloga cobra las presenciales en bolivianos y las online en
 * dólares. Sumarlas daría un número que no significa nada.
 *
 * Casi todos los negocios usan una sola y reciben una lista de un elemento, que
 * se dibuja igual que antes de que esto existiera.
 */
export interface CurrencyRevenue {
  currency: string;
  amount: number;
  /**
   * Ingreso promedio por cita facturada **en esta moneda**.
   *
   * El divisor son las citas que tocaron esta moneda, no todas las del período:
   * dividir los dólares entre las citas en bolivianos daría un promedio que no
   * corresponde a nada.
   */
  averageTicket: number;
}

/** Lo facturado en una moneda, más la parte que le toca al profesional. */
export interface CurrencyEarnings extends CurrencyRevenue {
  /**
   * `amount * commissionRate / 100`, o `null` si el negocio no definió comisión
   * —distinto de una comisión de cero—.
   *
   * Se calcula por moneda porque el porcentaje es el mismo pero la base no: el
   * 30% de 300 bolivianos y el 30% de 40 dólares son dos cifras, y no hay tipo de
   * cambio que las junte sin inventar uno.
   */
  estimatedCommission: number | null;
}

export interface ReportSummary {
  /** Lo facturado en citas completadas, una entrada por moneda. */
  revenue: CurrencyRevenue[];
  completedCount: number;
  cancelledCount: number;
  /**
   * Citas que siguen abiertas: reservadas, pendientes o confirmadas. Ver
   * `OPEN_APPOINTMENT_STATUSES`. El desglose exacto está en `byStatus`.
   */
  pendingCount: number;
  byStatus: Record<AppointmentStatus, number>;
}

export interface StaffRankingEntry {
  staffId: string;
  staffName: string;
  completedAppointments: number;
  /** Lo facturado y su parte, una entrada por moneda. */
  earnings: CurrencyEarnings[];
  /** Porcentaje configurado, o `null` si el negocio no definió comisión. */
  commissionRate: number | null;
  /** `true` si el profesional ya no trabaja en el negocio. */
  isFormer: boolean;
}

export interface ServiceRankingEntry {
  serviceId: string;
  serviceName: string;
  timesPerformed: number;
  revenue: number;
  /**
   * La moneda de `revenue`.
   *
   * Un servicio tiene una sola moneda, así que acá no hace falta una lista. Sale
   * de `currencyAtBooking` y no del servicio: si cambió de moneda, aparece una
   * fila por cada una, que es la única lectura honesta de lo que se cobró.
   */
  currency: string;
}

export interface TenantReport {
  range: {
    preset: ReportPreset;
    from: string;
    to: string;
    timezone: string;
  };
  /**
   * Moneda por defecto del negocio, en ISO 4217.
   *
   * No es la moneda de los montos —cada uno trae la suya— sino la que se usa
   * para escribir un cero: un período sin facturación no tiene moneda propia y
   * "Bs 0" se lee mejor que un cero pelado.
   */
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
    /**
     * Su porcentaje sobre lo que factura, o `null` si el negocio no configuró
     * comisión.
     *
     * Va en `staff` y no en `summary` porque no es un resultado del período sino
     * una condición del profesional: vale igual para el período anterior. De paso,
     * este es el único lugar donde el propio profesional puede verla; hasta ahora
     * solo aparecía en el equipo, que es pantalla del dueño.
     */
    commissionRate: number | null;
  };
  /**
   * Lo generado en el mes en curso, al margen del período elegido.
   *
   * Es la única cifra que no sigue al selector, y sobrevive por un motivo
   * concreto: quien mira "hoy" a media mañana ve un cero, y necesita el mes al
   * lado para saber que está viendo una jornada que recién empieza y no una
   * pantalla rota.
   *
   * Antes eran tres —hoy, semana y mes—, que son exactamente las tres opciones del
   * selector: la pantalla respondía dos veces la misma pregunta, con dos
   * jerarquías distintas. Quedó la que el selector no puede dar sin perder el
   * período que se está mirando.
   */
  currentMonth: {
    /** Lo generado y su parte, una entrada por moneda. */
    earnings: CurrencyEarnings[];
  };
  summary: StaffSummary;
  /**
   * El mismo resumen, del período inmediatamente anterior.
   *
   * Está para que los números tengan contra qué medirse: "Bs 200" no dice nada,
   * "Bs 200, 12% más que el mes pasado" sí. Se calcula en el servidor porque qué
   * es "el período anterior" depende del calendario del negocio —ver
   * `previousReportRange`—, no del reloj del navegador.
   *
   * No lleva timeline ni ranking: para comparar alcanza con los totales, y traer
   * el doble de todo para dibujar la mitad sería caro al pedo. De su
   * `pendingCount` tampoco hay mucho que decir —una cita abierta en un período que
   * ya pasó es una que nadie cerró—, pero viaja igual porque es el mismo tipo.
   */
  comparison: {
    /** Qué días fueron, para poder nombrar la comparación ("vs. julio"). */
    range: { from: string; to: string };
    summary: StaffSummary;
  };
  timeline: ReportTimeline | null;
  serviceRanking: ServiceRankingEntry[];
}

/**
 * Los números de un profesional dentro de un período.
 *
 * Es un tipo con nombre y no una forma anónima dentro de `StaffReport` porque el
 * reporte lo usa dos veces —el período que se mira y el anterior— y comparar dos
 * formas que pueden divergir es comparar peras con manzanas.
 */
export interface StaffSummary {
  /**
   * Lo facturado con **sus** segmentos en citas completadas, y su parte, una
   * entrada por moneda.
   *
   * La comisión es **estimada** y hay que mostrarla como tal: sale de la tasa
   * vigente hoy, no de la que regía el día de cada servicio, y no existe registro
   * de pagos, así que no sabe nada de lo que ya se liquidó. Ver
   * `estimateCommission`.
   */
  earnings: CurrencyEarnings[];
  /** Citas completadas en las que participó. Distintas, no segmentos. */
  completedCount: number;
  cancelledCount: number;
  /** Citas suyas que siguen abiertas. */
  pendingCount: number;
  /** Personas distintas que atendió. Un cliente que volvió tres veces cuenta una. */
  clientsServed: number;
  /** Servicios prestados. Acá sí el grano es el segmento: son unidades de trabajo. */
  servicesPerformed: number;
}
