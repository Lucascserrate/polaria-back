import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Tenant } from '../tenants/entities/tenant.entity';
import {
  normalizeBillingCurrency,
  readHealthVerdict,
  WhatsappBillingStatus,
  type BillingErrorCandidate,
  type WabaHealthStatus,
} from './billing-status';
import { readStoredCredential } from './utils/stored-credential.util';

/**
 * Recuerda si Meta bloqueó los envíos de un negocio por facturación.
 *
 * **Una sola fuente decide el estado: Meta.** Cuando contesta `131042` por el webhook
 * de estados está diciendo textualmente que el mensaje no salió por facturación, y
 * eso marca `ACTION_REQUIRED`.
 *
 * La sonda a la WABA —que lee la moneda configurada— **no decide nada**. Llegó a
 * hacerlo y era un error: la moneda es una de las causas del `131042`, no la única,
 * así que verla configurada no permite concluir que el negocio pueda enviar. Peor
 * todavía, ese falso verde pisaba el diagnóstico de Meta y lo borraba. Hoy la moneda
 * se guarda como dato de diagnóstico y el estado no la mira.
 *
 * De los dos estados que bloquean —`PENDING_SETUP`, porque falta el paso que Meta
 * exige, y `ACTION_REQUIRED`, porque Meta ya rechazó— se sale igual: el negocio dice
 * que lo resolvió y se le cree. Queda en `UNKNOWN`, que no bloquea, y la confirmación
 * real es que el próximo envío no falle.
 */
@Injectable()
export class WhatsAppBillingService {
  private readonly logger = new Logger(WhatsAppBillingService.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    private readonly configService: ConfigService,
  ) {}

  /**
   * El negocio afirma que ya configuró la facturación en Meta.
   *
   * Es la única salida de los dos estados que bloquean, y hace dos cosas que conviene
   * no confundir:
   *
   * 1. **Le cree**: el estado pasa a `UNKNOWN` y se borra el mensaje viejo de Meta,
   *    que describía una situación que el negocio dice haber resuelto. Si no la
   *    resolvió, el próximo envío fallido lo vuelve a marcar con un mensaje fresco.
   * 2. **Anota lo que la sonda ve**, sin darle voto. La moneda queda guardada para
   *    diagnóstico; no cambia el estado ni en un sentido ni en el otro.
   *
   * Nunca lanza: es una comprobación, no una operación.
   */
  async recheck(tenantId: string): Promise<void> {
    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    if (!tenant) return;

    const wabaId = readStoredCredential(tenant.whatsappWabaId);
    const accessToken = readStoredCredential(tenant.whatsappAccessToken);

    const probe =
      wabaId && accessToken ? await this.probe(wabaId, accessToken) : null;

    const verdict = readHealthVerdict(probe?.health);

    /*
     * La sonda solo puede endurecer el estado, nunca ablandarlo.
     *
     * Si Meta dice `BLOCKED`, eso gana por encima de lo que afirme el negocio: es
     * Meta quien decide si el mensaje sale. Si no dice nada, se acepta la afirmación
     * del negocio y queda en `UNKNOWN`, que no bloquea —no porque hayamos comprobado
     * que está todo bien, sino porque no tenemos con qué desmentirlo—.
     *
     * Que `AVAILABLE` no desbloquee por sí solo es deliberado: la documentación de
     * Meta no dice que el problema de facturación se refleje en `health_status`, así
     * que tratarlo como permiso sería repetir el falso verde que ya tuvimos con
     * `currency`.
     */
    await this.tenants.update(tenant.id, {
      whatsappBillingStatus: verdict.blocked
        ? WhatsappBillingStatus.ACTION_REQUIRED
        : WhatsappBillingStatus.UNKNOWN,
      whatsappBillingReason: verdict.reason
        ? verdict.reason.slice(0, 512)
        : null,
      whatsappBillingCurrency: normalizeBillingCurrency(probe?.currency),
      whatsappBillingCheckedAt: new Date(),
    });

    /*
     * Se registra el `health_status` crudo a propósito, y no solo el veredicto.
     *
     * Es la única forma de averiguar si este campo refleja los problemas de
     * facturación, que es lo que decidiría si algún día podemos dejar de pedirle al
     * negocio que confirme y comprobarlo nosotros. Hoy no lo sabemos.
     */
    this.logger.log(
      `Facturación re-comprobada (tenantId=${tenantId}, blocked=${String(
        verdict.blocked,
      )}, currency=${String(probe?.currency)}, health=${JSON.stringify(
        probe?.health ?? null,
      )}).`,
    );
  }

  /**
   * Registra que Meta rechazó un envío por facturación.
   *
   * Lo llama el webhook de estados. Guarda el texto de Meta tal como vino: es lo que
   * se le muestra al negocio, y explicarlo con palabras nuestras sería traducir un
   * mensaje que Meta ya escribió mejor.
   */
  async markActionRequired(params: {
    tenantId: string;
    error: BillingErrorCandidate;
  }): Promise<void> {
    const tenant = await this.tenants.findOne({
      where: { id: params.tenantId },
    });
    if (!tenant) return;

    await this.tenants.update(tenant.id, {
      whatsappBillingStatus: WhatsappBillingStatus.ACTION_REQUIRED,
      whatsappBillingReason: params.error.detail
        ? params.error.detail.slice(0, 512)
        : null,
      whatsappBillingCheckedAt: new Date(),
    });

    this.logger.warn(
      `Facturación de WhatsApp requiere atención (tenantId=${params.tenantId}, code=${String(params.error.code)}).`,
    );
  }

  /**
   * Le pregunta a Meta por la salud y la moneda de la WABA.
   *
   * `health_status` es lo que decide —contesta literalmente `can_send_message`— y
   * `currency` va en la misma llamada como dato de diagnóstico, que es para lo único
   * que sirve.
   *
   * Devuelve `null` ante cualquier problema —permiso faltante, red caída— y se
   * registra en `log` y no en `warn`: que no podamos leerlo es esperable, y no tiene
   * consecuencias porque un fallo acá no cambia el estado del negocio.
   */
  private async probe(
    wabaId: string,
    accessToken: string,
  ): Promise<{
    health: WabaHealthStatus | null;
    currency: string | null;
  } | null> {
    const version =
      this.configService.get<string>('META_GRAPH_VERSION') ??
      this.configService.get<string>('WHATSAPP_GRAPH_VERSION') ??
      'v21.0';

    try {
      const response = await fetch(
        `https://graph.facebook.com/${version}/${wabaId}?fields=health_status,currency`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      const data = (await response.json()) as {
        health_status?: WabaHealthStatus;
        currency?: string;
        error?: { message?: string; code?: number };
      };

      if (!response.ok) {
        this.logger.log(
          `No se pudo consultar la WABA (wabaId=${wabaId}): ${String(data.error?.message)}`,
        );
        return null;
      }

      return {
        health: data.health_status ?? null,
        currency: data.currency ?? null,
      };
    } catch (error: unknown) {
      this.logger.log(
        `No se pudo consultar la facturación (wabaId=${wabaId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}
