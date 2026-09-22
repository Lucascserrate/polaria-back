import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hasta cuándo está paga la suscripción de un negocio.
 *
 * Nace en `NULL` para todos, incluido el que hoy figure `ACTIVE`: no hay forma
 * de inventar una fecha de vencimiento que nadie cargó, y `resolveSubscription`
 * lee esa combinación como vencida. Es deliberado —un dato faltante no debería
 * regalar producto—, y en la práctica no toca a nadie: hasta esta migración
 * ningún código escribía `ACTIVE`.
 *
 * Sin `DEFAULT`: el vencimiento es un hecho que alguien registra, y un valor por
 * defecto lo convertiría en una suposición.
 */
export class SubscriptionEndsAt1790000000000 implements MigrationInterface {
  name = 'SubscriptionEndsAt1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`tenants\` ADD \`subscriptionEndsAt\` datetime NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`tenants\` DROP COLUMN \`subscriptionEndsAt\``,
    );
  }
}
