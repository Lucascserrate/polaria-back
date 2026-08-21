import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Recordatorios programados por cita.
 *
 * La clave única sobre `(appointmentId, channel, offsetMinutes)` es la garantía
 * de idempotencia: dos reconciliaciones simultáneas no pueden crear dos filas
 * para el mismo aviso, sin importar cómo se ordenen.
 */
export class AppointmentReminders1787450000000 implements MigrationInterface {
  name = 'AppointmentReminders1787450000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`appointment_reminders\` (
        \`id\` varchar(36) NOT NULL,
        \`appointmentId\` varchar(255) NOT NULL,
        \`tenantId\` varchar(255) NOT NULL,
        \`channel\` varchar(32) NOT NULL,
        \`offsetMinutes\` int NOT NULL,
        \`scheduledFor\` datetime NULL,
        \`state\` varchar(16) NOT NULL DEFAULT 'SCHEDULED',
        \`sentAt\` datetime NULL,
        \`metaMessageId\` varchar(128) NULL,
        \`failureReason\` varchar(255) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`IDX_reminder_appointment_channel_offset\` (\`appointmentId\`, \`channel\`, \`offsetMinutes\`),
        INDEX \`IDX_reminder_state_scheduled_for\` (\`state\`, \`scheduledFor\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`appointment_reminders\` ADD CONSTRAINT \`FK_reminder_appointment\` FOREIGN KEY (\`appointmentId\`) REFERENCES \`appointments\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`appointment_reminders\` ADD CONSTRAINT \`FK_reminder_tenant\` FOREIGN KEY (\`tenantId\`) REFERENCES \`tenants\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`appointment_reminders\` DROP FOREIGN KEY \`FK_reminder_tenant\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`appointment_reminders\` DROP FOREIGN KEY \`FK_reminder_appointment\``,
    );
    await queryRunner.query(`DROP TABLE \`appointment_reminders\``);
  }
}
