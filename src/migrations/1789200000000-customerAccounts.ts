import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Las cuentas de quienes reservan, y el vínculo del turno con la cuenta que lo
 * creó.
 *
 * Es la primera identidad de Polaria que no es un negocio. Convive con
 * `clients` y no la reemplaza: la ficha que un negocio tiene de una persona
 * sigue siendo `clients`, identificada por teléfono, porque la mayoría de los
 * clientes llegan por WhatsApp o los carga el dueño a mano y nunca van a tener
 * cuenta.
 *
 * `appointments.customerAccountId` es lo que hace segura la pantalla "mis
 * reservas" que viene después: la cuenta lista **lo que hizo la cuenta**, no lo
 * que hay bajo un número de teléfono. La diferencia importa porque un teléfono
 * es un identificador y no una credencial —cualquiera puede escribir el de
 * otro—, así que listar por número dejaría ver turnos ajenos a quien acierte un
 * número. Nulable porque las reservas por WhatsApp y las que carga el negocio no
 * tienen cuenta detrás, y son la mayoría.
 */
export class CustomerAccounts1789200000000 implements MigrationInterface {
  name = 'CustomerAccounts1789200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`customer_accounts\` (
        \`id\` varchar(36) NOT NULL,
        \`googleId\` varchar(255) NOT NULL,
        \`email\` varchar(255) NULL,
        \`name\` varchar(255) NOT NULL,
        \`phone\` varchar(32) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`IDX_customer_accounts_googleId\` (\`googleId\`),
        INDEX \`IDX_customer_accounts_email\` (\`email\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB`,
    );

    await queryRunner.query(
      `ALTER TABLE \`appointments\` ADD \`customerAccountId\` varchar(36) NULL`,
    );

    /*
     * `SET NULL` y no `CASCADE`: si alguien borra su cuenta de Polaria, el turno
     * sigue siendo del negocio —que lo tiene en su agenda y lo facturó— y lo
     * único que se pierde es el vínculo con la cuenta.
     */
    await queryRunner.query(
      `ALTER TABLE \`appointments\`
        ADD CONSTRAINT \`FK_appointments_customer_account\`
        FOREIGN KEY (\`customerAccountId\`) REFERENCES \`customer_accounts\`(\`id\`)
        ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Lo que va a leer "mis reservas": los turnos de una cuenta, por fecha.
    await queryRunner.query(
      `CREATE INDEX \`IDX_appointments_customer_account\` ON \`appointments\` (\`customerAccountId\`, \`startTime\`)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX \`IDX_appointments_customer_account\` ON \`appointments\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`appointments\` DROP FOREIGN KEY \`FK_appointments_customer_account\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`appointments\` DROP COLUMN \`customerAccountId\``,
    );
    await queryRunner.query(`DROP TABLE \`customer_accounts\``);
  }
}
