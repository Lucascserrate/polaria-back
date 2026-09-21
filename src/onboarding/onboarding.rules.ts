/**
 * Qué le falta configurar a un negocio.
 *
 * Se **deriva** de lo que existe en la base, no de un booleano guardado. Un
 * `isFullyConfigured` habría que mantener en cada alta y baja de servicio, de
 * profesional o de cita, y basta olvidarse en un lugar para que el panel
 * mienta. Acá la respuesta no puede desincronizarse porque no se guarda.
 */

export enum OnboardingStep {
  /** Nombre y tipo de negocio. */
  BUSINESS_INFO = 'BUSINESS_INFO',
  BUSINESS_HOURS = 'BUSINESS_HOURS',
  SERVICES = 'SERVICES',
  STAFF = 'STAFF',
  /** Una cita creada y finalizada: el circuito completo, hecho una vez. */
  FIRST_APPOINTMENT = 'FIRST_APPOINTMENT',
}

/**
 * Los dos bloques del onboarding, en orden.
 *
 * `BUSINESS_SETUP` crea y personaliza el negocio; `POLARIA_ACTIVATION` lo deja
 * en condiciones de operar. La separación existe para que nadie tenga que cargar
 * servicios, profesionales y una primera cita antes de entrar al producto.
 */
export const BUSINESS_SETUP_STEPS: readonly OnboardingStep[] = [
  OnboardingStep.BUSINESS_INFO,
  OnboardingStep.BUSINESS_HOURS,
];

/**
 * Lo que el negocio aprende adentro del producto, y en el orden en que se puede
 * aprender: no hay cita que cargar sin un servicio y alguien que lo haga.
 *
 * WhatsApp no está. Polaria toma reservas por su página aunque el canal no esté
 * conectado, así que exigirlo acá convertía una sugerencia en un bloqueo y dejaba
 * al negocio con un pendiente que no le impedía nada.
 */
export const POLARIA_ACTIVATION_STEPS: readonly OnboardingStep[] = [
  OnboardingStep.SERVICES,
  OnboardingStep.STAFF,
  OnboardingStep.FIRST_APPOINTMENT,
];

const ORDERED_STEPS: readonly OnboardingStep[] = [
  ...BUSINESS_SETUP_STEPS,
  ...POLARIA_ACTIVATION_STEPS,
];

export type OnboardingSnapshot = {
  hasName: boolean;
  hasBusinessType: boolean;
  /** Franjas de atención cargadas. Un día cerrado no aporta ninguna. */
  businessHoursCount: number;
  activeServicesCount: number;
  /**
   * Profesionales activos **con al menos un servicio asignado**.
   *
   * Un profesional sin servicios no puede recibir reservas: la disponibilidad lo
   * descarta. Contarlo como configurado dejaría al negocio creyendo que está
   * listo mientras el flujo de reserva no ofrece a nadie.
   */
  bookableStaffCount: number;
  /**
   * Citas finalizadas.
   *
   * Finalizadas y no creadas: crear una cita es media lección. Lo que cierra el
   * circuito —y lo que el negocio no descubre solo— es cobrarla y darla por
   * terminada.
   */
  completedAppointmentsCount: number;
  whatsappConnected: boolean;
};

export type OnboardingStatus = {
  steps: Record<OnboardingStep, boolean>;
  businessSetupComplete: boolean;
  polariaActivationComplete: boolean;
  /**
   * Si un cliente podría reservar ahora mismo.
   *
   * No es lo mismo que "todo completo": el tipo de negocio es parte de la
   * personalización pero no hace falta para tomar una reserva, y la primera cita
   * propia es una lección, no un requisito. Lo que hace falta es horario,
   * servicios y alguien que atienda.
   */
  readyForBookings: boolean;
  /** Primer paso pendiente, en el orden del flujo. `null` si no falta ninguno. */
  nextStep: OnboardingStep | null;
  /**
   * Si el canal de WhatsApp está conectado.
   *
   * Viaja suelto y no como paso: el panel lo ofrece como sugerencia al pie de las
   * lecciones, sin contarlo en el progreso ni bloquear nada.
   */
  whatsappConnected: boolean;
};

export function resolveOnboardingStatus(
  snapshot: OnboardingSnapshot,
): OnboardingStatus {
  const steps: Record<OnboardingStep, boolean> = {
    [OnboardingStep.BUSINESS_INFO]:
      snapshot.hasName && snapshot.hasBusinessType,
    [OnboardingStep.BUSINESS_HOURS]: snapshot.businessHoursCount > 0,
    [OnboardingStep.SERVICES]: snapshot.activeServicesCount > 0,
    [OnboardingStep.STAFF]: snapshot.bookableStaffCount > 0,
    [OnboardingStep.FIRST_APPOINTMENT]: snapshot.completedAppointmentsCount > 0,
  };

  const done = (step: OnboardingStep) => steps[step];

  return {
    steps,
    businessSetupComplete: BUSINESS_SETUP_STEPS.every(done),
    polariaActivationComplete: POLARIA_ACTIVATION_STEPS.every(done),
    readyForBookings:
      steps[OnboardingStep.BUSINESS_HOURS] &&
      steps[OnboardingStep.SERVICES] &&
      steps[OnboardingStep.STAFF],
    nextStep: ORDERED_STEPS.find((step) => !steps[step]) ?? null,
    whatsappConnected: snapshot.whatsappConnected,
  };
}
