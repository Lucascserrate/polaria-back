import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `replacesAppointmentId` pasa a llamarse `editingAppointmentId`.
 *
 * Cambia el nombre porque cambia la operación: reagendar dejaba de lado la cita
 * vieja y creaba otra, así que "reemplaza" describía bien lo que pasaba. Ahora la
 * cita se edita en el lugar y conserva su id, su historial y sus relaciones. Con
 * el nombre anterior el modelo describiría algo que ya no ocurre, que es la clase
 * de mentira que después cuesta caro.
 *
 * Se usa `CHANGE` y no `RENAME COLUMN` para no depender de MySQL 8.
 */
export class EditingAppointmentId1787880000000 implements MigrationInterface {
  name = 'EditingAppointmentId1787880000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`booking_sessions\` CHANGE \`replacesAppointmentId\` \`editingAppointmentId\` varchar(36) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`booking_sessions\` CHANGE \`editingAppointmentId\` \`replacesAppointmentId\` varchar(36) NULL`,
    );
  }
}
