import { Injectable, Logger } from '@nestjs/common';

import { AppointmentsService } from '../appointments/appointments.service';
import type { Appointment } from '../appointments/entities/appointment.entity';
import { AssistantSessionService } from '../assistant/services/assistant-session.service';
import {
  AppointmentAction,
  buildAppointmentGoneText,
  buildAppointmentListPrompt,
  buildCancelConfirmPrompt,
  buildCancelledText,
  buildDismissedText,
  buildSingleAppointmentPrompt,
  decodeAppointmentAction,
  type AppointmentPrompt,
  type AppointmentSelection,
  type AppointmentSummary,
} from '../booking-flow/appointment-actions';
import { BookingFlowService } from '../booking-flow/booking-flow.service';
import type { BookingPrompt } from '../booking-flow/booking-flow.types';
import { detectBookingTrigger } from '../booking-flow/booking-trigger';
import { BookingSessionService } from '../booking-flow/booking-session.service';
import { ConversationControlService } from '../conversations/conversation-control.service';
import type { Conversation } from '../conversations/entities/conversation.entity';
import {
  buildHandoffAcknowledgement,
  buildBookedMenu,
  buildWelcomeMenu,
  describeUpcomingAppointment,
  decodeMenuAction,
  shouldSendWelcomeMenu,
  WELCOME_MENU_SOURCE,
  WelcomeMenuAction,
} from '../conversations/welcome-menu';
import { TenantsService } from '../tenants/tenants.service';
import {
  BookingPromptRenderer,
  NATIVE_CHANNEL_LIMITS,
} from '../whatsapp/booking-prompt.renderer';
import {
  IncomingMessageKind,
  type IncomingWhatsAppMessage,
} from '../whatsapp/types/incoming-message.type';
import {
  WHATSAPP_LIMITS,
  type WhatsAppCredentials,
} from '../whatsapp/types/outgoing-message.type';
import { readStoredCredential } from '../whatsapp/utils/stored-credential.util';
import { WhatsAppSenderService } from '../whatsapp/whatsapp-sender.service';
import { ConversationRecorderService } from './conversation-recorder.service';

const UNSUPPORTED_MESSAGE_REPLY =
  'Por ahora solo puedo leer mensajes de texto. Escríbeme y te ayudo.';

/**
 * Reduce una cita a lo que hace falta para mostrarla y operarla.
 *
 * Un servicio por reserva, así que se toma el primer segmento; el nombre del
 * profesional puede faltar si la relación no vino cargada.
 */
function toAppointmentSummary(appointment: Appointment): AppointmentSummary {
  const segment = appointment.services?.[0];

  return {
    id: appointment.id,
    serviceName: segment?.service?.name ?? 'Turno',
    staffName: segment?.staff?.name ?? null,
    startTime:
      appointment.startTime instanceof Date
        ? appointment.startTime
        : new Date(appointment.startTime as unknown as string),
  };
}

/** Desenlace que el endpoint del Flow devuelve al cerrar. */
function readFlowStatus(response: Record<string, unknown> | null): string {
  const status = response?.status;
  return typeof status === 'string' ? status : 'unknown';
}

/**
 * Mensaje de cierre según cómo terminó el Flow.
 *
 * El formulario ya mostró lo suyo, pero se confirma igual por chat: es el hilo
 * que el cliente vuelve a mirar cuando quiere recordar su turno.
 */
function flowClosingText(status: string): string {
  switch (status) {
    case 'completed':
      return '¡Listo! Tu turno quedó agendado. Cualquier cosa escribime por acá.';
    case 'slot_taken':
      return 'Justo tomaron ese horario mientras confirmabas. Escribime "reservar" y buscamos otro.';
    case 'incomplete':
      return 'Quedó a medias la reserva. Escribime "reservar" y la retomamos.';
    default:
      return 'Cerré el formulario sin agendar nada. Escribime "reservar" cuando quieras.';
  }
}

