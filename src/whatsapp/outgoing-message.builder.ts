import {
  WHATSAPP_LIMITS,
  WhatsAppMessageBuildError,
  type SendButtonsInput,
  type SendFlowInput,
  type SendListInput,
  type SendTemplateInput,
  type SendTextInput,
} from './types/outgoing-message.type';

export type BuiltMessage = {
  payload: Record<string, unknown>;
  /** Ajustes silenciosos aplicados (recortes de texto). El emisor los loguea. */
  warnings: string[];
};

/**
 * Construcción de los payloads de la Cloud API.
 *
 * Dos políticas distintas ante un exceso:
 *
 * - **Cantidades e identificadores: se lanza.** Once filas en una lista, o un
 *   `id` más largo de lo admitido, son bugs del renderizador. Recortar un `id`
 *   rompería la premisa del flujo guiado, que es que el identificador vuelve
 *   intacto y es válido por construcción.
 * - **Texto visible: se recorta y se avisa.** Un título largo degrada la
 *   presentación, pero cancelar una reserva por eso es peor.
 */

export function buildTextPayload(input: SendTextInput): BuiltMessage {
  const body = input.body.trim();
  if (body.length === 0) {
    throw new WhatsAppMessageBuildError('El texto a enviar está vacío.');
  }

  return {
    payload: {
      type: 'text',
      text: {
        preview_url: input.previewUrl ?? false,
        body,
      },
    },
    warnings: [],
  };
}

export function buildButtonsPayload(input: SendButtonsInput): BuiltMessage {
  const warnings: string[] = [];

  const body = requireNonEmpty(input.body, 'body');
  const { buttons } = input;

  if (buttons.length === 0) {
    throw new WhatsAppMessageBuildError(
      'Un mensaje con botones requiere al menos un botón.',
    );
  }
  if (buttons.length > WHATSAPP_LIMITS.BUTTONS_MAX_COUNT) {
    throw new WhatsAppMessageBuildError(
      `WhatsApp admite hasta ${WHATSAPP_LIMITS.BUTTONS_MAX_COUNT} botones y se recibieron ${buttons.length}.`,
    );
  }

  const ids = new Set<string>();
  for (const button of buttons) {
    requireValidId(button.id, WHATSAPP_LIMITS.BUTTON_ID_MAX, 'botón');
    if (ids.has(button.id)) {
      throw new WhatsAppMessageBuildError(
        `Los ids de los botones deben ser únicos y "${button.id}" está repetido.`,
      );
    }
    ids.add(button.id);
  }

  return {
    payload: {
      type: 'interactive',
      interactive: {
        type: 'button',
        ...buildHeader(input.header, warnings),
        body: {
          text: clamp(
            body,
            WHATSAPP_LIMITS.BUTTONS_BODY_MAX,
            'el cuerpo del mensaje',
            warnings,
          ),
        },
        ...buildFooter(input.footer, warnings),
        action: {
          buttons: buttons.map((button) => ({
            type: 'reply',
            reply: {
              id: button.id,
              title: clamp(
                requireNonEmpty(button.title, `título del botón ${button.id}`),
                WHATSAPP_LIMITS.BUTTON_TITLE_MAX,
                `el título del botón "${button.id}"`,
                warnings,
              ),
            },
          })),
        },
      },
    },
    warnings,
  };
}

/**
 * Mensaje que abre un WhatsApp Flow.
 *
 * `flow_action` va en `data_exchange` porque la primera pantalla necesita datos
 * del servidor —el catálogo de servicios—, así que Meta llama al endpoint con
 * `INIT` antes de mostrar nada. Con `navigate` habría que precargar esos datos
 * en el propio mensaje.
 */
/**
 * Mensaje de plantilla aprobada.
 *
 * A diferencia del resto, acá no se construye el texto: el cuerpo ya está
 * aprobado en la WABA y solo se completan sus variables. Por eso lo único que se
 * valida es la forma —cantidad de botones, variables no vacías— y no la
 * longitud de un body que no controlamos.
 */
