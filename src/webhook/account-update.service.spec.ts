import { AccountUpdateService } from './account-update.service';
import type { Tenant } from '../tenants/entities/tenant.entity';
import type { TenantsService } from '../tenants/tenants.service';
import type { JsonObject } from './webhook-meta.util';

const CONNECTED_AT = new Date('2026-08-10T10:00:00.000Z');

/** Segundos, como los manda Meta en `entry[].time`. */
const secondsAt = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

const buildTenant = (overrides: Partial<Tenant> = {}): Tenant =>
  ({
    id: 'tenant-1',
    whatsappWabaId: 'waba-1',
    whatsappAccessToken: 'token-vigente',
    whatsappConnectedAt: CONNECTED_AT,
    ...overrides,
  }) as Tenant;

const setup = (tenant: Tenant | null) => {
  const setWhatsappUnavailability = jest.fn().mockResolvedValue(undefined);
  const findByWhatsappWabaId = jest
    .fn()
    .mockImplementation((wabaId: string) =>
      Promise.resolve(
        tenant && tenant.whatsappWabaId === wabaId ? tenant : null,
      ),
    );

  const service = new AccountUpdateService({
    findByWhatsappWabaId,
    setWhatsappUnavailability,
  } as unknown as TenantsService);

  return { service, setWhatsappUnavailability, findByWhatsappWabaId };
};

const partnerRemoved = (reason?: string): JsonObject => ({
  event: 'PARTNER_REMOVED',
  waba_info: { waba_id: 'waba-1', owner_business_id: 'business-1' },
  ...(reason ? { disconnection_info: { reason, initiated_by: 'USER' } } : {}),
});

describe('AccountUpdateService', () => {
  it('marca la conexión como caída con el motivo que informó Meta', async () => {
    const { service, setWhatsappUnavailability } = setup(buildTenant());

    await service.handle({
      entryId: 'waba-1',
      entryTime: secondsAt('2026-08-12T10:00:00.000Z'),
      value: partnerRemoved('CHANGE_NUMBER'),
    });

    expect(setWhatsappUnavailability).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      since: new Date('2026-08-12T10:00:00.000Z'),
      reason: 'CHANGE_NUMBER',
    });
  });

  it('sin disconnection_info guarda el evento como motivo', async () => {
    const { service, setWhatsappUnavailability } = setup(buildTenant());

    await service.handle({
      entryId: 'waba-1',
      entryTime: secondsAt('2026-08-12T10:00:00.000Z'),
      value: partnerRemoved(),
    });

    expect(setWhatsappUnavailability).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'PARTNER_REMOVED' }),
    );
  });

  it('resuelve el tenant por entry.id cuando no viene waba_info', async () => {
    const { service, setWhatsappUnavailability } = setup(buildTenant());

    await service.handle({
      entryId: 'waba-1',
      entryTime: secondsAt('2026-08-12T10:00:00.000Z'),
      value: { event: 'ACCOUNT_OFFBOARDED' },
    });

    expect(setWhatsappUnavailability).toHaveBeenCalledTimes(1);
  });

  it('ACCOUNT_RECONNECTED limpia la marca sin tocar las credenciales', async () => {
    const { service, setWhatsappUnavailability } = setup(buildTenant());

    await service.handle({
      entryId: 'waba-1',
      entryTime: secondsAt('2026-08-12T10:00:00.000Z'),
      value: { event: 'ACCOUNT_RECONNECTED' },
    });

    expect(setWhatsappUnavailability).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      since: null,
      reason: null,
    });
  });

  it('descarta un evento anterior a la conexión vigente', async () => {
    // Un reintento de Meta de antes de que el negocio reconectara: aplicarlo
    // tumbaría una conexión sana.
    const { service, setWhatsappUnavailability } = setup(buildTenant());

    await service.handle({
      entryId: 'waba-1',
      entryTime: secondsAt('2026-08-09T10:00:00.000Z'),
      value: partnerRemoved('CHANGE_NUMBER'),
    });

    expect(setWhatsappUnavailability).not.toHaveBeenCalled();
  });

  it('ignora al tenant que ya no tiene conexión activa', async () => {
    const { service, setWhatsappUnavailability } = setup(
      buildTenant({ whatsappAccessToken: undefined }),
    );

    await service.handle({
      entryId: 'waba-1',
      entryTime: secondsAt('2026-08-12T10:00:00.000Z'),
      value: partnerRemoved('CHANGE_NUMBER'),
    });

    expect(setWhatsappUnavailability).not.toHaveBeenCalled();
  });

  it('no toca el estado ante eventos de otra naturaleza', async () => {
    const { service, setWhatsappUnavailability, findByWhatsappWabaId } =
      setup(buildTenant());

    await service.handle({
      entryId: 'waba-1',
      entryTime: secondsAt('2026-08-12T10:00:00.000Z'),
      value: { event: 'ACCOUNT_VIOLATION' },
    });

    expect(setWhatsappUnavailability).not.toHaveBeenCalled();
    expect(findByWhatsappWabaId).not.toHaveBeenCalled();
  });

  it('descarta el evento de una WABA que no es de nadie', async () => {
    const { service, setWhatsappUnavailability } = setup(null);

    await service.handle({
      entryId: 'waba-ajena',
      entryTime: secondsAt('2026-08-12T10:00:00.000Z'),
      value: { event: 'PARTNER_REMOVED' },
    });

    expect(setWhatsappUnavailability).not.toHaveBeenCalled();
  });
});