/**
 * Reparto de los mensajes entrantes entre el flujo guiado y el asistente.
 *
 * Es donde vive la regla central del producto: **si hay una reserva en curso, el
 * texto libre no llega a la IA**. Y una respuesta interactiva nunca llega a la IA,
 * haya sesión o no.
 *
 * La IA conserva un único poder sobre las reservas: detectar la intención y
 * arrancar el flujo. No aporta ningún dato.
 */
/**
 * Por qué Polaria se queda callada ante un mensaje entrante.
 *
 * Los dos apagados guardan y no responden, pero tienen alcance y dueño
 * distintos, y el log necesita distinguirlos para que una barbería que apagó el
 * bot no parezca un traspaso masivo a atención humana.
 */
enum QuietReason {
  /** El negocio apagó Polaria entera desde Configuración. */
  BOT_OFF = 'BOT_OFF',
  /** Esta conversación está en manos de una persona. */
  HANDOFF = 'HANDOFF',
}

@Injectable()
export class InboundMessageService {
  private readonly logger = new Logger(InboundMessageService.name);

  constructor(
    private readonly assistantSessionService: AssistantSessionService,
    private readonly bookingFlowService: BookingFlowService,
    private readonly bookingPromptRenderer: BookingPromptRenderer,
    private readonly whatsAppSenderService: WhatsAppSenderService,
    private readonly conversationRecorder: ConversationRecorderService,
    private readonly conversationControl: ConversationControlService,
    private readonly tenantsService: TenantsService,
    private readonly bookingSessionService: BookingSessionService,
    private readonly appointmentsService: AppointmentsService,
  ) {}

  async handle(params: {
    tenantId: string;
    credentials: WhatsAppCredentials;
    message: IncomingWhatsAppMessage;
  }): Promise<void> {
    const { tenantId, credentials, message } = params;

    switch (message.kind) {
      case IncomingMessageKind.BUTTON_REPLY:
      case IncomingMessageKind.LIST_REPLY:
        await this.handleSelection({
          tenantId,
          credentials,
          message,
          selectionId: message.selectionId,
        });
        return;

      case IncomingMessageKind.TEXT:
        await this.handleText({
          tenantId,
          credentials,
          message,
          text: message.text,
        });
        return;

      case IncomingMessageKind.FLOW_REPLY:
        await this.handleFlowReply({ tenantId, credentials, message });
        return;

      case IncomingMessageKind.UNSUPPORTED:
        await this.handleUnsupported({ tenantId, credentials, message });
        return;
    }
  }

  /**
   * Respuesta a una lista o botón. Nunca llega a la IA.
   *
   * Hay dos familias de respuestas interactivas y se distinguen por el prefijo del
   * id: las del menú (`menu|…`) y las del flujo de reserva (`b1|…`). El flujo
   * decide por sí solo si su interacción es válida, obsoleta o ajena, así que para
   * esa rama no hay comprobación previa acá.
   */
  private async handleSelection(params: {
    tenantId: string;
    credentials: WhatsAppCredentials;
    message: IncomingWhatsAppMessage;
    selectionId: string;
  }): Promise<void> {
    const { tenantId, credentials, message, selectionId } = params;

    const { client, conversation } =
      await this.assistantSessionService.getOrCreateSession({
        tenantId,
        phone: message.from,
        clientName: message.contactName ?? undefined,
      });

    const quiet = await this.quietReason({ tenantId, conversation });
    if (quiet) {
      await this.recordAndStayQuiet({
        tenantId,
        conversation,
        client,
        message,
        reason: quiet,
      });
      return;
    }

    const menuAction = decodeMenuAction(selectionId);
    if (menuAction) {
      await this.handleMenuAction({
        tenantId,
        credentials,
        message,
        conversation,
        clientId: client.id,
        action: menuAction,
      });
      return;
    }

    const appointmentSelection = decodeAppointmentAction(selectionId);
    if (appointmentSelection) {
      await this.handleAppointmentAction({
        tenantId,
        credentials,
        message,
        conversation,
        clientId: client.id,
        selection: appointmentSelection,
      });
      return;
    }

    const prompt = await this.bookingFlowService.handleSelection({
      tenantId,
      clientId: client.id,
      rawSelectionId: selectionId,
      metaMessageId: message.metaMessageId,
      limits: NATIVE_CHANNEL_LIMITS,
    });

    // `NONE` significa que el flujo reconoció una reentrega del mismo webhook.
    // Registrar la selección otra vez duplicaría una línea del historial que ya
    // existe, así que se descarta entera.
    if (prompt.kind === 'NONE') return;

    await this.conversationRecorder.recordSelection({
      tenantId,
      conversationId: conversation.id,
      clientId: client.id,
      message,
    });

    await this.renderAndRecord({
      tenantId,
      credentials,
      conversationId: conversation.id,
      clientId: client.id,
      to: message.from,
      prompt,
    });
  }

