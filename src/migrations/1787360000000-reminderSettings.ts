import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Configuración de recordatorios por negocio.
 *
 * Activados por defecto y con 24 horas de anticipación: es un buen valor para
 * cualquier vertical, y para los que necesitan preparación —estética,
 * odontología, spa— es donde más rinde.
 *
 * `reminderLeadMinutes` guarda minutos y no horas para no tener que migrar la
 * columna cuando alguien pida "45 minutos antes".
 */
export class ReminderSettings1787360000000 implements MigrationInterface {
  name = 'ReminderSettings1787360000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`tenants\` ADD \`remindersEnabled\` tinyint NOT NULL DEFAULT 1`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tenants\` ADD \`reminderLeadMinutes\` int NOT NULL DEFAULT 1440`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`tenants\` DROP COLUMN \`reminderLeadMinutes\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`tenants\` DROP COLUMN \`remindersEnabled\``,
    );
  }
}
