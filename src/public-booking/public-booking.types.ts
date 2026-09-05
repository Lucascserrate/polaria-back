import type { BusinessStatus } from '../business_hours/business-status';
import type { WeeklyScheduleRange } from '../schedule/weekly-schedule.util';

/**
 * Lo que ve cualquiera que abra `polariahq.com/[slug]`.
 *
 * Es un contrato aparte y no un `Pick` del tenant a propósito: acá adentro no
 * hay nada que el negocio no haya decidido publicar. La entidad tiene tokens de
 * Meta, ids de WABA, el correo del dueño y el estado de su suscripción; que
 * agregar una columna sensible no pueda filtrarse sola a una página pública es
 * exactamente lo que compra escribir la forma a mano.
 */
export type PublicBusinessProfile = {
  slug: string;
  name: string;
  /** Ver `BUSINESS_TYPES`. `null` mientras el negocio no lo cargó. */
  businessType: string | null;
  timezone: string;
  /** ISO 4217, para formatear los precios con la moneda del negocio. */
  currency: string;
  /** Prefijo telefónico sugerido en el formulario. Ver `dialCodeForTimeZone`. */
  dialCode: string;
  address: string | null;
  location: { latitude: number; longitude: number } | null;
  /** Abierto o cerrado **ahora**, en la zona del negocio. */
  status: BusinessStatus;
  /** Horario semanal completo, para la sección de horarios. */
  businessHours: WeeklyScheduleRange[];
  services: PublicService[];
};

export type PublicService = {
  id: string;
  name: string;
  description: string | null;
  /** Ya convertido a número: MySQL devuelve `decimal` como cadena. */
  price: number;
  durationMinutes: number;
  /**
   * Si el cliente puede reservarlo por su cuenta.
   *
   * Los que no se muestran igual, con su precio y su duración: la página también
   * sirve para contar qué hace el negocio, y esconder media carta la empobrece.
   * Lo que la página no debe hacer es dejar elegirlos —el backend rechaza el
   * intento de todos modos, ver `loadContext`—.
   *
   * Viaja como booleano y no como la política cruda porque a la página no le
   * importa el motivo, solo si el botón se puede apretar. El motivo, cuando haya
   * más de uno, lo explica el negocio.
   */
  selfBookable: boolean;
};

export type PublicStaff = {
  id: string;
  name: string;
  jobTitle: string | null;
};

/**
 * Un horario ofrecible. Sin los profesionales habilitados a propósito.
 *
 * Quién atiende cuando el cliente no eligió lo resuelve `confirmSlot` en el
 * momento de reservar, por carga de trabajo. Publicar la lista acá no sólo
 * sería inútil —el navegador no toma esa decisión—: expondría la agenda del
 * equipo a cualquiera que mire la respuesta.
 */
export type PublicSlot = {
  startTime: string;
  endTime: string;
};

/** El comprobante de la reserva, que es lo único que la página muestra al final. */
export type PublicBookingConfirmation = {
  id: string;
  startTime: string;
  endTime: string;
  serviceName: string;
  staffName: string | null;
  price: number;
  durationMinutes: number;
};