  private async handleText(params: {
    tenantId: string;
    credentials: WhatsAppCredentials;
    message: IncomingWhatsAppMessage;
    text: string;
  }): Promise<void> {
    const { tenantId, credentials, message, text } = params;

    const { client, conversation } =
      await this.assistantSessionService.getOrCreateSession({
        tenantId,
        phone: message.from,
        clientName: message.contactName ?? undefined,
      });

    // 0. La conversación está en manos del negocio. Polaria no dice nada, pero
    //    registra el mensaje para que el hilo quede completo.
    const quiet = await this.quietReason({ tenantId, conversation });
    if (quiet) {
      await this.recordAndStayQuiet({
        tenantId,
        conversation,
        client,
        message,
        reason: quiet,
      });
      return;
    }

    // 1. Conversación congelada: hay una reserva en curso. El texto no se
    //    interpreta; se recuerda el paso pendiente y se reenvía el componente.
    const frozen = await this.bookingFlowService.handleFreeText({
      tenantId,
      clientId: client.id,
      limits: NATIVE_CHANNEL_LIMITS,
    });

    if (frozen) {
      this.logger.log(
        `Texto libre durante reserva, no interpretado (tenantId=${tenantId}, clientId=${client.id}).`,
      );

      // El asistente no interviene, así que el mensaje del cliente lo registra
      // este camino; si no, el hilo mostraría la respuesta sin la pregunta.
      await this.conversationRecorder.recordIncomingText({
        tenantId,
        conversationId: conversation.id,
        clientId: client.id,
        text,
      });

      await this.renderAndRecord({
        tenantId,
        credentials,
        conversationId: conversation.id,
        clientId: client.id,
        to: message.from,
        prompt: frozen,
      });
      return;
    }

    await this.conversationRecorder.recordIncomingText({
      tenantId,
      conversationId: conversation.id,
      clientId: client.id,
      text,
    });

    // 2. Pedido explícito de turno: se entra al flujo sin pasar por el menú.
    //    Mostrarle un menú a quien ya dijo lo que quiere es un paso de más.
    if (detectBookingTrigger(text)) {
      this.logger.log(
        `Intención de reserva detectada (tenantId=${tenantId}, clientId=${client.id}).`,
      );

      await this.startBooking({
        tenantId,
        credentials,
        conversation,
        clientId: client.id,
        to: message.from,
      });
      return;
    }

    // 3. Cualquier otro texto: menú de bienvenida. Polaria no simula responder
    //    preguntas abiertas; ofrece lo que sabe hacer y la salida a una persona.
    await this.sendWelcomeMenu({
      tenantId,
      credentials,
      conversationId: conversation.id,
      clientId: client.id,
      to: message.from,
    });
  }

