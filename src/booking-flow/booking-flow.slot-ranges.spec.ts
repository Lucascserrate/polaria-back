import { BookingFlowService } from './booking-flow.service';
import {
  BookingSessionState,
  encodeSlotRange,
  RESERVED_VALUES,
  StaffPreference,
  type BookingOption,
  type BookingPrompt,
} from './booking-flow.types';
import { encodeSelection } from './booking-payload.codec';
import type { BookingSession } from './entities/booking-session.entity';

/**
 * El paso de horarios cuando hay demasiados para una pantalla.
 *
 * Existe por un error que las pruebas de las piezas no podían ver: los tramos se
 * ofrecían bien, pero el validador de la máquina sólo admitía un horario o "Ver
 * otros días", así que tocar un tramo devolvía "esa opción ya no está vigente".
 * Cada pieza estaba bien y el camino completo no funcionaba.
 *
 * Por eso esto ejercita el orquestador de punta a punta —desde el id que manda
 * WhatsApp hasta el prompt que se responde— con los colaboradores simulados.
 */

const TENANT = 'tenant-1';
const CLIENT = 'client-1';
const SERVICE = 'svc-corte';
const TOKEN = 'tok-1';
const TIMEZONE = 'America/La_Paz';

/** Lista nativa de WhatsApp. */
const LIMITS = { maxOptionsPerPrompt: 10 };

const at = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 8, 24, hour + 4, minute));

/** Los horarios de un día largo: de 09:00 a 21:45, cada cuarto de hora. */
const slotsOfTheDay = () =>
  Array.from({ length: 52 }, (_, i) => ({
    startTime: at(9, i * 15),
    endTime: at(10, i * 15),
    eligibleStaffIds: ['staff-1'],
    eligibleStaffIdsBySegment: [['staff-1']],
    planIndex: 0,
  }));

function buildFlow(session: BookingSession) {
  /** La sesión viva, que los dobles mutan como lo haría la base. */
  let current = session;

  /** Lo que la base haría: guardar el parche y subir la versión del paso. */
  const save = (patch: Partial<BookingSession>): Promise<BookingSession> => {
    current = { ...current, ...patch, stepVersion: current.stepVersion + 1 };
    return Promise.resolve(current);
  };

  const bookingSessionService = {
    findActive: () => Promise.resolve(current),
    advance: (params: {
      state: BookingSessionState;
      selection?: Partial<BookingSession>;
    }) => save({ ...params.selection, state: params.state }),
    reissue: (params: { selection?: Partial<BookingSession> }) =>
      save({ ...params.selection }),
    markMetaMessageProcessed: () => Promise.resolve(current),
  };

  const flow = new BookingFlowService(
    bookingSessionService as never,
    {
      getAvailableSlots: jest.fn().mockResolvedValue(slotsOfTheDay()),
    } as never,
    {} as never,
    { findOneByTenant: jest.fn().mockResolvedValue({ id: SERVICE }) } as never,
    {} as never,
    { findOne: jest.fn().mockResolvedValue(null) } as never,
    { findOne: jest.fn().mockResolvedValue({ timezone: TIMEZONE }) } as never,
  );

  return { flow, session: () => current };
}

const sessionInSlotStep = (): BookingSession =>
  ({
    id: 'sess-1',
    tenantId: TENANT,
    clientId: CLIENT,
    token: TOKEN,
    state: BookingSessionState.ASK_SLOT,
    stepVersion: 3,
    selectedDate: '2026-09-24',
    selectedServiceId: SERVICE,
    staffPreference: StaffPreference.ANY,
    selectedStaffId: null,
    selectedRangeStart: null,
    selectedRangeEnd: null,
    pageOffset: 0,
    expiresAt: new Date(Date.now() + 10 * 60_000),
  }) as unknown as BookingSession;

/** El id que WhatsApp devuelve al tocar una fila. */
const idFor = (session: BookingSession, value: string) =>
  encodeSelection({
    token: session.token,
    stepVersion: session.stepVersion,
    state: session.state,
    value,
  });

const optionsOf = (prompt: BookingPrompt): BookingOption[] =>
  'options' in prompt ? prompt.options : [];

/** Las filas que no son un horario suelto: los tramos. */
const rangeRows = (prompt: BookingPrompt) =>
  optionsOf(prompt).filter((o) => o.description?.includes('horario'));

