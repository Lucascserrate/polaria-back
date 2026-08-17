import { Injectable, Logger } from '@nestjs/common';

import { BookingSessionService } from '../booking-flow/booking-session.service';
import {
  FlowBookingService,
  type FlowBookingPayload,
} from './flow-booking.service';
import {
  buildPingResponse,
  buildTerminalResponse,
  type FlowResponse,
} from './flow-screen';

/** Acciones que Meta envía al endpoint. */
const FLOW_ACTIONS = {
  PING: 'ping',
  INIT: 'INIT',
  BACK: 'BACK',
  DATA_EXCHANGE: 'data_exchange',
} as const;

/** Triggers que declara `booking-flow.json` en cada `data_exchange`. */
export const FLOW_TRIGGERS = {
  SERVICE_SELECTED: 'service_selected',
  STAFF_SELECTED: 'staff_selected',
  DATE_SELECTED: 'date_selected',
  REVIEW: 'review',
  CONFIRM: 'confirm',
} as const;

export type FlowEndpointRequest = {
  version?: string;
  action?: string;
  screen?: string;
  data?: Record<string, unknown>;
  flow_token?: string;
};

/**
 * Despachador del endpoint de Flows, sin cifrado ni HTTP.
 *
 * Resuelve la sesión por `flow_token` y enruta el `trigger` al paso que
 * corresponde. El presupuesto de Meta ronda los 12 segundos por respuesta, así
 * que acá no hay lugar para trabajo que no sea resolver la pantalla.
 */
@Injectable()
export class FlowEndpointService {
  private readonly logger = new Logger(FlowEndpointService.name);

  constructor(
    private readonly bookingSessionService: BookingSessionService,
    private readonly flowBookingService: FlowBookingService,
  ) {}

  async handle(request: FlowEndpointRequest): Promise<FlowResponse> {
    // El health check no lleva `flow_token` ni toca ninguna sesión.
    if (request.action === FLOW_ACTIONS.PING) return buildPingResponse();

    const flowToken = request.flow_token;
    if (!flowToken) {
      this.logger.warn(
        `Petición de Flow sin flow_token (action=${String(request.action)}).`,
      );
      return buildTerminalResponse('', { status: 'invalid_session' });
    }

    const session = await this.bookingSessionService.findByToken(flowToken);
    if (!session) {
      this.logger.warn(`Flow con token desconocido (token=${flowToken}).`);
      return buildTerminalResponse(flowToken, { status: 'invalid_session' });
    }

    if (
      request.action === FLOW_ACTIONS.INIT ||
      request.action === FLOW_ACTIONS.BACK
    ) {
      return this.flowBookingService.init(session);
    }

    if (request.action !== FLOW_ACTIONS.DATA_EXCHANGE) {
      this.logger.warn(
        `Acción de Flow no soportada: ${String(request.action)}.`,
      );
      return buildTerminalResponse(flowToken, { status: 'unsupported_action' });
    }

    const payload = readPayload(request.data);
    const trigger = readTrigger(request.data);

    switch (trigger) {
      case FLOW_TRIGGERS.SERVICE_SELECTED:
        return this.flowBookingService.onServiceSelected(session, payload);

      case FLOW_TRIGGERS.STAFF_SELECTED:
        return this.flowBookingService.onStaffSelected(session, payload);

      case FLOW_TRIGGERS.DATE_SELECTED:
        return this.flowBookingService.onDateSelected(session, payload);

      case FLOW_TRIGGERS.REVIEW:
        return this.flowBookingService.onReview(session, payload);

      case FLOW_TRIGGERS.CONFIRM:
        return this.flowBookingService.onConfirm(session, payload);

      default:
        this.logger.warn(`Trigger de Flow desconocido: ${String(trigger)}.`);
        return this.flowBookingService.init(session);
    }
  }
}

function readTrigger(data?: Record<string, unknown>): string | null {
  const trigger = data?.trigger;
  return typeof trigger === 'string' ? trigger : null;
}

/**
 * Lee las cuatro selecciones del payload.
 *
 * Un desplegable todavía sin elegir llega vacío o ausente, así que las cadenas
 * vacías se normalizan a `undefined` en vez de propagarse como una selección.
 */
function readPayload(data?: Record<string, unknown>): FlowBookingPayload {
  return {
    service: readText(data?.service),
    staff: readText(data?.staff),
    date: readText(data?.date),
    slot: readText(data?.slot),
  };
}

function readText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined;
}
