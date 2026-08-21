import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  buildReminderTemplateCreatePayload,
  REMINDER_TEMPLATE_LANGUAGE,
  REMINDER_TEMPLATE_NAME,
  ReminderTemplateStatus,
  toReminderTemplateStatus,
} from './reminder-template';

export type ReminderTemplateState = {
  name: string;
  language: string;
  status: ReminderTemplateStatus;
  /** Estado crudo de Meta, para poder explicar un `UNAVAILABLE`. */
  metaStatus: string | null;
};

type MetaTemplate = {
  name?: string;
  language?: string;
  status?: string;
};

type MetaError = {
  error?: { message?: string; code?: number; error_subcode?: number };
};

/**
 * Aprovisionamiento de la plantilla de recordatorios en la WABA de un negocio.
 *
 * Una plantilla pertenece a una WABA, así que cada negocio necesita la suya, y
 * se crea sola al conectar WhatsApp para que no dependa de que alguien se
 * acuerde de hacerlo.
 *
 * El aprovisionamiento es **idempotente por consulta**: primero pregunta si la
 * plantilla ya existe y recién crea si no está. Eso resuelve dos cosas a la vez.
 * La primera es obvia: reconectar no genera duplicados. La segunda es que esa
 * consulta funciona como prueba de permisos —si el token no tiene
 * `whatsapp_business_management`, falla ahí, antes de intentar escribir.
 */
@Injectable()
export class WhatsAppTemplateService {
  private readonly logger = new Logger(WhatsAppTemplateService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Deja la plantilla lista o en revisión, y devuelve en qué estado quedó.
   *
   * Nunca lanza: es un paso accesorio del onboarding. Si Meta rechaza la
   * llamada, el negocio queda conectado y sin recordatorios, que es mucho mejor
   * que un signup fallido. El error crudo va al log para poder diagnosticarlo.
   */
  async provisionReminderTemplate(params: {
    tenantId: string;
    wabaId: string;
    accessToken: string;
  }): Promise<ReminderTemplateState> {
    const { tenantId, wabaId, accessToken } = params;

    const existing = await this.findReminderTemplate({ wabaId, accessToken });

    if (existing) {
      this.logger.log(
        `Plantilla de recordatorios ya existente (tenantId=${tenantId}, wabaId=${wabaId}, metaStatus=${String(existing.status)}).`,
      );
      return this.toState(existing.status);
    }

    try {
      const created = await this.graph<MetaTemplate & { id?: string }>(
        `/${wabaId}/message_templates`,
        accessToken,
        buildReminderTemplateCreatePayload(),
      );

      this.logger.log(
        `Plantilla de recordatorios creada (tenantId=${tenantId}, wabaId=${wabaId}, metaStatus=${String(created.status)}).`,
      );

      // Meta suele devolver `PENDING`; si no informa estado, se asume revisión.
      return this.toState(created.status ?? 'PENDING');
    } catch (error: unknown) {
      this.logger.error(
        `No se pudo crear la plantilla de recordatorios (tenantId=${tenantId}, wabaId=${wabaId}): ${describeError(error)}`,
      );
      return this.toState(null);
    }
  }

  /**
   * Relee el estado desde Meta.
   *
   * Hace falta porque la aprobación es asincrónica: el webhook
   * `message_template_status_update` es el camino normal, y esto es la red por
   * si ese campo no está suscrito en el App Dashboard. Sin una de las dos, la
   * plantilla se quedaría en `PENDING` para siempre y los recordatorios nunca
   * saldrían.
   */
  async refreshReminderTemplate(params: {
    tenantId: string;
    wabaId: string;
    accessToken: string;
  }): Promise<ReminderTemplateState | null> {
    const template = await this.findReminderTemplate(params);
    return template ? this.toState(template.status) : null;
  }

  private async findReminderTemplate(params: {
    wabaId: string;
    accessToken: string;
  }): Promise<MetaTemplate | null> {
    const { wabaId, accessToken } = params;

    try {
      const response = await this.graph<{ data?: MetaTemplate[] }>(
        `/${wabaId}/message_templates?fields=name,language,status&name=${REMINDER_TEMPLATE_NAME}`,
        accessToken,
      );

      // El filtro `name` de Meta es por coincidencia parcial, así que se compara
      // el nombre exacto y el idioma: una plantilla homónima en otro idioma no
      // sirve para enviar en el nuestro.
      return (
        response.data?.find(
          (template) =>
            template.name === REMINDER_TEMPLATE_NAME &&
            template.language === REMINDER_TEMPLATE_LANGUAGE,
        ) ?? null
      );
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo consultar la plantilla de recordatorios (wabaId=${wabaId}): ${describeError(error)}`,
      );
      return null;
    }
  }

  private toState(
    metaStatus: string | null | undefined,
  ): ReminderTemplateState {
    return {
      name: REMINDER_TEMPLATE_NAME,
      language: REMINDER_TEMPLATE_LANGUAGE,
      status: toReminderTemplateStatus(metaStatus),
      metaStatus: metaStatus ?? null,
    };
  }

  private async graph<T>(
    path: string,
    accessToken: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const graphVersion =
      this.configService.get<string>('META_GRAPH_VERSION') ??
      this.configService.get<string>('WHATSAPP_GRAPH_VERSION') ??
      'v21.0';

    const response = await fetch(
      `https://graph.facebook.com/${graphVersion}${path}`,
      {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      },
    );

    const data = (await response.json()) as T & MetaError;

    if (!response.ok) {
      const details = data.error;
      throw new Error(
        `Graph ${response.status}: ${details?.message ?? 'sin mensaje'} (code=${String(details?.code)}, subcode=${String(details?.error_subcode)})`,
      );
    }

    return data;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
