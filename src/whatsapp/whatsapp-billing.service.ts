import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Tenant } from '../tenants/entities/tenant.entity';
import {
  normalizeBillingCurrency,
  WhatsappBillingStatus,
  type BillingErrorCandidate,
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
 * Se sale de `ACTION_REQUIRED` porque el negocio dice que lo configuró, no porque
 * nosotros lo hayamos comprobado: se vuelve a `UNKNOWN`, que no bloquea, y la
 * confirmación real es que el próximo envío no falle.
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
   * Hace dos cosas que conviene no confundir:
   *
   * 1. **Le cree**: el estado vuelve a `UNKNOWN` y se borra el mensaje viejo de Meta,
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

    // Sin conexión no hay a quién preguntarle; el estado igual se limpia, porque un
    // `ACTION_REQUIRED` de una WABA que ya no está conectada no describe nada.
    const currency =
      wabaId && accessToken
        ? normalizeBillingCurrency(await this.readCurrency(wabaId, accessToken))
        : null;

    await this.tenants.update(tenant.id, {
      whatsappBillingStatus: WhatsappBillingStatus.UNKNOWN,
      whatsappBillingReason: null,
      whatsappBillingCurrency: currency,
      whatsappBillingCheckedAt: new Date(),
    });

    this.logger.log(
      `Facturación de WhatsApp re-comprobada a pedido del negocio (tenantId=${tenantId}, currency=${String(currency)}).`,
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
   * La moneda de la WABA, si Meta la expone.
   *
   * Devuelve `null` ante cualquier problema —campo ausente, permiso faltante, red
   * caída— y se registra en `log` y no en `warn`: que no podamos leerlo es esperable
   * y no es una falla del negocio. Tampoco tiene consecuencias, porque este valor no
   * decide el estado.
   */
  private async readCurrency(
    wabaId: string,
    accessToken: string,
  ): Promise<string | null> {
    const version =
      this.configService.get<string>('META_GRAPH_VERSION') ??
      this.configService.get<string>('WHATSAPP_GRAPH_VERSION') ??
      'v21.0';

    try {
      const response = await fetch(
        `https://graph.facebook.com/${version}/${wabaId}?fields=currency`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      const data = (await response.json()) as {
        currency?: string;
        error?: { message?: string; code?: number };
      };

      if (!response.ok) {
        this.logger.log(
          `No se pudo leer la moneda de la WABA (wabaId=${wabaId}): ${String(data.error?.message)}`,
        );
        return null;
      }

      return data.currency ?? null;
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
