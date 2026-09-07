import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Las fotos del local que se ven en la página pública del negocio.
 *
 * Tabla y no columna JSON en `tenants` porque son varias, con orden, y cada una
 * arrastra un archivo en Cloudinary: quitar una foto tiene que ser borrar una
 * fila, no reescribir un arreglo entero —dos pestañas abiertas y la última en
 * guardar borra lo que hizo la otra—.
 *
 * `position` arranca en 0 y queda siempre contigua: la 0 es la portada, que en
 * la página es la foto grande. Se recalcula completa en cada cambio en lugar de
 * dejar huecos, para que "la portada es la 0" se pueda leer sin mirar el resto.
 *
 * Ninguna foto es obligatoria. Un negocio sin fotos es el estado de todos los
 * que existen hoy, y la página tiene que verse bien así: sin galería, no con
 * una galería vacía.
 */
export class BusinessPhotos1789000000000 implements MigrationInterface {
  name = 'BusinessPhotos1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`business_photos\` (
        \`id\` varchar(36) NOT NULL,
        \`tenantId\` varchar(255) NOT NULL,
        \`url\` varchar(512) NOT NULL,
        \`publicId\` varchar(255) NOT NULL,
        \`width\` int NOT NULL,
        \`height\` int NOT NULL,
        \`position\` int NOT NULL DEFAULT 0,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        INDEX \`IDX_business_photos_tenant_position\` (\`tenantId\`, \`position\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB`,
    );

    /*
     * `CASCADE`: las fotos de un negocio dado de baja no tienen sentido propio.
     * Los archivos en Cloudinary no se van con esto —MySQL no borra en un
     * servicio externo—; eso lo hace `CloudinaryService.deleteFolder`.
     */
    await queryRunner.query(
      `ALTER TABLE \`business_photos\`
        ADD CONSTRAINT \`FK_business_photos_tenant\`
        FOREIGN KEY (\`tenantId\`) REFERENCES \`tenants\`(\`id\`)
        ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  /**
   * Revertir borra las referencias, no los archivos: siguen en Cloudinary. Es
   * deliberado, igual que en la migración del logo —un cambio de esquema no
   * debería destruir las fotos que un negocio subió—, pero deja archivos que
   * ninguna fila menciona: si esta vuelta atrás es definitiva, hay que limpiar
   * la carpeta `polaria/<entorno>/tenants/<id>/photos` a mano.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`business_photos\` DROP FOREIGN KEY \`FK_business_photos_tenant\``,
    );
    await queryRunner.query(`DROP TABLE \`business_photos\``);
  }
}