export function buildTemplatePayload(input: SendTemplateInput): BuiltMessage {
  const warnings: string[] = [];

  const name = requireNonEmpty(input.name, 'nombre de la plantilla');
  const languageCode = requireNonEmpty(
    input.languageCode,
    'idioma de la plantilla',
  );

  const bodyParameters = input.bodyParameters ?? [];
  const quickReplyPayloads = input.quickReplyPayloads ?? [];

  if (
    quickReplyPayloads.length > WHATSAPP_LIMITS.TEMPLATE_QUICK_REPLY_MAX_COUNT
  ) {
    throw new WhatsAppMessageBuildError(
      `Una plantilla admite hasta ${WHATSAPP_LIMITS.TEMPLATE_QUICK_REPLY_MAX_COUNT} botones de respuesta rápida y se recibieron ${quickReplyPayloads.length}.`,
    );
  }

  quickReplyPayloads.forEach((payload, index) => {
    // El payload es lo que vuelve para identificar la cita: si viene vacío, el
    // botón llega sin forma de saber sobre qué actuar.
    requireNonEmpty(payload, `payload del botón ${index}`);
  });

  const components: Array<Record<string, unknown>> = [];

  if (bodyParameters.length > 0) {
    components.push({
      type: 'body',
      parameters: bodyParameters.map((value, index) => ({
        type: 'text',
        text: clamp(
          sanitizeTemplateParameter(
            requireNonEmpty(value, `variable ${index + 1} del cuerpo`),
          ),
          WHATSAPP_LIMITS.TEMPLATE_PARAMETER_MAX,
          `la variable ${index + 1} del cuerpo`,
          warnings,
        ),
      })),
    });
  }

  quickReplyPayloads.forEach((payload, index) => {
    components.push({
      type: 'button',
      sub_type: 'quick_reply',
      // Meta espera el índice como cadena, y posicional respecto de los botones
      // tal como quedaron aprobados en la plantilla.
      index: String(index),
      parameters: [{ type: 'payload', payload }],
    });
  });

  /*
   * El sufijo del botón de enlace, si la plantilla lo declara.
   *
   * Su índice es la cantidad de botones de respuesta rápida porque el de enlace va
   * después en la plantilla aprobada, y el índice es posicional. Si algún día una
   * plantilla los pone en otro orden, esto tiene que recibir el índice en lugar de
   * calcularlo.
   */
  if (input.urlButtonSuffix) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: String(quickReplyPayloads.length),
      parameters: [
        {
          type: 'text',
          text: sanitizeTemplateParameter(
            requireNonEmpty(
              input.urlButtonSuffix,
              'sufijo del botón de enlace',
            ),
          ),
        },
      ],
    });
  }

  return {
    payload: {
      type: 'template',
      template: {
        name,
        language: { code: languageCode },
        ...(components.length > 0 ? { components } : {}),
      },
    },
    warnings,
  };
}

/**
 * Deja una variable de plantilla en una sola línea.
 *
 * Meta rechaza los parámetros que contienen saltos de línea, tabulaciones o
 * varios espacios seguidos, y lo hace con un error que no dice cuál de las
 * variables fue. Un nombre de servicio cargado con un salto de línea de más
 * alcanzaría para que ningún recordatorio de ese negocio saliera nunca.
 */
function sanitizeTemplateParameter(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function buildFlowPayload(input: SendFlowInput): BuiltMessage {
  const warnings: string[] = [];

  const body = requireNonEmpty(input.body, 'body');
  requireNonEmpty(input.flowId, 'flowId');
  requireNonEmpty(input.flowToken, 'flowToken');

  return {
    payload: {
      type: 'interactive',
      interactive: {
        type: 'flow',
        ...buildHeader(input.header, warnings),
        body: {
          text: clamp(
            body,
            WHATSAPP_LIMITS.BUTTONS_BODY_MAX,
            'el cuerpo del mensaje',
            warnings,
          ),
        },
        ...buildFooter(input.footer, warnings),
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: WHATSAPP_LIMITS.FLOW_MESSAGE_VERSION,
            flow_id: input.flowId,
            flow_token: input.flowToken,
            flow_cta: clamp(
              requireNonEmpty(input.cta, 'cta'),
              WHATSAPP_LIMITS.FLOW_CTA_MAX,
              'la etiqueta del botón del Flow',
              warnings,
            ),
            flow_action: 'data_exchange',
          },
        },
      },
    },
    warnings,
  };
}

