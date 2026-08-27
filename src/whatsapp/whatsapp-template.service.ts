import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  buildTemplateCreatePayload,
  templateDefinition,
  TemplateKey,
} from './template-registry';
import { TemplateStatus, toTemplateStatus } from './template-status';

export type TemplateState = {
  key: TemplateKey;
  name: string;
  language: string;
  status: TemplateStatus;
  /** Estado crudo de Meta, para poder explicar un `UNAVAILABLE`. */
  metaStatus: string | null;
};

/** Nombre viejo, mientras queden consumidores que lo usen. */
export type ReminderTemplateState = TemplateState;

type MetaTemplate = {
  name?: string;
  language?: string;
  status?: string;
};

type MetaError = {
  error?: { message?: string; code?: number; error_subcode?: number };
};

/**
 * Aprovisionamiento de las plantillas de Polaria en la WABA de un negocio.
 *
 * Una plantilla pertenece a una WABA, así que cada negocio necesita las suyas, y se
 * crean solas al conectar WhatsApp para que no dependa de que alguien se acuerde.
 *
 * El aprovisionamiento es **idempotente por consulta**: primero pregunta si la
 * plantilla ya existe y recién crea si no está. Eso resuelve dos cosas a la vez. La
 * primera es obvia: reconectar no genera duplicados. La segunda es que esa consulta
 * funciona como prueba de permisos —si el token no tiene
 * `whatsapp_business_management`, falla ahí, antes de intentar escribir.
 *
 * Antes esto sabía de una sola plantilla y la tenía cableada. Ahora recibe la clave:
 * lo que cambia entre una y otra —nombre, cuerpo, botones— vive en
 * `template-registry`, y acá queda solo cómo se habla con Graph.
 */
@Injectable()
export class WhatsAppTemplateService {
  private readonly logger = new Logger(WhatsAppTemplateService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Deja una plantilla lista o en revisión, y devuelve en qué estado quedó.
   *
   * Nunca lanza: es un paso accesorio del onboarding. Si Meta rechaza la llamada,
   * el negocio queda conectado y sin esa plantilla, que es mucho mejor que un
   * signup fallido. El error crudo va al log para poder diagnosticarlo.
   */
  async provisionTemplate(params: {
    tenantId: string;
    wabaId: string;
    accessToken: string;
    key: TemplateKey;
  }): Promise<TemplateState> {
    const { tenantId, wabaId, accessToken, key } = params;

    const existing = await this.findTemplate({ wabaId, accessToken, key });

    if (existing) {
      this.logger.log(
        `Plantilla ya existente (tenantId=${tenantId}, key=${key}, metaStatus=${String(existing.status)}).`,
      );
      return this.toState(key, existing.status);
    }

    try {
      const created = await this.graph<MetaTemplate & { id?: string }>(
        `/${wabaId}/message_templates`,
        accessToken,
        buildTemplateCreatePayload(key, this.clientBaseUrl()),
      );

      this.logger.log(
        `Plantilla creada (tenantId=${tenantId}, key=${key}, metaStatus=${String(created.status)}).`,
      );

      // Meta suele devolver `PENDING`; si no informa estado, se asume revisión.
      return this.toState(key, created.status ?? 'PENDING');
    } catch (error: unknown) {
      this.logger.error(
        `No se pudo crear la plantilla (tenantId=${tenantId}, key=${key}): ${describeError(error)}`,
      );
      return this.toState(key, null);
    }
  }

  /**
   * Relee el estado desde Meta.
   *
   * Hace falta porque la aprobación es asincrónica: el webhook
   * `message_template_status_update` es el camino normal, y esto es la red por si
   * ese campo no está suscrito en el App Dashboard. Sin una de las dos, la
   * plantilla se quedaría en `PENDING` para siempre y los mensajes nunca saldrían.
   */
  async refreshTemplate(params: {
    tenantId: string;
    wabaId: string;
    accessToken: string;
    key: TemplateKey;
  }): Promise<TemplateState | null> {
    const template = await this.findTemplate(params);
    return template ? this.toState(params.key, template.status) : null;
  }

  private async findTemplate(params: {
    wabaId: string;
    accessToken: string;
    key: TemplateKey;
  }): Promise<MetaTemplate | null> {
    const { wabaId, accessToken, key } = params;
    const definition = templateDefinition(key);

    try {
      const response = await this.graph<{ data?: MetaTemplate[] }>(
        `/${wabaId}/message_templates?fields=name,language,status&name=${definition.name}`,
        accessToken,
      );

      // El filtro `name` de Meta es por coincidencia parcial, así que se compara el
      // nombre exacto y el idioma: una plantilla homónima en otro idioma no sirve
      // para enviar en el nuestro.
      return (
        response.data?.find(
          (template) =>
            template.name === definition.name &&
            template.language === definition.language,
        ) ?? null
      );
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo consultar la plantilla (wabaId=${wabaId}, key=${key}): ${describeError(error)}`,
      );
      return null;
    }
  }

  private toState(
    key: TemplateKey,
    metaStatus: string | null | undefined,
  ): TemplateState {
    const definition = templateDefinition(key);

    return {
      key,
      name: definition.name,
      language: definition.language,
      status: toTemplateStatus(metaStatus),
      metaStatus: metaStatus ?? null,
    };
  }

  /**
   * Base del panel, para el botón de enlace de las plantillas que lo llevan.
   *
   * Sin ella el botón se omite: una plantilla con un enlace roto se aprueba igual, y
   * el profesional descubre el problema al tocarlo.
   */
  private clientBaseUrl(): string | undefined {
    return this.configService.get<string>('CLIENT_BASE_URL') ?? undefined;
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