  /**
   * Acción del menú de bienvenida.
   *
   * Son las dos únicas cosas que Polaria ofrece hacer: agendar, o apartarse.
   */
  private async handleMenuAction(params: {
    tenantId: string;
    credentials: WhatsAppCredentials;
    message: IncomingWhatsAppMessage;
    conversation: Conversation;
    clientId: string;
    action: WelcomeMenuAction;
  }): Promise<void> {
    const { tenantId, credentials, message, conversation, clientId, action } =
      params;

    await this.conversationRecorder.recordSelection({
      tenantId,
      conversationId: conversation.id,
      clientId,
      message,
    });

    if (action === WelcomeMenuAction.BOOK) {
      await this.startBooking({
        tenantId,
        credentials,
        conversation,
        clientId,
        to: message.from,
        /*
         * "Sacar otro turno" ya es la respuesta a "tenés un turno, ¿qué querés
         * hacer?". Volver a preguntarlo dejaría al cliente en un círculo.
         */
        skipExistingCheck: true,
      });
      return;
    }

    if (action === WelcomeMenuAction.MANAGE) {
      /*
       * Abre el flujo de acciones sobre turnos que ya existe —el mismo al que
       * llegan los botones del recordatorio—, así que reagendar y cancelar entran
       * por un solo camino.
       */
      const intervened = await this.offerExistingAppointments({
        tenantId,
        credentials,
        conversation,
        clientId,
        to: message.from,
      });

      // El turno se canceló entre que se mostró el menú y este toque.
      if (!intervened) {
        await this.replyAndRecord({
          tenantId,
          credentials,
          conversation,
          clientId,
          to: message.from,
          text: buildAppointmentGoneText(),
        });
      }
      return;
    }

    await this.conversationControl.handOff({ conversation });

    const acknowledgement = buildHandoffAcknowledgement();
    const sent = await this.whatsAppSenderService.sendText(credentials, {
      to: message.from,
      body: acknowledgement,
    });

    if (sent.ok) {
      await this.conversationRecorder.recordOutgoingText({
        tenantId,
        conversationId: conversation.id,
        clientId,
        text: acknowledgement,
        source: 'handoff',
      });
    }
  }

  /** Menú de bienvenida: el alcance de Polaria, dicho de forma honesta. */
  private async sendWelcomeMenu(params: {
    tenantId: string;
    credentials: WhatsAppCredentials;
    conversationId: string;
    clientId: string;
    to: string;
  }): Promise<void> {
    // Enfriamiento: varios mensajes seguidos sin intención detectada no deben
    // producir varios menús idénticos.
    const lastOutgoing = await this.conversationRecorder.findLastOutgoing(
      params.conversationId,
    );

    const allowed = shouldSendWelcomeMenu({
      lastOutgoingSource: lastOutgoing?.source,
      lastOutgoingAt: lastOutgoing?.createdAt,
      now: new Date(),
    });

    if (!allowed) {
      this.logger.log(
        `Menú omitido por enfriamiento (conversationId=${params.conversationId}).`,
      );
      return;
    }

    const menu = await this.buildEntryMenu(params.tenantId, params.clientId);

    const sent = await this.whatsAppSenderService.sendButtons(
      params.credentials,
      {
        to: params.to,
        body: menu.body,
        buttons: menu.options.map((option) => ({
          id: option.id,
          title: option.title,
        })),
      },
    );

    if (!sent.ok) return;

    await this.conversationRecorder.recordOutgoingText({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      clientId: params.clientId,
      text: `${menu.body}\n\nOpciones: ${menu.options
        .map((option) => option.title)
        .join(' · ')}`,
      source: WELCOME_MENU_SOURCE,
    });
  }

  /**
   * Por qué Polaria no debe responder, o `null` si puede hacerlo.
   *
   * Son dos apagados distintos y conviene no confundirlos: `BOT_OFF` es el
   * interruptor del negocio entero, que se maneja desde Configuración, y
   * `HANDOFF` es esta conversación puntual en manos de una persona, que pide el
   * propio cliente desde el menú.
   */
  private async quietReason(params: {
    tenantId: string;
    conversation: Conversation;
  }): Promise<QuietReason | null> {
    if (this.conversationControl.isHandedOff(params.conversation)) {
      return QuietReason.HANDOFF;
    }

    const tenant = await this.tenantsService.findOne(params.tenantId);
    // Un tenant que no aparece no es motivo para callar: el mensaje entró por
    // sus credenciales, y quedarse mudo escondería ese problema en vez de
    // dejarlo a la vista.
    return tenant && !tenant.aiEnabled ? QuietReason.BOT_OFF : null;
  }