export function buildListPayload(input: SendListInput): BuiltMessage {
  const warnings: string[] = [];

  const body = requireNonEmpty(input.body, 'body');
  const { sections } = input;

  if (sections.length === 0) {
    throw new WhatsAppMessageBuildError(
      'Una lista requiere al menos una sección.',
    );
  }
  if (sections.length > WHATSAPP_LIMITS.LIST_SECTIONS_MAX_COUNT) {
    throw new WhatsAppMessageBuildError(
      `WhatsApp admite hasta ${WHATSAPP_LIMITS.LIST_SECTIONS_MAX_COUNT} secciones y se recibieron ${sections.length}.`,
    );
  }

  const totalRows = sections.reduce(
    (total, section) => total + section.rows.length,
    0,
  );
  if (totalRows === 0) {
    throw new WhatsAppMessageBuildError(
      'Una lista requiere al menos una fila.',
    );
  }
  if (totalRows > WHATSAPP_LIMITS.LIST_ROWS_MAX_COUNT) {
    throw new WhatsAppMessageBuildError(
      `WhatsApp admite hasta ${WHATSAPP_LIMITS.LIST_ROWS_MAX_COUNT} filas sumando todas las secciones y se recibieron ${totalRows}.`,
    );
  }

  const ids = new Set<string>();
  for (const section of sections) {
    for (const row of section.rows) {
      requireValidId(row.id, WHATSAPP_LIMITS.LIST_ROW_ID_MAX, 'fila');
      if (ids.has(row.id)) {
        throw new WhatsAppMessageBuildError(
          `Los ids de las filas deben ser únicos y "${row.id}" está repetido.`,
        );
      }
      ids.add(row.id);
    }
  }

  return {
    payload: {
      type: 'interactive',
      interactive: {
        type: 'list',
        ...buildHeader(input.header, warnings),
        body: {
          text: clamp(
            body,
            WHATSAPP_LIMITS.LIST_BODY_MAX,
            'el cuerpo de la lista',
            warnings,
          ),
        },
        ...buildFooter(input.footer, warnings),
        action: {
          button: clamp(
            requireNonEmpty(input.buttonText, 'buttonText'),
            WHATSAPP_LIMITS.LIST_BUTTON_TEXT_MAX,
            'la etiqueta del botón de la lista',
            warnings,
          ),
          sections: sections.map((section) => ({
            ...(section.title
              ? {
                  title: clamp(
                    section.title,
                    WHATSAPP_LIMITS.LIST_SECTION_TITLE_MAX,
                    `el título de la sección "${section.title}"`,
                    warnings,
                  ),
                }
              : {}),
            rows: section.rows.map((row) => ({
              id: row.id,
              title: clamp(
                requireNonEmpty(row.title, `título de la fila ${row.id}`),
                WHATSAPP_LIMITS.LIST_ROW_TITLE_MAX,
                `el título de la fila "${row.id}"`,
                warnings,
              ),
              ...(row.description
                ? {
                    description: clamp(
                      row.description,
                      WHATSAPP_LIMITS.LIST_ROW_DESCRIPTION_MAX,
                      `la descripción de la fila "${row.id}"`,
                      warnings,
                    ),
                  }
                : {}),
            })),
          })),
        },
      },
    },
    warnings,
  };
}

function buildHeader(
  header: string | undefined,
  warnings: string[],
): Record<string, unknown> {
  const trimmed = header?.trim();
  if (!trimmed) return {};
  return {
    header: {
      type: 'text',
      text: clamp(
        trimmed,
        WHATSAPP_LIMITS.HEADER_TEXT_MAX,
        'el encabezado',
        warnings,
      ),
    },
  };
}

function buildFooter(
  footer: string | undefined,
  warnings: string[],
): Record<string, unknown> {
  const trimmed = footer?.trim();
  if (!trimmed) return {};
  return {
    footer: {
      text: clamp(trimmed, WHATSAPP_LIMITS.FOOTER_TEXT_MAX, 'el pie', warnings),
    },
  };
}

function clamp(
  value: string,
  max: number,
  label: string,
  warnings: string[],
): string {
  if (value.length <= max) return value;
  warnings.push(
    `Se recortó ${label} de ${value.length} a ${max} caracteres para cumplir el límite de WhatsApp.`,
  );
  return value.slice(0, max);
}

function requireNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new WhatsAppMessageBuildError(
      `El campo "${label}" no puede estar vacío.`,
    );
  }
  return trimmed;
}

function requireValidId(id: string, max: number, label: string): void {
  if (id.trim().length === 0) {
    throw new WhatsAppMessageBuildError(
      `El id de ${label} no puede estar vacío.`,
    );
  }
  if (id.length > max) {
    throw new WhatsAppMessageBuildError(
      `El id de ${label} "${id}" supera el límite de ${max} caracteres. Los ids no se recortan porque deben volver intactos.`,
    );
  }
}
