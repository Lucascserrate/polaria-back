import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import {
  ConversationControlService,
  HANDOFF_TTL_HOURS,
} from './conversation-control.service';

/**
 * Devuelve a Polaria las conversaciones transferidas hace demasiado.
 *
 * Es una red de seguridad, no el camino normal —ese es el botón del panel—. Sin
 * esto, una conversación que alguna vez pasó a manos del negocio queda muda para
 * siempre: el cliente volvería meses después a pedir un turno y no recibiría
 * respuesta, sin que nadie se entere.
 */
@Injectable()
export class ConversationHandoffCleanupJob {
  private readonly logger = new Logger(ConversationHandoffCleanupJob.name);

  constructor(
    private readonly conversationControl: ConversationControlService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async resumeStaleHandoffs(): Promise<void> {
    try {
      const resumed = await this.conversationControl.resumeStale(new Date());
      if (resumed > 0) {
        this.logger.log(
          `Conversaciones devueltas a Polaria tras ${HANDOFF_TTL_HOURS}h sin actividad: ${resumed}.`,
        );
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      this.logger.error(`Fallo al liberar handoffs vencidos: ${message}`);
    }
  }
}
