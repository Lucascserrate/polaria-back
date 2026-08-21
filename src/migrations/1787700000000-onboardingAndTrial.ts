import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ubicación del negocio y modelo de prueba gratuita.
 *
 * Las coordenadas se guardan en lugar de una dirección de texto porque el
 * destino es enviar la ubicación **como ubicación** por WhatsApp, no como un
 * enlace: la Cloud API pide latitud y longitud. `decimal(10,7)` cubre los tres
 * dígitos enteros de la longitud y deja siete decimales, del orden del
 * centímetro, que es más precisión de la que hace falta para una puerta.
 *
 * `email` pasa a único: el vínculo por correo del login elige una fila, y con
 * dos filas del mismo correo esa elección sería arbitraria. Si la migración
 * falla por duplicados hay que resolverlos a mano; cuál es la cuenta real no lo
 * puede decidir una migración.
 */
export class OnboardingAndTrial1787700000000 implements MigrationInterface {
  name = 'OnboardingAndTrial1787700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`tenants\` ADD \`latitude\` decimal(10,7) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tenants\` ADD \`longitude\` decimal(10,7) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tenants\` ADD \`subscriptionStatus\` varchar(16) NOT NULL DEFAULT 'NONE'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tenants\` ADD \`trialStartedAt\` datetime NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tenants\` ADD \`trialEndsAt\` datetime NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX \`IDX_tenants_email\` ON \`tenants\` (\`email\`)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX \`IDX_tenants_email\` ON \`tenants\``);
    await queryRunner.query(
      `ALTER TABLE \`tenants\` DROP COLUMN \`trialEndsAt\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`tenants\` DROP COLUMN \`trialStartedAt\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`tenants\` DROP COLUMN \`subscriptionStatus\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`tenants\` DROP COLUMN \`longitude\``,
    );
    await queryRunner.query(`ALTER TABLE \`tenants\` DROP COLUMN \`latitude\``);
  }
}
