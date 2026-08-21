import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Saca `booked` de los estados de una cita y borra `reminderSent`.
 *
 * `booked` era un estado muerto: ningún flujo lo escribía —todas las citas se
 * crean `confirmed`— y solo aparecía en los contadores. Peor, no estaba en
 * `BLOCKING_APPOINTMENT_STATUSES`, así que una cita que hubiera quedado en ese
 * estado no habría ocupado su horario (doble reserva) ni habría recibido
 * recordatorio. Un estado que nadie produce y que rompe dos invariantes es
 * mejor eliminarlo que documentarlo.
 *
 * Las filas que hubieran quedado en `booked` pasan a `confirmed`, que es lo que
 * produce el sistema hoy y lo que sí ocupa agenda. Es una decisión de datos y no
 * se puede revertir: el `down` recupera el valor del enum, no qué filas lo
 * tenían.
 *
 * `reminderSent` era un booleano de una idea anterior de recordatorios que nunca
 * se leyó. Con `appointment_reminders` habría dos respuestas posibles a "¿se
 * envió el recordatorio?", y la vieja siempre diría que no.
 */
export class DropBookedStatus1787540000000 implements MigrationInterface {
  name = 'DropBookedStatus1787540000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Primero los datos: MySQL no deja quitar un valor del enum que esté en uso.
    await queryRunner.query(
      `UPDATE \`appointments\` SET \`status\` = 'confirmed' WHERE \`status\` = 'booked'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`appointments\` MODIFY \`status\` enum ('pending', 'confirmed', 'cancelled', 'completed') NOT NULL DEFAULT 'pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`appointments\` DROP COLUMN \`reminderSent\``,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`appointments\` ADD \`reminderSent\` tinyint NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE \`appointments\` MODIFY \`status\` enum ('pending', 'booked', 'confirmed', 'cancelled', 'completed') NOT NULL DEFAULT 'pending'`,
    );
  }
}
