import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * La indicación que el negocio le deja al cliente junto a su turno.
 *
 * Salió de un pedido real: una barbería que cobra el 50% por adelantado y
 * cancela la reserva si no recibe el comprobante. Eso decide si el cliente
 * aparece, y hasta ahora no tenía dónde vivir: se lo decían por WhatsApp de a
 * uno, o no se lo decían.
 *
 * Nace `NULL` en todas las filas y eso es lo correcto, no una migración a
 * medias: la nota es opcional y `NULL` significa que este negocio no tiene nada
 * que agregar, así que la sección no se dibuja. Ningún negocio cambia de
 * comportamiento hasta que alguien escriba algo.
 *
 * `varchar(1000)` y no `text`: es una indicación, no un reglamento, y el tope
 * que el panel deja escribir es el mismo —ver `APPOINTMENT_NOTE_MAX_LENGTH`—.
 * Con `text` la columna aceptaría 64 KB que ninguna pantalla podría mostrar.
 */
export class AppointmentNote1790300000000 implements MigrationInterface {
  name = 'AppointmentNote1790300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`tenants\` ADD \`appointmentNote\` varchar(1000) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`tenants\` DROP COLUMN \`appointmentNote\``,
    );
  }
}