  /**
   * Registra un mensaje entrante sin responder.
   *
   * Es lo que hace Polaria mientras no le toca hablar: el hilo queda completo en
   * el panel, pero el cliente no recibe nada automático.
   */
  private async recordAndStayQuiet(params: {
    tenantId: string;
    conversation: Conversation;
    client: { id: string };
    message: IncomingWhatsAppMessage;
    reason: QuietReason;
  }): Promise<void> {
    const { tenantId, conversation, client, message } = params;

    this.logger.log(
      `Polaria no responde (conversationId=${conversation.id}, motivo=${params.reason}).`,
    );

    if (message.kind === IncomingMessageKind.TEXT) {
      await this.conversationRecorder.recordIncomingText({
        tenantId,
        conversationId: conversation.id,
        clientId: client.id,
        text: message.text,
      });
      return;
    }

    await this.conversationRecorder.recordSelection({
      tenantId,
      conversationId: conversation.id,
      clientId: client.id,
      message,
    });
  }

  /**
   * Audio, imagen, ubicación y demás.
   *
   * Con una reserva en curso se reenvía el paso pendiente, por el mismo motivo que
   * con el texto: el cliente tiene que poder seguir sin quedar trabado.
   */
  private async handleUnsupported(params: {
    tenantId: string;
    credentials: WhatsAppCredentials;
    message: IncomingWhatsAppMessage;
  }): Promise<void> {
    const { tenantId, credentials, message } = params;

    const { client, conversation } =
      await this.assistantSessionService.getOrCreateSession({
        tenantId,
        phone: message.from,
        clientName: message.contactName ?? undefined,
      });

    const quiet = await this.quietReason({ tenantId, conversation });
    if (quiet) {
      await this.recordAndStayQuiet({
        tenantId,
        conversation,
        client,
        message,
        reason: quiet,
      });
      return;
    }

    const frozen = await this.bookingFlowService.handleFreeText({
      tenantId,
      clientId: client.id,
      limits: NATIVE_CHANNEL_LIMITS,
    });

    if (frozen) {
      await this.renderAndRecord({
        tenantId,
        credentials,
        conversationId: conversation.id,
        clientId: client.id,
        to: message.from,
        prompt: frozen,
      });
      return;
    }

    await this.whatsAppSenderService.sendText(credentials, {
      to: message.from,
      body: UNSUPPORTED_MESSAGE_REPLY,
    });
  }

  /**
   * Cierre de un WhatsApp Flow.
   *
   * La reserva ya se creó dentro del endpoint, así que acá no se decide nada: se
   * lee el desenlace que el endpoint puso en `extension_message_response.params`
   * y se le confirma al cliente por chat, que es donde va a buscarlo después.
   */
  private async handleFlowReply(params: {
    tenantId: string;
    credentials: WhatsAppCredentials;
    message: IncomingWhatsAppMessage;
  }): Promise<void> {
    const { tenantId, credentials, message } = params;
    if (message.kind !== IncomingMessageKind.FLOW_REPLY) return;

    const status = readFlowStatus(message.response);
    this.logger.log(
      `Flow cerrado (tenantId=${tenantId}, status=${String(status)}).`,
    );

    const { client, conversation } =
      await this.assistantSessionService.getOrCreateSession({
        tenantId,
        phone: message.from,
        clientName: message.contactName ?? undefined,
      });

    const quiet = await this.quietReason({ tenantId, conversation });
    if (quiet) {
      await this.recordAndStayQuiet({
        tenantId,
        conversation,
        client,
        message,
        reason: quiet,
      });
      return;
    }

    const reply = flowClosingText(status);
    const sent = await this.whatsAppSenderService.sendText(credentials, {
      to: message.from,
      body: reply,
    });

    if (!sent.ok) return;

    await this.conversationRecorder.recordOutgoingText({
      tenantId,
      conversationId: conversation.id,
      clientId: client.id,
      text: reply,
      source: 'booking-flow-whatsapp-flow',
    });
  }

