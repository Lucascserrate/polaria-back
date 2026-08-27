import { TemplateStatusJob } from './template-status.job';
import {
  PROVISION_RETRY_HOURS,
  type WhatsAppTemplatesRepository,
} from './whatsapp-templates.repository';
import type { WhatsAppTemplateService } from './whatsapp-template.service';
import { TemplateKey, TEMPLATE_KEYS } from './template-registry';
import { TemplateStatus } from './template-status';
import type { Tenant } from '../tenants/entities/tenant.entity';

/*
 * El aprovisionamiento de negocios ya conectados se prueba a nivel de job porque es
 * ahí donde está la decisión: qué se considera "le falta la plantilla", cuándo se
 * reintenta un fallo y qué se guarda en cada caso.
 */

const tenant = (id: string, overrides: Partial<Tenant> = {}): Tenant =>
  ({
    id,
    whatsappWabaId: 'waba-1',
    whatsappAccessToken: 'token-1',
    ...overrides,
  }) as unknown as Tenant;

type SaveCall = {
  tenantId: string;
  templateKey: TemplateKey;
  status: TemplateStatus;
};

type ProvisionCall = { tenantId: string; key: TemplateKey };

const build = (params: {
  missing: Partial<Record<TemplateKey, Tenant[]>>;
  provisionResult?: TemplateStatus;
}) => {
  const saves: SaveCall[] = [];
  const provisions: ProvisionCall[] = [];
  const queries: Array<{ templateKey: TemplateKey; retryBefore: Date }> = [];

  const templates = {
    findConnectedMissing: (args: {
      templateKey: TemplateKey;
      retryBefore: Date;
      take: number;
    }) => {
      queries.push(args);
      return Promise.resolve(params.missing[args.templateKey] ?? []);
    },
    save: (call: SaveCall) => {
      saves.push(call);
      return Promise.resolve();
    },
    findPending: () => Promise.resolve([]),
  } as unknown as WhatsAppTemplatesRepository;

  const service = {
    provisionTemplate: (args: { tenantId: string; key: TemplateKey }) => {
      provisions.push({ tenantId: args.tenantId, key: args.key });
      return Promise.resolve({
        key: args.key,
        name: 'polaria_staff_appointment_new',
        language: 'es',
        status: params.provisionResult ?? TemplateStatus.PENDING,
        metaStatus: 'PENDING',
      });
    },
  } as unknown as WhatsAppTemplateService;

  return {
    job: new TemplateStatusJob(templates, service),
    saves,
    provisions,
    queries,
  };
};

describe('aprovisionamiento de negocios ya conectados', () => {
  /*
   * El caso que motivó esto: un negocio que conectó WhatsApp antes de que existiera
   * la plantilla de avisos, y que no debería tener que desconectar y reconectar.
   */
  it('crea la plantilla que le falta a un negocio conectado', async () => {
    const { job, provisions, saves } = build({
      missing: { [TemplateKey.STAFF_ALERT_NEW]: [tenant('t-1')] },
    });

    await job.run();

    expect(provisions).toEqual([
      { tenantId: 't-1', key: TemplateKey.STAFF_ALERT_NEW },
    ]);
    expect(saves).toEqual([
      expect.objectContaining({
        tenantId: 't-1',
        templateKey: TemplateKey.STAFF_ALERT_NEW,
        status: TemplateStatus.PENDING,
      }),
    ]);
  });

  it('no toca a quien no le falta ninguna', async () => {
    const { job, provisions, saves } = build({ missing: {} });

    await job.run();

    expect(provisions).toEqual([]);
    expect(saves).toEqual([]);
  });

  it('pregunta por todas las plantillas del registro, no solo por una', async () => {
    const { job, queries } = build({ missing: {} });

    await job.run();

    // Las cuatro del registro: la de recordatorios y las tres del equipo.
    expect(queries.map((q) => q.templateKey).sort()).toEqual(
      [...TEMPLATE_KEYS].sort(),
    );
  });

  /*
   * El fallo también se guarda, y es lo que crea el punto de apoyo para esperar
   * antes de reintentar. Sin la fila, la consulta lo devolvería en cada pasada y el
   * job machacaría a Meta cada media hora para siempre.
   */
  it('guarda el fallo para poder espaciar los reintentos', async () => {
    const { job, saves } = build({
      missing: { [TemplateKey.STAFF_ALERT_NEW]: [tenant('t-1')] },
      provisionResult: TemplateStatus.NOT_CREATED,
    });

    await job.run();

    expect(saves).toEqual([
      expect.objectContaining({
        tenantId: 't-1',
        status: TemplateStatus.NOT_CREATED,
      }),
    ]);
  });

  it('la ventana de reintento es la declarada', async () => {
    const { job, queries } = build({ missing: {} });
    const before = Date.now();

    await job.run();

    const expected = before - PROVISION_RETRY_HOURS * 60 * 60_000;
    // Holgura de un segundo: el job toma su propio `Date.now()`.
    expect(queries[0].retryBefore.getTime()).toBeGreaterThanOrEqual(
      expected - 1000,
    );
    expect(queries[0].retryBefore.getTime()).toBeLessThanOrEqual(
      expected + 1000,
    );
  });

  /*
   * Una credencial guardada como la cadena `'null'` pasa el filtro SQL de "no nulo y
   * distinto de vacío", y mandarla a Meta produce `Authorization: Bearer null`. Ver
   * `readStoredCredential`.
   */
  it('descarta al negocio cuya credencial está corrupta', async () => {
    const { job, provisions } = build({
      missing: {
        [TemplateKey.STAFF_ALERT_NEW]: [
          tenant('t-sucio', { whatsappAccessToken: 'null' }),
          tenant('t-limpio'),
        ],
      },
    });

    await job.run();

    expect(provisions.map((p) => p.tenantId)).toEqual(['t-limpio']);
  });

  /*
   * No puede escribir en `tenants`: la conexión del negocio no se toca. Lo garantiza
   * el tipo —el job no recibe repositorio de tenants— y este test lo deja dicho.
   */
  it('no necesita escribir en la conexión del negocio', () => {
    const { job } = build({ missing: {} });

    expect(Object.keys(job)).not.toContain('tenants');
  });
});
