import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';

import {
  Conversation,
  ConversationState,
} from './entities/conversation.entity';

/**
 * Tiempo de inactividad tras el cual una conversación transferida vuelve sola a
 * Polaria.
 *
 * Es una red de seguridad, no el camino normal —ese es el botón del panel—. Sin
 * ella, una conversación transferida una vez queda muda para siempre, que es la
 * forma silenciosa de perder todas las reservas futuras de ese cliente.
 */
export const HANDOFF_TTL_HOURS = 24;

export const HANDOFF_REASONS = {
  CLIENT_REQUEST: 'CLIENT_REQUEST',
} as const;

/**
 * Control de quién atiende una conversación: Polaria o una persona.
 *
 * El traspaso solo puede iniciarse desde el menú, nunca durante una reserva: un
 * flujo de reserva empezado se termina o se cancela, y mezclar ambos dejaría la
 * conversación congelada y muda al mismo tiempo.
 */
@Injectable()
export class ConversationControlService {
  private readonly logger = new Logger(ConversationControlService.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
  ) {}

  isHandedOff(conversation: Conversation): boolean {
    return conversation.currentState === ConversationState.HUMAN_HANDOFF;
  }

  /** Deja la conversación en manos del negocio. Polaria deja de responder. */
  async handOff(params: {
    conversation: Conversation;
    reason?: string;
    now?: Date;
  }): Promise<Conversation> {
    const { conversation } = params;
    const now = params.now ?? new Date();

    conversation.currentState = ConversationState.HUMAN_HANDOFF;
    conversation.handoffRequestedAt = now;
    conversation.handoffReason =
      params.reason ?? HANDOFF_REASONS.CLIENT_REQUEST;

    this.logger.log(
      `Conversación transferida a humano (conversationId=${conversation.id}, reason=${conversation.handoffReason}).`,
    );

    return this.conversationRepository.save(conversation);
  }

  /**
   * Devuelve la conversación a Polaria.
   *
   * No envía ningún aviso a propósito: volver en silencio y esperar el próximo
   * mensaje es menos confuso que anunciar un "ya volví" sin contexto, y evita
   * hablar por encima de la persona que venía atendiendo.
   */
  async resume(conversation: Conversation): Promise<Conversation> {
    conversation.currentState = ConversationState.IDLE;
    conversation.handoffRequestedAt = null;
    conversation.handoffReason = null;

    this.logger.log(
      `Conversación devuelta a Polaria (conversationId=${conversation.id}).`,
    );

    return this.conversationRepository.save(conversation);
  }

  async resumeById(id: string): Promise<Conversation | null> {
    const conversation = await this.conversationRepository.findOneBy({ id });
    if (!conversation) return null;
    if (!this.isHandedOff(conversation)) return conversation;

    return this.resume(conversation);
  }

  /** Conversaciones esperando atención humana, para el panel. */
  findHandedOff(tenantId: string): Promise<Conversation[]> {
    return this.conversationRepository.find({
      where: { tenantId, currentState: ConversationState.HUMAN_HANDOFF },
      order: { handoffRequestedAt: 'ASC' },
    });
  }

  /** Devuelve a Polaria las conversaciones transferidas hace demasiado. */
  async resumeStale(now: Date = new Date()): Promise<number> {
    const threshold = new Date(
      now.getTime() - HANDOFF_TTL_HOURS * 60 * 60 * 1000,
    );

    const result = await this.conversationRepository.update(
      {
        currentState: ConversationState.HUMAN_HANDOFF,
        handoffRequestedAt: LessThan(threshold),
      },
      {
        currentState: ConversationState.IDLE,
        handoffRequestedAt: null,
        handoffReason: null,
      },
    );

    return result.affected ?? 0;
  }
}
