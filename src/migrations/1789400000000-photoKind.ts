import { MigrationInterface, QueryRunner } from 'typeorm';

const TABLE = 'business_photos';
const OLD_INDEX = 'IDX_business_photos_tenant_position';
const NEW_INDEX = 'IDX_business_photos_tenant_kind_position';

/**
 * Las fotos pasan a tener dos usos: la galería del local y el portfolio.
 *
 * Una columna en la tabla que ya existe, y no una tabla nueva. Lo que cambia
 * entre las dos colecciones es dónde se muestran y cuántas se admiten; todo lo
 * demás —el archivo en Cloudinary, el orden, el renumerado al borrar, el
 * rechazo del lote que excede el tope— es idéntico. Una segunda tabla sería una
 * copia de ese servicio entero, y el día que se arregle algo en una el arreglo
 * no llega a la otra.
 *
 * `DEFAULT 'gallery'` deja bien a las filas que ya están: las fotos cargadas
 * hasta hoy son las del local, que es exactamente lo que significa ese valor.
 *
 * ## El índice se crea antes de borrar el viejo
 *
 * No es una preferencia de orden: es lo único que funciona. `tenantId` tiene una
 * foreign key, e InnoDB exige que exista un índice que empiece por esa columna.
 * `IDX_business_photos_tenant_position` era el único, así que borrarlo primero
 * falla con "needed in a foreign key constraint". Creando antes el nuevo —que
 * también arranca en `tenantId`— la clave queda sostenida y el viejo se puede
 * sacar.
 *
 * ## Y cada paso pregunta antes de actuar
 *
 * El DDL de MySQL no es transaccional: una migración que falla a la mitad deja
 * la mitad aplicada y sin registrar, así que el siguiente arranque la reintenta
 * desde el principio y choca con lo que ya está hecho. Eso es un bucle de
 * arranque, no un error que se vea una vez. Preguntar por cada pieza es lo que
 * permite que el reintento termine el trabajo en lugar de volver a empezarlo.
 */
export class PhotoKind1789400000000 implements MigrationInterface {
  name = 'PhotoKind1789400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await hasColumn(queryRunner, 'kind'))) {
      await queryRunner.query(
        `ALTER TABLE \`${TABLE}\`
          ADD \`kind\` varchar(16) NOT NULL DEFAULT 'gallery'`,
      );
    }

    // Primero el nuevo: es el que pasa a sostener la foreign key de `tenantId`.
    if (!(await hasIndex(queryRunner, NEW_INDEX))) {
      await queryRunner.query(
        `CREATE INDEX \`${NEW_INDEX}\`
          ON \`${TABLE}\` (\`tenantId\`, \`kind\`, \`position\`)`,
      );
    }

    if (await hasIndex(queryRunner, OLD_INDEX)) {
      await queryRunner.query(`DROP INDEX \`${OLD_INDEX}\` ON \`${TABLE}\``);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /*
     * Al volver atrás se borran las fotos de portfolio.
     *
     * Sin la columna no hay forma de distinguirlas, y dejarlas convertiría el
     * portfolio de un negocio en fotos de su local: aparecerían en la galería y
     * una podría terminar como portada. Los archivos quedan en Cloudinary
     * —MySQL no borra ahí— y eso es preferible a mostrar lo que no corresponde.
     */
    if (await hasColumn(queryRunner, 'kind')) {
      await queryRunner.query(
        `DELETE FROM \`${TABLE}\` WHERE \`kind\` = 'portfolio'`,
      );
    }

    // Mismo cuidado que en `up`, al revés: el viejo vuelve antes de que el
    // nuevo se vaya, o la foreign key se queda sin índice a mitad de camino.
    if (!(await hasIndex(queryRunner, OLD_INDEX))) {
      await queryRunner.query(
        `CREATE INDEX \`${OLD_INDEX}\`
          ON \`${TABLE}\` (\`tenantId\`, \`position\`)`,
      );
    }

    if (await hasIndex(queryRunner, NEW_INDEX)) {
      await queryRunner.query(`DROP INDEX \`${NEW_INDEX}\` ON \`${TABLE}\``);
    }

    if (await hasColumn(queryRunner, 'kind')) {
      await queryRunner.query(`ALTER TABLE \`${TABLE}\` DROP COLUMN \`kind\``);
    }
  }
}

/**
 * Si la columna ya está en la tabla.
 *
 * Contra `information_schema` y acotado a `DATABASE()`: el mismo servidor MySQL
 * puede alojar varios entornos, y sin ese filtro la respuesta sería "existe en
 * algún lado".
 */
const hasColumn = async (
  queryRunner: QueryRunner,
  column: string,
): Promise<boolean> => {
  const rows = (await queryRunner.query(
    `SELECT COUNT(*) AS total
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?`,
    [TABLE, column],
  )) as Array<{ total: number }>;

  return Number(rows[0]?.total ?? 0) > 0;
};

const hasIndex = async (
  queryRunner: QueryRunner,
  index: string,
): Promise<boolean> => {
  const rows = (await queryRunner.query(
    `SELECT COUNT(*) AS total
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND INDEX_NAME = ?`,
    [TABLE, index],
  )) as Array<{ total: number }>;

  return Number(rows[0]?.total ?? 0) > 0;
};
