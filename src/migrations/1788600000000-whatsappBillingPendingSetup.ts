import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Convierte la facturación en un paso previo obligatorio en vez de un aviso posterior.
 *
 * Hasta ahora solo nos enterábamos cuando Meta rechazaba un envío: el negocio activaba
 * las notificaciones, se olvidaba del asunto, y descubría el problema cuando un
 * mensaje no llegaba. El aviso llegaba después del daño.
 *
 * Lo que permite adelantarlo no es una comprobación nueva —Meta no nos deja consultar
 * si hay método de pago— sino un hecho documentado: Meta exige que **todo** cliente de
 * un Tech Provider agregue su propio método de pago después del onboarding, y sin él
 * los envíos de plantilla fallan. Entonces el paso está pendiente para todos hasta que
 * alguien diga haberlo hecho, y eso se sabe sin preguntar nada.
 *
 * Por eso el estado nace en `PENDING_SETUP` y bloquea activar las notificaciones,
 * hasta que el negocio confirme desde el panel.
 */
export class WhatsappBillingPendingSetup1788600000000 implements MigrationInterface {
  name = 'WhatsappBillingPendingSetup1788600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`tenants\`
         ALTER \`whatsappBillingStatus\` SET DEFAULT 'PENDING_SETUP'`,
    );

    /*
     * El paso pendiente alcanza también a los que ya estaban conectados.
     *
     * Es una decisión con costo: a esos negocios se les apagan las notificaciones
     * hasta que confirmen, y las notificaciones son algo que ya venían usando. Se
     * eligió igual porque lo contrario sería peor: dejarlos activados es dejarlos en
     * el mismo estado que produjo el `131042` —enviando sin método de pago—, con la
     * pantalla en verde y sin nada que les diga qué falta.
     *
     * `ACTION_REQUIRED` se conserva: ahí Meta ya dijo algo concreto, y el mensaje que
     * guardamos con sus palabras es más útil que un "falta un paso" genérico.
     */
    await queryRunner.query(
      `UPDATE \`tenants\`
          SET \`whatsappBillingStatus\` = 'PENDING_SETUP',
              \`whatsappNotificationsEnabled\` = 0
        WHERE \`whatsappBillingStatus\` <> 'ACTION_REQUIRED'`,
    );

    // Los que ya estaban bloqueados por Meta tampoco deberían seguir enviando: el
    // estado los frenaba en la pantalla, pero el interruptor seguía encendido.
    await queryRunner.query(
      `UPDATE \`tenants\`
          SET \`whatsappNotificationsEnabled\` = 0
        WHERE \`whatsappBillingStatus\` = 'ACTION_REQUIRED'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`tenants\`
         ALTER \`whatsappBillingStatus\` SET DEFAULT 'UNKNOWN'`,
    );

    // `PENDING_SETUP` vuelve a "no sabemos", que era el estado inicial anterior. Las
    // notificaciones no se vuelven a encender: cuáles estaban encendidas es
    // información que esta migración no guardó, y adivinarlo sería peor.
    await queryRunner.query(
      `UPDATE \`tenants\`
          SET \`whatsappBillingStatus\` = 'UNKNOWN'
        WHERE \`whatsappBillingStatus\` = 'PENDING_SETUP'`,
    );
  }
}
