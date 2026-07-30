import { Injectable, Logger } from '@nestjs/common';

import type {
  BookingChannelLimits,
  BookingOption,
  BookingPrompt,
  BookingSummary,
} from '../booking-flow/booking-flow.types';
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

/**
 * Traduce un `BookingPrompt` a componentes nativos de WhatsApp.
 *
 * Solo mapea: no decide transiciones, no valida selecciones y no construye
 * identificadores. Los `selectionId` vienen ya codificados en cada opción y se
 * copian tal cual, que es lo que garantiza que vuelvan intactos.
 */
@Injectable()
export class BookingPromptRenderer {
  private readonly logger = new Logger(BookingPromptRenderer.name);

  constructor(private readonly whatsAppSenderService: WhatsAppSenderService) {}

  async render(params: {
    credentials: WhatsAppCredentials;
    to: string;
    prompt: BookingPrompt;
  }): Promise<void> {
    const { credentials, to, prompt } = params;

    switch (prompt.kind) {
      case 'ASK_WHEN':
        await this.sendButtons(
          credentials,
          to,
          '¿Para cuándo quieres tu turno?',
          prompt.options,
        );
        return;

      case 'ASK_DATE':
        await this.sendList(credentials, to, {
          body: 'Elige el día que prefieras.',
          buttonText: 'Elegir día',
          options: prompt.options,
        });
        return;

      case 'ASK_SERVICE':
        await this.sendList(credentials, to, {
          body: `¿Qué servicio quieres para el ${formatDate(prompt.date)}?`,
          buttonText: 'Ver servicios',
          options: prompt.options,
        });
        return;

      case 'ASK_STAFF':
        await this.sendList(credentials, to, {
          body: '¿Con quién quieres atenderte?',
          buttonText: 'Ver profesionales',
          options: prompt.options,
        });
        return;

      case 'ASK_SLOT':
        await this.sendList(credentials, to, {
          body: `Estos son los horarios disponibles para el ${formatDate(prompt.date)}.`,
          buttonText: 'Ver horarios',
          options: prompt.options,
        });
        return;

      case 'CONFIRM':
        await this.sendButtons(
          credentials,
          to,
          `Revisa tu turno antes de confirmarlo:\n\n${describeSummary(prompt.summary)}`,
          prompt.options,
        );
        return;

      case 'COMPLETED':
        await this.sendText(
          credentials,
          to,
          `¡Listo! Tu turno quedó agendado.\n\n${describeSummary(prompt.summary)}`,
        );
        return;

      case 'CANCELLED':
        await this.sendText(
          credentials,
          to,
          'Cancelé la reserva. Si quieres agendar en otro momento, escríbeme y empezamos de nuevo.',
        );
        return;

      case 'EXPIRED':
        await this.sendText(
          credentials,
          to,
          'Pasó un rato sin actividad, así que cerré la reserva que habíamos empezado. Escríbeme y la retomamos desde el principio.',
        );
        return;

      case 'STALE':
        await this.sendText(
          credentials,
          to,
          'Esa opción ya no está vigente. Escríbeme para empezar una reserva nueva.',
        );
        return;

      case 'NO_AVAILABILITY':
        await this.sendText(credentials, to, noAvailabilityText(prompt.scope));
        return;

      case 'SLOT_TAKEN':
        // Dos mensajes a propósito: primero la explicación, después la lista nueva.
        // Meterlo todo en el body de la lista haría que el aviso pase inadvertido.
        await this.sendText(
          credentials,
          to,
          'Justo tomaron ese horario mientras elegías. Estos son los que quedan disponibles.',
        );
        await this.sendList(credentials, to, {
          body: `Horarios disponibles para el ${formatDate(prompt.date)}.`,
          buttonText: 'Ver horarios',
          options: prompt.options,
        });
        return;

      case 'FROZEN':
        // Congelamiento: el texto libre no se interpreta, pero tampoco se ignora.
        await this.sendText(
          credentials,
          to,
          'Estamos completando tu reserva. Usa las opciones del mensaje para continuar, o toca "Cancelar" si prefieres dejarlo.',
        );
        await this.render({ credentials, to, prompt: prompt.current });
        return;

      case 'NONE':
        return;
    }
  }

  private sendText(
    credentials: WhatsAppCredentials,
    to: string,
    body: string,
  ): Promise<unknown> {
    return this.whatsAppSenderService.sendText(credentials, { to, body });
  }

  private sendButtons(
    credentials: WhatsAppCredentials,
    to: string,
    body: string,
    options: BookingOption[],
  ): Promise<unknown> {
    return this.whatsAppSenderService.sendButtons(credentials, {
      to,
      body,
      buttons: options.map(toButton),
    });
  }

  private async sendList(
    credentials: WhatsAppCredentials,
    to: string,
    params: { body: string; buttonText: string; options: BookingOption[] },
  ): Promise<void> {
    // Un paso sin opciones sería un componente vacío que WhatsApp rechaza. No
    // debería ocurrir (el flujo devuelve NO_AVAILABILITY en ese caso), pero es
    // preferible avisar por texto que dejar al cliente sin respuesta.
    if (params.options.length === 0) {
      this.logger.error(
        `Prompt sin opciones para ${to}; se responde por texto.`,
      );
      await this.sendText(
        credentials,
        to,
        'No encontré opciones disponibles en este momento. Escríbeme e intentamos de nuevo.',
      );
      return;
    }

    await this.whatsAppSenderService.sendList(credentials, {
      to,
      body: params.body,
      buttonText: params.buttonText,
      sections: [{ rows: params.options.map(toListRow) }],
    });
  }
}

function toButton(option: BookingOption): OutgoingButton {
  return { id: option.selectionId, title: option.title };
}

function toListRow(option: BookingOption): OutgoingListRow {
  return {
    id: option.selectionId,
    title: option.title,
    description: option.description,
  };
}

function noAvailabilityText(scope: 'DATE' | 'SERVICE' | 'STAFF'): string {
  switch (scope) {
    case 'DATE':
      return 'No quedan turnos disponibles para ese día. Escríbeme y probamos con otra fecha.';
    case 'STAFF':
      return 'Ese profesional no tiene horarios disponibles ese día. Escríbeme y buscamos otra opción.';
    case 'SERVICE':
      return 'No quedan horarios disponibles para ese servicio ese día. Escríbeme y buscamos otra opción.';
  }
}

/** `YYYY-MM-DD` a "viernes 31 de julio", sin depender de la zona horaria. */
function formatDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;

  const [year, month, day] = date.split('-').map(Number);
  const reference = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(reference);
}

function describeSummary(summary: BookingSummary): string {
  const time = new Intl.DateTimeFormat('es-AR', {
    timeZone: summary.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(summary.startTime);

  const lines = [
    `Servicio: ${summary.serviceName} (${summary.serviceDurationMinutes} min)`,
    `Día: ${formatDate(summary.date)}`,
    `Hora: ${time}`,
  ];

  if (summary.staffName) lines.push(`Profesional: ${summary.staffName}`);

  return lines.join('\n');
}
