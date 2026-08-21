import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Una cuenta de Google, un negocio.
 *
 * Con el registro self-service, el índice único es lo que sostiene esa regla.
 * Sin él, dos peticiones simultáneas del mismo primer login crearían dos
 * negocios para la misma persona, y el usuario terminaría con dos paneles y dos
 * pruebas gratuitas.
 *
 * MySQL admite varios `NULL` bajo un índice único, así que los tenants creados a
 * mano por soporte —que todavía no tienen `googleId`— conviven sin problema.
 *
 * Si la migración falla por duplicados, hay dos filas con el mismo `googleId` y
 * hay que resolverlas a mano antes de reintentar: cuál es la cuenta real no es
 * algo que una migración pueda decidir.
 */
export class UniqueGoogleAccount1787620000000 implements MigrationInterface {
  name = 'UniqueGoogleAccount1787620000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX \`IDX_tenants_google_id\` ON \`tenants\` (\`googleId\`)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX \`IDX_tenants_google_id\` ON \`tenants\``,
    );
  }
}