  /**
   * Acciones sobre citas que el cliente ya tiene.
   *
   * Es un flujo separado del de reserva: no crea nada, opera sobre lo existente.
   */
  private async handleAppointmentAction(params: {
    tenantId: string;
    credentials: WhatsAppCredentials;
    message: IncomingWhatsAppMessage;
    conversation: Conversation;
    clientId: string;
    selection: AppointmentSelection;
  }): Promise<void> {
    const {
      tenantId,
      credentials,
      message,
      conversation,
      clientId,
      selection,
    } = params;

    await this.conversationRecorder.recordSelection({
      tenantId,
      conversationId: conversation.id,
      clientId,
      message,
    });

    // Sacar otro turno: reserva normal, sin tocar las que ya tiene.
    if (selection.action === AppointmentAction.NEW) {
      await this.startBooking({
        tenantId,
        credentials,
        conversation,
        clientId,
        to: message.from,
        skipExistingCheck: true,
      });
      return;
    }

    if (selection.action === AppointmentAction.DISMISS) {
      await this.replyAndRecord({
        tenantId,
        credentials,
        conversation,
        clientId,
        to: message.from,
        text: buildDismissedText(),
      });
      return;
    }

    // El id viene de un componente de WhatsApp, así que se comprueba que la cita
    // sea de este cliente antes de hacer nada con ella.
    const appointmentId =
      typeof selection.appointmentId === 'string' &&
      selection.appointmentId.length > 0
        ? selection.appointmentId
        : null;

    let appointment: Appointment | null = null;
    if (appointmentId) {
      const appointmentsApi = this.appointmentsService as {
        findUpcomingByClientAndId: (params: {
          tenantId: string;
          clientId: string;
          appointmentId: string;
        }) => Promise<Appointment | null>;
      };

      try {
        appointment = await appointmentsApi
          .findUpcomingByClientAndId({
            tenantId,
            clientId,
            appointmentId,
          })
          .catch(() => null);
      } catch {
        appointment = null;
      }
    }

    if (!appointment) {
      await this.replyAndRecord({
        tenantId,
        credentials,
        conversation,
        clientId,
        to: message.from,
        text: buildAppointmentGoneText(),
      });
      return;
    }

    const timezone = await this.resolveTimezone(tenantId);
    const summary = toAppointmentSummary(appointment);

    switch (selection.action) {
      case AppointmentAction.PICK:
        await this.sendAppointmentPrompt({
          tenantId,
          credentials,
          conversation,
          clientId,
          to: message.from,
          prompt: buildSingleAppointmentPrompt(summary, timezone),
        });
        return;

      case AppointmentAction.CANCEL:
        await this.sendAppointmentPrompt({
          tenantId,
          credentials,
          conversation,
          clientId,
          to: message.from,
          prompt: buildCancelConfirmPrompt(summary, timezone),
        });
        return;

      case AppointmentAction.CANCEL_CONFIRM: {
        const appointmentsApi = this.appointmentsService as {
          cancelByClient: (params: {
            tenantId: string;
            clientId: string;
            appointmentId: string;
          }) => Promise<unknown>;
        };

        await appointmentsApi.cancelByClient({
          tenantId,
          clientId,
          appointmentId: appointment.id,
        });
        await this.replyAndRecord({
          tenantId,
          credentials,
          conversation,
          clientId,
          to: message.from,
          text: buildCancelledText(summary, timezone),
        });
        return;
      }

      case AppointmentAction.RESCHEDULE:
        await this.startBooking({
          tenantId,
          credentials,
          conversation,
          clientId,
          to: message.from,
          skipExistingCheck: true,
          editingAppointmentId: appointment.id,
        });
        return;

      default:
        return;
    }
  }

