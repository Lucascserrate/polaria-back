import { MigrationInterface, QueryRunner } from 'typeorm';

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
 * El índice se reemplaza en lugar de agregarse: `(tenantId, position)` dejaría
 * de servir para la consulta que importa, que ahora siempre acota por uso. Con
 * `kind` en el medio, la misma entrada resuelve el listado de una colección y
 * la búsqueda de la portada.
 */
export class PhotoKind1789400000000 implements MigrationInterface {
  name = 'PhotoKind1789400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`business_photos\`
        ADD \`kind\` varchar(16) NOT NULL DEFAULT 'gallery'`,
    );

    await queryRunner.query(
      `DROP INDEX \`IDX_business_photos_tenant_position\` ON \`business_photos\``,
    );

    await queryRunner.query(
      `CREATE INDEX \`IDX_business_photos_tenant_kind_position\`
        ON \`business_photos\` (\`tenantId\`, \`kind\`, \`position\`)`,
    );
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
    await queryRunner.query(
      `DELETE FROM \`business_photos\` WHERE \`kind\` = 'portfolio'`,
    );

    await queryRunner.query(
      `DROP INDEX \`IDX_business_photos_tenant_kind_position\` ON \`business_photos\``,
    );

    await queryRunner.query(
      `CREATE INDEX \`IDX_business_photos_tenant_position\`
        ON \`business_photos\` (\`tenantId\`, \`position\`)`,
    );

    await queryRunner.query(
      `ALTER TABLE \`business_photos\` DROP COLUMN \`kind\``,
    );
  }
}
