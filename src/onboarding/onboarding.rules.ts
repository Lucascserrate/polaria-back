/**
 * Qué le falta configurar a un negocio.
 *
 * Se **deriva** de lo que existe en la base, no de un booleano guardado. Un
 * `isFullyConfigured` habría que mantener en cada alta y baja de servicio, de
 * profesional o de conexión, y basta olvidarse en un lugar para que el panel
 * mienta. Acá la respuesta no puede desincronizarse porque no se guarda.
 */

export enum OnboardingStep {
  /** Nombre y tipo de negocio. */
  BUSINESS_INFO = 'BUSINESS_INFO',
  BUSINESS_HOURS = 'BUSINESS_HOURS',
  SERVICES = 'SERVICES',
  STAFF = 'STAFF',
  WHATSAPP = 'WHATSAPP',
}

/**
 * Los dos bloques del onboarding, en orden.
 *
 * `BUSINESS_SETUP` crea y personaliza el negocio; `POLARIA_ACTIVATION` lo deja
 * en condiciones de operar. La separación existe para que nadie tenga que cargar
 * servicios, profesionales y WhatsApp antes de entrar al producto.
 */
export const BUSINESS_SETUP_STEPS: readonly OnboardingStep[] = [
  OnboardingStep.BUSINESS_INFO,
  OnboardingStep.BUSINESS_HOURS,
];

export const POLARIA_ACTIVATION_STEPS: readonly OnboardingStep[] = [
  OnboardingStep.SERVICES,
  OnboardingStep.STAFF,
  OnboardingStep.WHATSAPP,
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
   * personalización pero no hace falta para tomar una reserva. Lo que hace falta
   * es horario, servicios, alguien que atienda y un canal por donde pedir.
   */
  readyForBookings: boolean;
  /** Primer paso pendiente, en el orden del flujo. `null` si no falta ninguno. */
  nextStep: OnboardingStep | null;
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
    [OnboardingStep.WHATSAPP]: snapshot.whatsappConnected,
  };

  const done = (step: OnboardingStep) => steps[step];

  return {
    steps,
    businessSetupComplete: BUSINESS_SETUP_STEPS.every(done),
    polariaActivationComplete: POLARIA_ACTIVATION_STEPS.every(done),
    readyForBookings:
      steps[OnboardingStep.BUSINESS_HOURS] &&
      steps[OnboardingStep.SERVICES] &&
      steps[OnboardingStep.STAFF] &&
      steps[OnboardingStep.WHATSAPP],
    nextStep: ORDERED_STEPS.find((step) => !steps[step]) ?? null,
  };
}