  /**
   * Con qué se recibe al cliente.
   *
   * Si ya tiene un turno, se lo nombra en lugar de volver a presentarse.
   * Repetir "soy el asistente, ¿en qué puedo ayudarte?" justo después de que
   * reservó se lee como que el bot se olvidó de lo que acaba de pasar, y lo que
   * la persona viene a resolver casi siempre es *ese* turno.
   *
   * Con varios turnos se nombra el más próximo, que es el que trae a alguien a
   * escribir; los demás aparecen al elegir "Gestionar mi turno".
   */
  private async buildEntryMenu(
    tenantId: string,
    clientId: string,
  ): Promise<{ body: string; options: Array<{ id: string; title: string }> }> {
    const upcoming = await this.findUpcoming(tenantId, clientId);
    const next = upcoming[0];

    if (!next) {
      const tenant = await this.tenantsService.findOne(tenantId);
      return buildWelcomeMenu(tenant?.name ?? 'la barbería');
    }

    const summary = toAppointmentSummary(next);

    return buildBookedMenu(
      describeUpcomingAppointment({
        startTime: summary.startTime,
        staffName: summary.staffName,
        timeZone: await this.resolveTimezone(tenantId),
      }),
    );
  }

  /** Turnos futuros del cliente, del más próximo en adelante. */
  private findUpcoming(
    tenantId: string,
    clientId: string,
  ): Promise<Appointment[]> {
    const appointmentsApi = this.appointmentsService as {
      findUpcomingByClient: (query: {
        tenantId: string;
        clientId: string;
      }) => Promise<Appointment[]>;
    };

    return appointmentsApi.findUpcomingByClient({ tenantId, clientId });
  }

  /**
   * Ofrece qué hacer con las citas que el cliente ya tiene.
   *
   * Devuelve si intervino. Con una sola cita se saltea el paso de elegir cuál,
   * igual que se saltea el de profesional cuando hay uno solo.
   */
  private async offerExistingAppointments(params: {
    tenantId: string;
    credentials: WhatsAppCredentials;
    conversation: Conversation;
    clientId: string;
    to: string;
  }): Promise<boolean> {
    const { tenantId, clientId } = params;

    const upcoming = await this.findUpcoming(tenantId, clientId);
    if (upcoming.length === 0) return false;

    const timezone = await this.resolveTimezone(tenantId);
    const summaries = upcoming.map(toAppointmentSummary);

    const prompt =
      summaries.length === 1
        ? buildSingleAppointmentPrompt(summaries[0], timezone)
        : buildAppointmentListPrompt(summaries, timezone);

    await this.sendAppointmentPrompt({ ...params, prompt });
    return true;
  }

  /**
   * Envía un prompt de citas: botones si son pocas opciones, lista si no entran.
   */
  private async sendAppointmentPrompt(params: {
    tenantId: string;
    credentials: WhatsAppCredentials;
    conversation: Conversation;
    clientId: string;
    to: string;
    prompt: AppointmentPrompt;
  }): Promise<void> {
    const { prompt } = params;

    const fitsInButtons =
      prompt.options.length <= WHATSAPP_LIMITS.BUTTONS_MAX_COUNT &&
      prompt.options.every((option) => !option.description);

    const sent = fitsInButtons
      ? await this.whatsAppSenderService.sendButtons(params.credentials, {
          to: params.to,
          body: prompt.body,
          buttons: prompt.options.map((option) => ({
            id: option.id,
            title: option.title,
          })),
        })
      : await this.whatsAppSenderService.sendList(params.credentials, {
          to: params.to,
          body: prompt.body,
          buttonText: 'Ver turnos',
          sections: [{ rows: prompt.options }],
        });

    if (!sent.ok) return;

    await this.conversationRecorder.recordOutgoingText({
      tenantId: params.tenantId,
      conversationId: params.conversation.id,
      clientId: params.clientId,
      text: `${prompt.body}\n\nOpciones: ${prompt.options
        .map((option) => option.title)
        .join(' · ')}`,
      source: 'appointment-actions',
    });
  }

  /** Manda un texto y lo deja en el historial. */
  private async replyAndRecord(params: {
    tenantId: string;
    credentials: WhatsAppCredentials;
    conversation: Conversation;
    clientId: string;
    to: string;
    text: string;
  }): Promise<void> {
    const sent = await this.whatsAppSenderService.sendText(params.credentials, {
      to: params.to,
      body: params.text,
    });

    if (!sent.ok) return;

    await this.conversationRecorder.recordOutgoingText({
      tenantId: params.tenantId,
      conversationId: params.conversation.id,
      clientId: params.clientId,
      text: params.text,
      source: 'appointment-actions',
    });
  }

