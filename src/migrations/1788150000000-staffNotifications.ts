import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Avisos por WhatsApp a los profesionales, y el estado de plantillas en su
 * propia tabla.
 *
 * Dos cambios que van juntos porque el segundo habilita al primero: los avisos
 * necesitan una plantilla más, y el estado de plantillas vivía en cuatro columnas
 * de `tenants` pensadas para exactamente una. Con dos serían ocho, y el job que
 * relee aprobaciones y el webhook de Meta tenían "la" plantilla en singular.
 *
 * La plantilla de recordatorios que cada negocio ya tenía se **copia** a la tabla
 * nueva antes de borrar las columnas, así que ningún negocio pierde su aprobación
 * ni tiene que rehacerla. Lo que no se crea acá es la fila de la plantilla nueva:
 * esa la aprovisiona el negocio al conectar WhatsApp, o el job al detectarla
 * faltante.
 */
export class StaffNotifications1788150000000 implements MigrationInterface {
  name = 'StaffNotifications1788150000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`whatsapp_templates\` (
         \`id\` varchar(36) NOT NULL,
         \`tenantId\` varchar(36) NOT NULL,
         \`templateKey\` varchar(32) NOT NULL,
         \`name\` varchar(512) NOT NULL,
         \`language\` varchar(16) NOT NULL,
         \`status\` varchar(32) NOT NULL,
         \`metaStatus\` varchar(32) NULL,
         \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
         \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
         UNIQUE INDEX \`IDX_whatsapp_templates_tenant_key\` (\`tenantId\`, \`templateKey\`),
         INDEX \`IDX_whatsapp_templates_status\` (\`status\`),
         PRIMARY KEY (\`id\`),
         CONSTRAINT \`FK_whatsapp_templates_tenant\`
           FOREIGN KEY (\`tenantId\`) REFERENCES \`tenants\`(\`id\`) ON DELETE CASCADE
       ) ENGINE=InnoDB`,
    );

    /*
     * Traspasa lo que cada negocio ya tenía aprobado.
     *
     * Solo las filas con nombre cargado: un tenant sin plantilla no necesita fila,
     * y crearla con `NULL` obligaría a que las columnas fueran nulables para
     * representar un estado que ya se representa con la ausencia de la fila.
     *
     * `UUID()` para el id porque la tabla lo tiene como `varchar(36)`, igual que el
     * resto del esquema.
     */
    await queryRunner.query(
      `INSERT INTO \`whatsapp_templates\`
         (\`id\`, \`tenantId\`, \`templateKey\`, \`name\`, \`language\`, \`status\`, \`metaStatus\`)
       SELECT
         UUID(), \`id\`, 'reminder', \`reminderTemplateName\`,
         COALESCE(\`reminderTemplateLanguage\`, 'es'),
         COALESCE(\`reminderTemplateStatus\`, 'NOT_CREATED'),
         \`reminderTemplateMetaStatus\`
       FROM \`tenants\`
       WHERE \`reminderTemplateName\` IS NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE \`tenants\`
         DROP COLUMN \`reminderTemplateMetaStatus\`,
         DROP COLUMN \`reminderTemplateStatus\`,
         DROP COLUMN \`reminderTemplateLanguage\`,
         DROP COLUMN \`reminderTemplateName\``,
    );

    await queryRunner.query(
      `CREATE TABLE \`appointment_notifications\` (
         \`id\` varchar(36) NOT NULL,
         \`tenantId\` varchar(36) NOT NULL,
         \`appointmentId\` varchar(36) NOT NULL,
         \`staffId\` varchar(36) NOT NULL,
         \`event\` varchar(16) NOT NULL,
         \`fingerprint\` varchar(128) NOT NULL,
         \`serviceId\` char(36) NOT NULL,
         \`startTime\` timestamp NOT NULL,
         \`previousStartTime\` timestamp NULL,
         \`channel\` varchar(16) NOT NULL,
         \`state\` varchar(16) NOT NULL,
         \`failureReason\` varchar(64) NULL,
         \`sentAt\` timestamp NULL,
         \`metaMessageId\` varchar(128) NULL,
         \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
         \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
         UNIQUE INDEX \`IDX_appointment_notifications_key\`
           (\`appointmentId\`, \`staffId\`, \`event\`, \`fingerprint\`),
         INDEX \`IDX_appointment_notifications_pending\` (\`state\`, \`createdAt\`),
         PRIMARY KEY (\`id\`),
         CONSTRAINT \`FK_appointment_notifications_tenant\`
           FOREIGN KEY (\`tenantId\`) REFERENCES \`tenants\`(\`id\`) ON DELETE CASCADE,
         CONSTRAINT \`FK_appointment_notifications_appointment\`
           FOREIGN KEY (\`appointmentId\`) REFERENCES \`appointments\`(\`id\`) ON DELETE CASCADE,
         CONSTRAINT \`FK_appointment_notifications_staff\`
           FOREIGN KEY (\`staffId\`) REFERENCES \`staff\`(\`id\`) ON DELETE CASCADE
       ) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`appointment_notifications\``);

    await queryRunner.query(
      `ALTER TABLE \`tenants\`
         ADD \`reminderTemplateName\` varchar(512) NULL,
         ADD \`reminderTemplateLanguage\` varchar(16) NULL,
         ADD \`reminderTemplateStatus\` varchar(32) NULL,
         ADD \`reminderTemplateMetaStatus\` varchar(32) NULL`,
    );

    // Devuelve la plantilla de recordatorios a sus columnas para que revertir no
    // le cueste a ningún negocio una reaprobación.
    await queryRunner.query(
      `UPDATE \`tenants\` t
         JOIN \`whatsapp_templates\` w
           ON w.\`tenantId\` = t.\`id\` AND w.\`templateKey\` = 'reminder'
         SET
           t.\`reminderTemplateName\` = w.\`name\`,
           t.\`reminderTemplateLanguage\` = w.\`language\`,
           t.\`reminderTemplateStatus\` = w.\`status\`,
           t.\`reminderTemplateMetaStatus\` = w.\`metaStatus\``,
    );

    await queryRunner.query(`DROP TABLE \`whatsapp_templates\``);
  }
}
