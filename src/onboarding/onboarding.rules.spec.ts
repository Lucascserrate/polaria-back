import {
  OnboardingStep,
  resolveOnboardingStatus,
  type OnboardingSnapshot,
} from './onboarding.rules';

const complete: OnboardingSnapshot = {
  hasName: true,
  hasBusinessType: true,
  businessHoursCount: 6,
  activeServicesCount: 3,
  bookableStaffCount: 2,
  completedAppointmentsCount: 1,
  whatsappConnected: true,
};

const snapshot = (overrides: Partial<OnboardingSnapshot> = {}) => ({
  ...complete,
  ...overrides,
});

describe('resolveOnboardingStatus', () => {
  it('con todo cargado no queda nada pendiente', () => {
    const status = resolveOnboardingStatus(complete);

    expect(status.businessSetupComplete).toBe(true);
    expect(status.polariaActivationComplete).toBe(true);
    expect(status.readyForBookings).toBe(true);
    expect(status.nextStep).toBeNull();
  });

  it('un negocio recién registrado arranca por su información', () => {
    const status = resolveOnboardingStatus({
      hasName: true,
      hasBusinessType: false,
      businessHoursCount: 0,
      activeServicesCount: 0,
      bookableStaffCount: 0,
      completedAppointmentsCount: 0,
      whatsappConnected: false,
    });

    expect(status.nextStep).toBe(OnboardingStep.BUSINESS_INFO);
    expect(status.businessSetupComplete).toBe(false);
  });

  it('el nombre solo no completa la información del negocio', () => {
    // El tenant nace con el nombre de la cuenta de Google, así que sin el tipo
    // el paso seguiría pendiente aunque haya nombre.
    const status = resolveOnboardingStatus(
      snapshot({ hasBusinessType: false }),
    );

    expect(status.steps[OnboardingStep.BUSINESS_INFO]).toBe(false);
    expect(status.nextStep).toBe(OnboardingStep.BUSINESS_INFO);
  });

  it('sigue el orden del flujo al elegir el paso pendiente', () => {
    const status = resolveOnboardingStatus(
      snapshot({ activeServicesCount: 0, completedAppointmentsCount: 0 }),
    );

    expect(status.nextStep).toBe(OnboardingStep.SERVICES);
  });

  it('un profesional sin servicios no cuenta como configurado', () => {
    const status = resolveOnboardingStatus(snapshot({ bookableStaffCount: 0 }));

    expect(status.steps[OnboardingStep.STAFF]).toBe(false);
  });

  it('el setup del negocio se completa sin activar Polaria', () => {
    // Es la separación que se buscaba: se puede entrar al producto con el
    // negocio creado y sin servicios, staff ni una primera cita.
    const status = resolveOnboardingStatus(
      snapshot({
        activeServicesCount: 0,
        bookableStaffCount: 0,
        completedAppointmentsCount: 0,
      }),
    );

    expect(status.businessSetupComplete).toBe(true);
    expect(status.polariaActivationComplete).toBe(false);
  });

  it('se puede reservar sin tener cargado el tipo de negocio', () => {
    // El tipo es personalización; para tomar una reserva hacen falta horario,
    // servicios y alguien que atienda.
    const status = resolveOnboardingStatus(
      snapshot({ hasBusinessType: false }),
    );

    expect(status.readyForBookings).toBe(true);
    expect(status.businessSetupComplete).toBe(false);
  });

  it('una cita creada pero no finalizada deja la lección pendiente', () => {
    // La lección enseña a cerrar el circuito, no a cargar una fila: lo que se
    // cuenta son citas finalizadas.
    const status = resolveOnboardingStatus(
      snapshot({ completedAppointmentsCount: 0 }),
    );

    expect(status.steps[OnboardingStep.FIRST_APPOINTMENT]).toBe(false);
    expect(status.nextStep).toBe(OnboardingStep.FIRST_APPOINTMENT);
  });

  it('sin la primera cita el negocio igual puede recibir reservas', () => {
    // La primera cita es una lección, no un requisito: la agenda ya funciona.
    const status = resolveOnboardingStatus(
      snapshot({ completedAppointmentsCount: 0 }),
    );

    expect(status.readyForBookings).toBe(true);
  });

  it('sin WhatsApp no queda ningún paso pendiente', () => {
    // WhatsApp dejó de ser un paso: es un canal más, y la reserva por la página
    // pública no lo necesita. Viaja en la respuesta para poder sugerirlo.
    const status = resolveOnboardingStatus(
      snapshot({ whatsappConnected: false }),
    );

    expect(status.nextStep).toBeNull();
    expect(status.readyForBookings).toBe(true);
    expect(status.whatsappConnected).toBe(false);
  });
});
