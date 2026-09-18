import { MigrationInterface, QueryRunner } from 'typeorm';

const TABLE = 'staff_join_requests';

/**
 * Pedidos de acceso: alguien que ya trabaja en un negocio y quiere entrar.
 *
 * Tabla propia y no una fila de `staff` en estado pendiente. La diferencia
 * importa: `staff` contesta "quién trabaja acá" y lo escribe el negocio, y esto
 * lo escribe un desconocido —cualquiera con una cuenta de Google puede pedir
 * acceso a cualquier negocio—. Metiéndolo ahí, un pedido cualquiera aparecería
 * como empleado en el equipo de otro hasta que alguien lo rechazara, y la lista
 * dejaría de significar lo que significa.
 *
 * Al aprobar se crea la ficha de `staff` de verdad y el pedido queda como
 * `approved`: no se borra, porque es el único registro de que alguien pidió y
 * quién lo dejó entrar.
 *
 * `googleId` además del correo porque es lo que autentica. El correo sirve para
 * que el dueño reconozca a la persona y para `grantAccess`; el `googleId` es lo
 * que no se puede escribir a mano.
 */
export class StaffJoinRequests1789600000000 implements MigrationInterface {
  name = 'StaffJoinRequests1789600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await hasTable(queryRunner))) {
      await queryRunner.query(
        `CREATE TABLE \`${TABLE}\` (
          \`id\` varchar(36) NOT NULL,
          \`tenantId\` varchar(36) NOT NULL,
          \`googleId\` varchar(255) NOT NULL,
          \`email\` varchar(255) NOT NULL,
          \`name\` varchar(255) NULL,
          \`status\` varchar(16) NOT NULL DEFAULT 'pending',
          \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          \`resolvedAt\` datetime(6) NULL,
          INDEX \`IDX_staff_join_requests_tenant_status\` (\`tenantId\`, \`status\`),
          INDEX \`IDX_staff_join_requests_google\` (\`googleId\`, \`status\`),
          PRIMARY KEY (\`id\`)
        ) ENGINE=InnoDB`,
      );
    }

    /*
     * Un solo pedido pendiente por persona y negocio.
     *
     * El índice único lo sostiene en la base y no en una consulta previa: dos
     * toques al botón desde un teléfono con mala señal son dos peticiones a la
     * vez, y ahí un `SELECT` antes del `INSERT` no alcanza. Los resueltos quedan
     * afuera porque `status` entra en la clave: alguien rechazado tiene que poder
     * volver a pedir el día que el dueño cambie de idea.
     */
    if (!(await hasIndex(queryRunner, 'UQ_staff_join_requests_pending'))) {
      await queryRunner.query(
        `CREATE UNIQUE INDEX \`UQ_staff_join_requests_pending\`
          ON \`${TABLE}\` (\`tenantId\`, \`googleId\`, \`status\`)`,
      );
    }

    if (!(await hasForeignKey(queryRunner, 'FK_staff_join_requests_tenant'))) {
      await queryRunner.query(
        `ALTER TABLE \`${TABLE}\`
          ADD CONSTRAINT \`FK_staff_join_requests_tenant\`
          FOREIGN KEY (\`tenantId\`) REFERENCES \`tenants\`(\`id\`)
          ON DELETE CASCADE ON UPDATE NO ACTION`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await hasTable(queryRunner)) {
      await queryRunner.query(`DROP TABLE \`${TABLE}\``);
    }
  }
}

/*
 * Cada paso pregunta antes de actuar: el DDL de MySQL no es transaccional, así
 * que una migración que falla a la mitad deja la mitad aplicada y sin registrar,
 * y el siguiente arranque la reintenta desde el principio. Sin esto, eso es un
 * bucle de arranque en lugar de un error que se ve una vez.
 */
const hasTable = async (queryRunner: QueryRunner): Promise<boolean> =>
  count(
    queryRunner,
    `SELECT COUNT(*) AS total
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [TABLE],
  );

const hasIndex = async (
  queryRunner: QueryRunner,
  index: string,
): Promise<boolean> =>
  count(
    queryRunner,
    `SELECT COUNT(*) AS total
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND INDEX_NAME = ?`,
    [TABLE, index],
  );

const hasForeignKey = async (
  queryRunner: QueryRunner,
  name: string,
): Promise<boolean> =>
  count(
    queryRunner,
    `SELECT COUNT(*) AS total
       FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND CONSTRAINT_NAME = ?`,
    [TABLE, name],
  );

const count = async (
  queryRunner: QueryRunner,
  sql: string,
  params: unknown[],
): Promise<boolean> => {
  const rows = (await queryRunner.query(sql, params)) as Array<{
    total: number;
  }>;

  return Number(rows[0]?.total ?? 0) > 0;
};
