import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Separa tres cosas que hasta ahora se confundían en una: **conectado**,
 * **facturación configurada** y **notificaciones activadas**.
 *
 * El caso que lo motivó: una WABA conectada, con plantillas aprobadas y número
 * verificado, que no entregaba un solo mensaje de plantilla porque en Meta le
 * faltaba configurar la moneda. "Conectado" no significa "puede enviar".
 *
 * Deliberadamente **no** hay un `whatsappEnabled` que mezcle las tres. Cada una se
 * responde por su lado y cada una se arregla en un lugar distinto: la conexión con
 * Embedded Signup, la facturación en el Billing Hub de Meta, y las notificaciones
 * con un interruptor del panel.
 *
 * El backfill conserva el comportamiento actual: los negocios que **ya** tienen
 * WhatsApp conectado quedan con las notificaciones encendidas, porque hoy las están
 * recibiendo y apagárselas en una migración sería quitarles una función que usan.
 * Los que se conecten de ahora en más arrancan apagadas, que es lo que pide el flujo
 * nuevo: primero configurar la facturación, después activar.
 */
export class WhatsappBillingAndNotifications1788400000000 implements MigrationInterface {
  name = 'WhatsappBillingAndNotifications1788400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`tenants\`
         ADD \`whatsappBillingStatus\` varchar(16) NOT NULL DEFAULT 'UNKNOWN',
         ADD \`whatsappBillingReason\` varchar(512) NULL,
         ADD \`whatsappBillingCheckedAt\` datetime NULL,
         ADD \`whatsappNotificationsEnabled\` tinyint NOT NULL DEFAULT 0`,
    );

    /*
     * Quien ya está conectado, sigue recibiendo.
     *
     * La conexión se mide por credenciales, igual que en `/settings` y en el
     * onboarding: son las que el envío usa. Se descartan las cadenas basura que estas
     * columnas pueden tener guardadas —`'null'`, `'undefined'`— porque pasan un
     * `IS NOT NULL` y no son credenciales.
     */
    await queryRunner.query(
      `UPDATE \`tenants\`
         SET \`whatsappNotificationsEnabled\` = 1
       WHERE \`whatsappAccessToken\` IS NOT NULL
         AND TRIM(\`whatsappAccessToken\`) NOT IN ('', 'null', 'undefined')
         AND \`whatsappPhoneId\` IS NOT NULL
         AND TRIM(\`whatsappPhoneId\`) NOT IN ('', 'null', 'undefined')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`tenants\`
         DROP COLUMN \`whatsappNotificationsEnabled\`,
         DROP COLUMN \`whatsappBillingCheckedAt\`,
         DROP COLUMN \`whatsappBillingReason\`,
         DROP COLUMN \`whatsappBillingStatus\``,
    );
  }
}
