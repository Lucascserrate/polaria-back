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
  /**
   * Logo del negocio, o `null` si no subió ninguno.
   *
   * `null` es el caso mayoritario y no un error: la página tiene que resolverse
   * sin logo —con el nombre, que siempre está— y no reservarle un hueco vacío a
   * una imagen que puede no llegar nunca.
   */
  logoUrl: string | null;
  /**
   * Fotos del local, en orden. La primera es la portada.
   *
   * Un arreglo vacío es el caso normal y significa "este negocio no subió
   * fotos": la página no dibuja galería, y no deja un hueco donde irían. Con
   * las medidas de cada una para que el espacio esté reservado antes de que la
   * imagen cargue.
   */
  photos: PublicPhoto[];
  /**
   * Trabajos terminados, en orden de carga.
   *
   * Aparte de `photos` y no mezclado con ellas porque contestan preguntas
   * distintas: aquéllas muestran cómo es el lugar y éstas cómo cortan. En la
   * página van en secciones separadas, y quien decide cuál mirar es el cliente.
   *
   * Vacío es el caso normal y significa que el negocio no subió trabajos: la
   * sección no se dibuja, igual que la galería.
   */
  portfolio: PublicPhoto[];
  team: PublicStaff[];
  timezone: string;
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
  categories: PublicServiceCategory[];
};

export type PublicServiceCategory = {
  id: string;
  name: string;
  description: string | null;
};

export type PublicService = {
  id: string;
  name: string;
  categoryId: string | null;
  description: string | null;
  /**
   * `null` si el servicio se cotiza después de ver a la persona: la página
   * escribe el aviso en lugar del importe. Ver `quoted-price.ts`.
   */
  price: number | null;
  currency: string;
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
  photoUrl: string | null;
};

/**
 * Una foto de la galería. Ver `BusinessPhotoView`.
 *
 * Se declara acá y no se importa del módulo de fotos por lo mismo que el resto
 * de este archivo: este es el contrato público, y tiene que poder quedarse
 * igual aunque el modelo interno cambie.
 */
export type PublicPhoto = {
  id: string;
  url: string;
  width: number;
  height: number;
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

/**
 * Quién puede atender lo que se eligió.
 *
 * Dos listas porque son dos preguntas, y la pantalla hace las dos seguidas:
 * `shared` es "quién puede con toda la reserva", que es lo que se ofrece por
 * defecto; `byService` es "quién puede con cada cosa", que es lo que hace falta
 * para repartirla.
 *
 * Con un solo servicio las dos dicen lo mismo, y la pantalla usa `shared`.
 *
 * **`shared` vacía con `byService` llena no es un error**: significa que nadie
 * hace todos los servicios elegidos y que la reserva sólo existe repartida. La
 * página tiene que poder decirlo con esas palabras en lugar de mostrar una lista
 * vacía.
 */
export type PublicBookingStaff = {
  shared: PublicStaff[];
  /** En el mismo orden en que se pidieron los servicios. */
  byService: { serviceId: string; staff: PublicStaff[] }[];
};

/** Un servicio dentro del comprobante, con su tramo ya resuelto. */
export type PublicBookedService = {
  serviceId: string;
  name: string;
  /** Quién lo atiende. Puede ser distinto en cada servicio de la misma reserva. */
  staffName: string | null;
  /** `null` si se cotiza: el comprobante lo dice en vez de mostrar un importe. */
  price: number | null;
  durationMinutes: number;
  /** Cuándo arranca **este** servicio, que no es el inicio del bloque salvo el primero. */
  startTime: string;
};

/**
 * El comprobante de la reserva, que es lo único que la página muestra al final.
 *
 * Los horarios de arriba son los del **bloque**: de cuando empieza el primer
 * servicio a cuando termina el último. Lo de cada uno va en `services`.
 */
export type PublicBookingConfirmation = {
  id: string;
  startTime: string;
  endTime: string;
  currency: string;
  /** La suma de los servicios, que es lo que dura estar ahí. */
  durationMinutes: number;
  /** En orden de atención. Nunca vacío. */
  services: PublicBookedService[];
};
