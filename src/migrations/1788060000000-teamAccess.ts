import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Acceso a Polaria para los miembros del equipo.
 *
 * Igual que `TeamRoles`, no cambia el comportamiento de nada al aplicarse: las
 * tres columnas nacen en `NULL`, así que **nadie del equipo puede entrar todavía**
 * y el único login sigue siendo el del dueño. El acceso se habilita de a uno desde
 * el panel, que es la única forma de que sea una decisión del negocio y no un
 * efecto de la migración.
 *
 * Los dos índices únicos sostienen que una identidad sea un solo asiento. MySQL
 * admite varios `NULL` bajo un índice único, así que el equipo sin acceso no
 * compite por nada.
 */
export class TeamAccess1788060000000 implements MigrationInterface {
  name = 'TeamAccess1788060000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`staff\`
         ADD \`accessEmail\` varchar(255) NULL,
         ADD \`accessGoogleId\` varchar(255) NULL,
         ADD \`accessGrantedAt\` datetime NULL`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX \`IDX_staff_accessEmail\` ON \`staff\` (\`accessEmail\`)`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX \`IDX_staff_accessGoogleId\` ON \`staff\` (\`accessGoogleId\`)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX \`IDX_staff_accessGoogleId\` ON \`staff\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_staff_accessEmail\` ON \`staff\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`staff\`
         DROP COLUMN \`accessGrantedAt\`,
         DROP COLUMN \`accessGoogleId\`,
         DROP COLUMN \`accessEmail\``,
    );
  }
}
