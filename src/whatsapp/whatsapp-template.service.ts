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

/**
 * El error de Graph, completo.
 *
 * Antes esto capturaba solo `message`, `code` y `error_subcode`, y eso fue un
 * problema real de diagnóstico: `message` es siempre el genérico —"Invalid
 * parameter"— y lo que dice **qué** parámetro está mal es `error_user_msg`. Dos
 * rechazos de plantilla se investigaron a ciegas por leer el campo equivocado.
 *
 * `fbtrace_id` va también porque es lo primero que pide el soporte de Meta cuando el
 * mensaje no alcanza.
 */
type MetaError = {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    type?: string;
    error_user_title?: string;
    error_user_msg?: string;
    fbtrace_id?: string;
    error_data?: unknown;
  };
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

    const payload = buildTemplateCreatePayload(key, this.clientBaseUrl());

    try {
      const created = await this.graph<MetaTemplate & { id?: string }>(
        `/${wabaId}/message_templates`,
        accessToken,
        payload,
      );

      this.logger.log(
        `Plantilla creada (tenantId=${tenantId}, key=${key}, metaStatus=${String(created.status)}).`,
      );

      // Meta suele devolver `PENDING`; si no informa estado, se asume revisión.
      return this.toState(key, created.status ?? 'PENDING');
    } catch (error: unknown) {
      /*
       * Se registra el payload junto con el error.
       *
       * Son las dos mitades del diagnóstico y por separado no alcanzan: el error dice
       * qué objeta Meta y el payload dice qué le mandamos. Dos rechazos se
       * investigaron reconstruyendo el payload a mano porque el log solo tenía una de
       * las dos.
       */
      this.logger.error(
        `No se pudo crear la plantilla (tenantId=${tenantId}, key=${key}): ${describeError(error)}`,
      );
      this.logger.error(
        `Payload rechazado (key=${key}): ${JSON.stringify(payload)}`,
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

    /*
     * Se lee como texto y después se parsea, no `response.json()` directo.
     *
     * Un error de Graph no siempre viene en JSON —un 502 del borde devuelve HTML— y
     * `json()` lanzaría un `SyntaxError` que sepulta el error real. Con el texto a
     * mano, lo peor que puede pasar es que se registre crudo.
     */
    const rawText = await response.text();

    let parsed: (T & MetaError) | null = null;
    try {
      parsed = JSON.parse(rawText) as T & MetaError;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      throw new Error(describeGraphError(response.status, parsed, rawText));
    }

    if (!parsed) {
      throw new Error(
        `Graph ${response.status}: respuesta ilegible: ${rawText.slice(0, 500)}`,
      );
    }

    return parsed;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * El error de Graph en una línea que sirva para arreglarlo.
 *
 * Lleva `error_user_msg` adelante porque es el único campo que nombra el problema
 * concreto: `message` dice "Invalid parameter" en todos los rechazos de plantilla, y
 * el subcode no está documentado. Si no viene ninguno de los campos conocidos, se
 * registra el cuerpo crudo antes que perderlo.
 */
function describeGraphError(
  status: number,
  parsed: MetaError | null,
  rawText: string,
): string {
  const error = parsed?.error;

  if (!error) {
    return `Graph ${status}: ${rawText.slice(0, 500) || 'sin cuerpo'}`;
  }

  const partes = [
    error.error_user_msg && `detalle="${error.error_user_msg}"`,
    error.error_user_title && `titulo="${error.error_user_title}"`,
    error.message && `mensaje="${error.message}"`,
    `code=${String(error.code)}`,
    `subcode=${String(error.error_subcode)}`,
    error.type && `type=${error.type}`,
    error.fbtrace_id && `fbtrace=${error.fbtrace_id}`,
    error.error_data !== undefined &&
      `error_data=${JSON.stringify(error.error_data).slice(0, 300)}`,
  ].filter(Boolean);

  return `Graph ${status}: ${partes.join(' ')}`;
}