describe('elegir un tramo del día por WhatsApp', () => {
  it('ofrece tramos cuando los horarios no entran en la pantalla', async () => {
    const { flow } = buildFlow(sessionInSlotStep());

    const prompt = await flow.handleSelection({
      tenantId: TENANT,
      clientId: CLIENT,
      rawSelectionId: idFor(sessionInSlotStep(), RESERVED_VALUES.ALL_TIMES),
      limits: LIMITS,
    });

    expect(prompt.kind).toBe('ASK_SLOT');
    expect(rangeRows(prompt).length).toBeGreaterThan(0);
    expect(optionsOf(prompt).length).toBeLessThanOrEqual(
      LIMITS.maxOptionsPerPrompt,
    );
  });

  /**
   * El error real: tocar un tramo devolvía "esa opción ya no está vigente".
   */
  it('al tocar un tramo muestra sus horarios, no un mensaje de vencido', async () => {
    const start = sessionInSlotStep();
    const { flow, session } = buildFlow(start);

    // Primero se dibuja la pantalla, para tomar un tramo tal como se ofreció.
    const screen = await flow.handleSelection({
      tenantId: TENANT,
      clientId: CLIENT,
      rawSelectionId: idFor(start, RESERVED_VALUES.ALL_TIMES),
      limits: LIMITS,
    });

    const tramo = rangeRows(screen)[0];
    expect(tramo).toBeDefined();

    const prompt = await flow.handleSelection({
      tenantId: TENANT,
      clientId: CLIENT,
      rawSelectionId: tramo.selectionId,
      limits: LIMITS,
    });

    expect(prompt.kind).toBe('ASK_SLOT');
    expect(prompt.kind === 'ASK_SLOT' && prompt.hasSlots).toBe(true);

    // Y la sesión recuerda el tramo, no cuál de ellos era.
    expect(session().selectedRangeStart).toBeInstanceOf(Date);
    expect(session().selectedRangeEnd).toBeInstanceOf(Date);
  });

  it('dentro del tramo sólo ofrece sus horarios, y todos entran', async () => {
    const start = sessionInSlotStep();
    const { flow } = buildFlow(start);

    const screen = await flow.handleSelection({
      tenantId: TENANT,
      clientId: CLIENT,
      rawSelectionId: idFor(start, RESERVED_VALUES.ALL_TIMES),
      limits: LIMITS,
    });

    const prompt = await flow.handleSelection({
      tenantId: TENANT,
      clientId: CLIENT,
      rawSelectionId: rangeRows(screen)[0].selectionId,
      limits: LIMITS,
    });

    const options = optionsOf(prompt);
    expect(options.length).toBeLessThanOrEqual(LIMITS.maxOptionsPerPrompt);
    // Ningún tramo adentro de un tramo, y sin "ver más": todo entra.
    expect(rangeRows(prompt)).toHaveLength(0);
    expect(options.some((o) => o.title === 'Ver otros horarios')).toBe(true);
  });

  it('"Ver otros horarios" devuelve a la lista de tramos', async () => {
    const start = sessionInSlotStep();
    const { flow, session } = buildFlow(start);

    const screen = await flow.handleSelection({
      tenantId: TENANT,
      clientId: CLIENT,
      rawSelectionId: idFor(start, RESERVED_VALUES.ALL_TIMES),
      limits: LIMITS,
    });

    await flow.handleSelection({
      tenantId: TENANT,
      clientId: CLIENT,
      rawSelectionId: rangeRows(screen)[0].selectionId,
      limits: LIMITS,
    });

    const back = await flow.handleSelection({
      tenantId: TENANT,
      clientId: CLIENT,
      rawSelectionId: idFor(session(), RESERVED_VALUES.ALL_TIMES),
      limits: LIMITS,
    });

    expect(rangeRows(back).length).toBeGreaterThan(0);
    expect(session().selectedRangeStart).toBeNull();
  });

  it('elegir un horario del tramo lleva a confirmar', async () => {
    const start = sessionInSlotStep();
    const { flow, session } = buildFlow(start);

    const screen = await flow.handleSelection({
      tenantId: TENANT,
      clientId: CLIENT,
      rawSelectionId: idFor(start, RESERVED_VALUES.ALL_TIMES),
      limits: LIMITS,
    });

    const inRange = await flow.handleSelection({
      tenantId: TENANT,
      clientId: CLIENT,
      rawSelectionId: rangeRows(screen)[0].selectionId,
      limits: LIMITS,
    });

    const horario = optionsOf(inRange).find(
      (o) => o.title !== 'Ver otros horarios' && o.title !== 'Cancelar',
    );
    expect(horario).toBeDefined();

    const prompt = await flow.handleSelection({
      tenantId: TENANT,
      clientId: CLIENT,
      rawSelectionId: horario!.selectionId,
      limits: LIMITS,
    });

    expect(prompt.kind).not.toBe('STALE');
    expect(session().selectedSlotStart).toBeInstanceOf(Date);
  });

  /*
   * Un canal sin tope de filas —el Dropdown de un Flow— no necesita tramos: los
   * muestra todos.
   */
  it('sin tope de opciones no agrupa nada', async () => {
    const start = sessionInSlotStep();
    const { flow } = buildFlow(start);

    const prompt = await flow.handleSelection({
      tenantId: TENANT,
      clientId: CLIENT,
      rawSelectionId: idFor(start, RESERVED_VALUES.ALL_TIMES),
    });

    expect(rangeRows(prompt)).toHaveLength(0);
  });

  it('un tramo de otra sesión no se acepta', async () => {
    const start = sessionInSlotStep();
    const { flow } = buildFlow(start);

    const ajeno = encodeSelection({
      token: 'otro-token',
      stepVersion: start.stepVersion,
      state: start.state,
      value: encodeSlotRange(at(13), at(15)),
    });

    const prompt = await flow.handleSelection({
      tenantId: TENANT,
      clientId: CLIENT,
      rawSelectionId: ajeno,
      limits: LIMITS,
    });

    expect(prompt.kind).toBe('STALE');
  });
});
