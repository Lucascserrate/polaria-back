import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Quita el estado de facturación `READY` y guarda la moneda como dato aparte.
 *
 * `READY` lo escribía una sonda que solo sabe leer la moneda configurada de la WABA.
 * Esa es **una** de las causas por las que Meta devuelve `131042` —también están el
 * método de pago ausente, el rechazado y el portafolio sin verificar—, así que verla
 * configurada no permitía concluir que el negocio pudiera enviar. Y como la sonda
 * escribía el estado, un `READY` falso pisaba y borraba el diagnóstico real de Meta:
 * la pantalla se ponía verde justo cuando el negocio necesitaba leer el problema.
 *
 * Quedan dos estados: o Meta dijo que hay un problema, o no sabemos. La moneda pasa a
 * su propia columna, donde no decide nada y sirve para lo que sí sirve: averiguar con
 * datos reales si Meta devuelve una moneda por defecto en cuentas sin facturar.
 *
 * No hace falta tocar `whatsappNotificationsEnabled`: `UNKNOWN` no bloquea, así que
 * los negocios que hubieran quedado en `READY` no pierden nada.
 */
export class WhatsappBillingHonestStates1788500000000 implements MigrationInterface {
  name = 'WhatsappBillingHonestStates1788500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`tenants\` ADD \`whatsappBillingCurrency\` varchar(8) NULL`,
    );

    /*
     * Los `READY` que existan afirman algo que nunca comprobamos. Se degradan a
     * `UNKNOWN` —"no sabemos", que no bloquea— y no a `ACTION_REQUIRED`: no hay
     * ninguna evidencia de que esos negocios tengan un problema.
     */
    await queryRunner.query(
      `UPDATE \`tenants\`
          SET \`whatsappBillingStatus\` = 'UNKNOWN'
        WHERE \`whatsappBillingStatus\` = 'READY'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Los `READY` originales no se restauran: la información de cuáles eran se
    // perdió a propósito, porque era una afirmación sin respaldo.
    await queryRunner.query(
      `ALTER TABLE \`tenants\` DROP COLUMN \`whatsappBillingCurrency\``,
    );
  }
}
