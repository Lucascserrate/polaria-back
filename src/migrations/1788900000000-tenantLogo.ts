import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El logo del negocio, subido a Cloudinary.
 *
 * Es la primera imagen que Polaria guarda de un negocio, y por eso la columna
 * es una URL y no un archivo ni un identificador interno: las imágenes no se
 * alojan acá. El disco del contenedor es efímero —lo que se escriba no
 * sobrevive al próximo deploy— y servirlas desde la API haría que cada visita a
 * una página pública pasara por nuestro proceso en lugar de por un CDN.
 *
 * La URL incluye la versión que asigna Cloudinary, y es eso lo que hace que
 * cambiar el logo se vea: el identificador del recurso es siempre el mismo
 * —`polaria/<entorno>/tenants/<id>/logo`— así que sin la versión la dirección
 * no cambiaría y el navegador seguiría mostrando el logo anterior.
 *
 * No hay columna para ese identificador justamente porque es determinista y se
 * puede reconstruir. `NULL` significa "sin logo", que es el estado de todos los
 * negocios existentes y tiene que verse bien en la página pública.
 */
export class TenantLogo1788900000000 implements MigrationInterface {
  name = 'TenantLogo1788900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`tenants\` ADD \`logoUrl\` varchar(512) NULL`,
    );
  }

  /**
   * Revertir borra la referencia, no la imagen: los archivos siguen en
   * Cloudinary y se recuperan volviendo a aplicar la migración y subiendo de
   * nuevo. Borrarlos desde acá sería destruir datos por un cambio de esquema.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`tenants\` DROP COLUMN \`logoUrl\``);
  }
}
