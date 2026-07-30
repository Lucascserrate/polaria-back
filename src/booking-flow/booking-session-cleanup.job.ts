import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { BookingSessionService } from './booking-session.service';

/**
 * Cierre periódico de sesiones de reserva abandonadas.
 *
 * La caducidad ya se detecta al recibir una interacción, así que este barrido no
 * cambia lo que ve el cliente: existe para que una sesión que el cliente nunca
 * volvió a tocar no quede abierta indefinidamente. Sin él, `findActive` seguiría
 * encontrando sesiones muertas y la conversación quedaría congelada para siempre.
 */
@Injectable()
export class BookingSessionCleanupJob {
  private readonly logger = new Logger(BookingSessionCleanupJob.name);

  constructor(private readonly bookingSessionService: BookingSessionService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async expireAbandonedSessions(): Promise<void> {
    try {
      const expired = await this.bookingSessionService.expireStale(new Date());
      if (expired > 0) {
        this.logger.log(`Sesiones de reserva vencidas cerradas: ${expired}.`);
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      this.logger.error(`Fallo al cerrar sesiones vencidas: ${message}`);
    }
  }
}
