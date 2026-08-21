import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Plantilla de recordatorios por negocio.
 *
 * Una plantilla pertenece a una WABA, así que el puntero vive en el tenant junto
 * al resto de los datos de la conexión. `reminderTemplateMetaStatus` guarda el
 * estado crudo de Meta además del nuestro: nuestro `UNAVAILABLE` agrupa cinco
 * situaciones distintas, y sin el original no se puede explicar cuál es.
 */
export class ReminderTemplate1787270000000 implements MigrationInterface {
  name = 'ReminderTemplate1787270000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`tenants\` ADD \`reminderTemplateName\` varchar(512) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tenants\` ADD \`reminderTemplateLanguage\` varchar(16) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tenants\` ADD \`reminderTemplateStatus\` varchar(32) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tenants\` ADD \`reminderTemplateMetaStatus\` varchar(32) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`tenants\` DROP COLUMN \`reminderTemplateMetaStatus\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`tenants\` DROP COLUMN \`reminderTemplateStatus\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`tenants\` DROP COLUMN \`reminderTemplateLanguage\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`tenants\` DROP COLUMN \`reminderTemplateName\``,
    );
  }
}
