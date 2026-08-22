import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Varios recordatorios por cita en lugar de uno configurable.
 *
 * `remindersEnabled` + `reminderLeadMinutes` podían expresar "un aviso, a tantas
 * horas". El negocio necesita poder tener el del día anterior **y** el de un rato
 * antes, que son dos recordatorios distintos de la misma cita.
 *
 * Los datos se conservan: un negocio con avisos activos queda con su
 * anticipación como única anticipación, y uno que los tenía apagados queda con la
 * lista vacía. Una lista vacía es exactamente "apagados", así que no hace falta
 * un booleano aparte —y tener los dos permitiría el estado incoherente de
 * "activados, sin ninguna anticipación".
 */
export class ReminderOffsets1787790000000 implements MigrationInterface {
  name = 'ReminderOffsets1787790000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`tenants\` ADD \`reminderOffsets\` json NULL`,
    );
    // Primero los datos, después se sueltan las columnas viejas.
    await queryRunner.query(
      `UPDATE \`tenants\` SET \`reminderOffsets\` = IF(\`remindersEnabled\` = 1, JSON_ARRAY(\`reminderLeadMinutes\`), JSON_ARRAY())`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tenants\` DROP COLUMN \`reminderLeadMinutes\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`tenants\` DROP COLUMN \`remindersEnabled\``,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`tenants\` ADD \`remindersEnabled\` tinyint NOT NULL DEFAULT 1`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tenants\` ADD \`reminderLeadMinutes\` int NOT NULL DEFAULT 1440`,
    );
    // Solo se puede recuperar una anticipación: la primera. Un negocio con dos
    // avisos configurados pierde el segundo al volver atrás.
    await queryRunner.query(
      `UPDATE \`tenants\` SET
         \`remindersEnabled\` = IF(JSON_LENGTH(\`reminderOffsets\`) > 0, 1, 0),
         \`reminderLeadMinutes\` = COALESCE(JSON_EXTRACT(\`reminderOffsets\`, '$[0]'), 1440)`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tenants\` DROP COLUMN \`reminderOffsets\``,
    );
  }
}
