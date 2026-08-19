import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Estado de la conexión de WhatsApp.
 *
 * `whatsappPhoneNumber` pasa a admitir NULL porque hasta ahora no había forma de
 * escribir "este negocio no tiene WhatsApp conectado". El índice único se
 * mantiene: MySQL permite varios NULL bajo un índice único, que es justo lo que
 * hace falta para que convivan varios tenants desconectados.
 *
 * `whatsappWabaId` pasa de TEXT a varchar para poder indexarlo: es la única
 * forma de resolver el tenant de un webhook `account_update`, que no trae
 * `phone_number_id`. MySQL no indexa TEXT sin longitud de prefijo.
 */
export class WhatsappConnectionState1787184000000 implements MigrationInterface {
  name = 'WhatsappConnectionState1787184000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`tenants\` MODIFY \`whatsappPhoneNumber\` varchar(255) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tenants\` MODIFY \`whatsappWabaId\` varchar(64) NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX \`IDX_tenants_whatsapp_waba_id\` ON \`tenants\` (\`whatsappWabaId\`)`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tenants\` ADD \`whatsappUnavailableSince\` datetime NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tenants\` ADD \`whatsappUnavailableReason\` varchar(64) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`tenants\` DROP COLUMN \`whatsappUnavailableReason\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`tenants\` DROP COLUMN \`whatsappUnavailableSince\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_tenants_whatsapp_waba_id\` ON \`tenants\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`tenants\` MODIFY \`whatsappWabaId\` text NULL`,
    );
    // Revertir a NOT NULL solo es posible si no quedaron tenants desconectados.
    await queryRunner.query(
      `ALTER TABLE \`tenants\` MODIFY \`whatsappPhoneNumber\` varchar(255) NOT NULL`,
    );
  }
}