  private async resolveTimezone(tenantId: string): Promise<string> {
    const tenant = await this.tenantsService.findOne(tenantId);
    return tenant?.timezone ?? 'America/La_Paz';
  }

  /**
   * Abre una reserva por el canal que corresponda a este tenant.
   *
   * Con un Flow publicado se manda el formulario y el resto de la conversación
   * ocurre dentro de él, contra el endpoint cifrado. Sin Flow —o si el envío
   * falla— se cae a las listas y botones nativos, que no dependen de ninguna
   * configuración en Meta.
   */
  private async startBooking(params: {
    tenantId: string;
    credentials: WhatsAppCredentials;
    conversation: Conversation;
    clientId: string;
    to: string;
    /** Salta la detección de turnos existentes: ya se decidió sacar otro. */
    skipExistingCheck?: boolean;
    editingAppointmentId?: string;
  }): Promise<void> {
    const { tenantId, credentials, conversation, clientId, to } = params;

    // Si ya tiene turno, se pregunta qué quiere hacer en lugar de abrir otro
    // flujo sin más. No se impide sacar otro: es una de las opciones.
    if (!params.skipExistingCheck) {
      const intervened = await this.offerExistingAppointments({
        tenantId,
        credentials,
        conversation,
        clientId,
        to,
      });
      if (intervened) return;
    }

    const tenant = await this.tenantsService.findOne(tenantId);
    const flowId = readStoredCredential(tenant?.whatsappFlowId);

    const prompt = await this.bookingFlowService.start({
      tenantId,
      clientId,
      conversationId: conversation.id,
      editingAppointmentId: params.editingAppointmentId,
      limits: flowId ? {} : NATIVE_CHANNEL_LIMITS,
    });

    if (flowId) {
      const opened = await this.openBookingFlow({
        tenantId,
        credentials,
        conversation,
        clientId,
        to,
        flowId,
      });
      if (opened) return;

      this.logger.warn(
        `No se pudo abrir el Flow (tenantId=${tenantId}); se cae al canal nativo.`,
      );
    }

    await this.renderAndRecord({
      tenantId,
      credentials,
      conversationId: conversation.id,
      clientId,
      to,
      prompt,
    });
  }

  /** Manda el mensaje que abre el Flow. Devuelve si WhatsApp lo aceptó. */
  private async openBookingFlow(params: {
    tenantId: string;
    credentials: WhatsAppCredentials;
    conversation: Conversation;
    clientId: string;
    to: string;
    flowId: string;
  }): Promise<boolean> {
    const session = await this.bookingSessionService.findActive({
      tenantId: params.tenantId,
      clientId: params.clientId,
    });

    if (!session) return false;

    const body = 'Elegí tu servicio y horario y te lo agendo.';

    // El token de la sesión viaja como `flow_token`: es lo que ata cada
    // `data_exchange` del endpoint a esta reserva.
    const sent = await this.whatsAppSenderService.sendFlow(params.credentials, {
      to: params.to,
      body,
      cta: 'Reservar turno',
      flowId: params.flowId,
      flowToken: session.token,
    });

    if (!sent.ok) return false;

    await this.conversationRecorder.recordOutgoingText({
      tenantId: params.tenantId,
      conversationId: params.conversation.id,
      clientId: params.clientId,
      text: `${body}\n\n[Formulario de reserva]`,
      source: 'booking-flow-whatsapp-flow',
    });

    return true;
  }

  /** Envía el paso del flujo y deja constancia de lo que WhatsApp entregó. */
  private async renderAndRecord(params: {
    tenantId: string;
    credentials: WhatsAppCredentials;
    conversationId: string;
    clientId: string;
    to: string;
    prompt: BookingPrompt;
  }): Promise<void> {
    const rendered = await this.bookingPromptRenderer.render({
      credentials: params.credentials,
      to: params.to,
      prompt: params.prompt,
    });

    await this.conversationRecorder.recordRendered({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      clientId: params.clientId,
      rendered,
    });
  }
}
