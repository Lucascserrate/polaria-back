import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cómo agenda un cliente que escribe por WhatsApp: el flujo guiado o el enlace.
 *
 * Nace con `GUIDED_CHAT` en todas las filas y por eso la columna es `NOT NULL`
 * con valor por defecto: acá sí hay un comportamiento de fábrica, que es el que
 * todos los negocios ya tienen. Ningún negocio cambia de conducta con esta
 * migración; el que quiera el enlace lo elige.
 *
 * Es distinto de `appointmentNote`, que nace `NULL` porque su valor de fábrica
 * es "no hay nada que decir". Acá "no elegí" no es un estado posible: WhatsApp
 * tiene que hacer algo cuando alguien toca "Agendar cita".
 *
 * `varchar(20)` y no un `enum` de MySQL: agregar un modo con `enum` es un
 * `ALTER TABLE` que bloquea la tabla, y esto va a crecer —un Flow, un enlace de
 * pago— antes que otras columnas.
 */
export class BookingMode1790400000000 implements MigrationInterface {
  name = 'BookingMode1790400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`tenants\` ADD \`bookingMode\` varchar(20) NOT NULL DEFAULT 'GUIDED_CHAT'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`tenants\` DROP COLUMN \`bookingMode\``,
    );
  }
}
