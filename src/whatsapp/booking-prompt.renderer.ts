import { Injectable, Logger } from '@nestjs/common';

import type {
  BookingChannelLimits,
  BookingPrompt,
} from '../booking-flow/booking-flow.types';
import {
  planBookingPrompt,
  planToTranscript,
  type BookingMessagePlan,
} from './booking-prompt.plan';
import { WHATSAPP_LIMITS } from './types/outgoing-message.type';
import type {
  OutgoingButton,
  OutgoingListRow,
  WhatsAppCredentials,
} from './types/outgoing-message.type';
import { WhatsAppSenderService } from './whatsapp-sender.service';

/**
 * Capacidades del canal nativo, que el flujo necesita para paginar.
 *
 * Es el único lugar donde el número 10 de WhatsApp cruza hacia el flujo. Ni el
 * cálculo de disponibilidad ni la máquina de estados lo conocen.
 */
export const NATIVE_CHANNEL_LIMITS: BookingChannelLimits = {
  maxOptionsPerPrompt: WHATSAPP_LIMITS.LIST_ROWS_MAX_COUNT,
};

/** Mensaje efectivamente entregado, para registrar en el historial. */
export type RenderedBookingMessage = {
  content: string;
  raw: {
    source: 'booking-flow';
    prompt: BookingPrompt['kind'];
    component: BookingMessagePlan['component'];
    options?: Array<{ id: string; title: string; description?: string }>;
    metaMessageId?: string;
  };
};

/**
 * Traduce un `BookingPrompt` a componentes nativos de WhatsApp.
 *
 * Solo mapea: no decide transiciones, no valida selecciones y no construye
 * identificadores. Los `selectionId` vienen ya codificados en cada opción y se
 * copian tal cual, que es lo que garantiza que vuelvan intactos.
 *
 * Devuelve los mensajes **entregados**. Un envío fallido no se informa, para que
 * el historial no muestre mensajes que el cliente nunca recibió.
 */
@Injectable()
export class BookingPromptRenderer {
  private readonly logger = new Logger(BookingPromptRenderer.name);

  constructor(private readonly whatsAppSenderService: WhatsAppSenderService) {}

  async render(params: {
    credentials: WhatsAppCredentials;
    to: string;
    prompt: BookingPrompt;
  }): Promise<RenderedBookingMessage[]> {
    const { credentials, to, prompt } = params;

    const delivered: RenderedBookingMessage[] = [];

    for (const plan of planBookingPrompt(prompt)) {
      const metaMessageId = await this.send(credentials, to, plan);
      if (metaMessageId === null) {
        this.logger.warn(
          `No se pudo entregar un mensaje del flujo (to=${to}, prompt=${plan.kind}).`,
        );
        continue;
      }

      delivered.push({
        content: planToTranscript(plan),
        raw: {
          source: 'booking-flow',
          prompt: plan.kind,
          component: plan.component,
          options:
            plan.component === 'text'
              ? undefined
              : plan.options.map((option) => ({
                  id: option.selectionId,
                  title: option.title,
                  description: option.description,
                })),
          metaMessageId,
        },
      });
    }

    return delivered;
  }

  /** Devuelve el id asignado por Meta, o `null` si el envío falló. */
  private async send(
    credentials: WhatsAppCredentials,
    to: string,
    plan: BookingMessagePlan,
  ): Promise<string | undefined | null> {
    switch (plan.component) {
      case 'text': {
        const result = await this.whatsAppSenderService.sendText(credentials, {
          to,
          body: plan.body,
        });
        return result.ok ? result.metaMessageId : null;
      }

      case 'buttons': {
        const result = await this.whatsAppSenderService.sendButtons(
          credentials,
          { to, body: plan.body, buttons: plan.options.map(toButton) },
        );
        return result.ok ? result.metaMessageId : null;
      }

      case 'list': {
        const result = await this.whatsAppSenderService.sendList(credentials, {
          to,
          body: plan.body,
          buttonText: plan.buttonText,
          sections: [{ rows: plan.options.map(toListRow) }],
        });
        return result.ok ? result.metaMessageId : null;
      }
    }
  }
}

function toButton(option: {
  selectionId: string;
  title: string;
}): OutgoingButton {
  return { id: option.selectionId, title: option.title };
}

/**
 * Reparte las filas en secciones según su encabezado.
 *
 * Una lista de cosas del mismo tipo va en una sola sección sin título, que es lo
 * que WhatsApp dibuja como una lista común y es el caso de casi todos los pasos.
 *
 * El paso de horarios es el que necesita esto: ahí conviven horarios concretos y
 * ratos del día, y mezclados sin separar se leen como tres horas seguidas de
 * unas filas raras. Con el encabezado arriba de cada bloque, cada fila se
 * entiende por dónde está.
 *
 * El orden de las secciones es el de aparición de las opciones, así que quien
 * arma el paso decide qué va primero sin saber nada de secciones. Las filas sin
 * encabezado —"Ver otros días", "Cancelar"— quedan en una sección propia al
 * final.
 *
 * **Con más de una sección, WhatsApp exige título en todas**: una sin título
 * hace que rechace el mensaje entero con "Title is required for multiple
 * sections", y el cliente se queda sin respuesta. Por eso la de las filas
 * fijas recibe uno cuando no está sola.
 */
function toListRow(option: {
  selectionId: string;
  title: string;
  description?: string;
}): OutgoingListRow {
  return {
    id: option.selectionId,
    title: option.title,
    description: option.description,
  };
}
