import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrupa el catálogo en categorías.
 *
 * Nace de un salón con demasiados servicios: una lista de WhatsApp con treinta
 * filas no se lee, se abandona. Con categorías el cliente elige primero "Cabello"
 * y después el servicio, que son dos listas cortas en lugar de una inmanejable.
 * El panel es el primer lugar donde se ve, pero la razón de existir es el canal.
 *
 * `categoryId` es **nullable** y nace en `NULL` para todo lo que ya existe. Un
 * catálogo de cinco servicios no gana nada categorizado, y obligar a hacerlo para
 * poder seguir usando la pantalla sería cobrarle a todos el problema de uno. Los
 * servicios sin categoría se muestran juntos al final y se pueden reservar igual.
 *
 * `ON DELETE SET NULL` y no `CASCADE`: borrar "Cabello" no puede borrar el corte
 * de pelo. La categoría es una forma de mirar el catálogo, no su dueña.
 *
 * Único `(tenantId, name)` porque dos "Cortes" en el mismo negocio no son dos
 * categorías, son un error de tipeo que después hay que ir a deshacer servicio
 * por servicio. El choque lo traduce `isDuplicateEntryError`.
 *
 * `position` entra ahora aunque la pantalla todavía ordene alfabético: el orden
 * de las categorías es el orden del menú de WhatsApp, y ahí "Cortes" tiene que ir
 * antes que "Cejas" porque es lo que más se pide, no porque empiece con C.
 */
export class ServiceCategories1789800000000 implements MigrationInterface {
  name = 'ServiceCategories1789800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`service_categories\` (
         \`id\` varchar(36) NOT NULL,
         \`tenantId\` varchar(255) NOT NULL,
         \`name\` varchar(255) NOT NULL,
         \`description\` varchar(255) NULL,
         \`position\` int NOT NULL DEFAULT 0,
         \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
         \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
           ON UPDATE CURRENT_TIMESTAMP(6),
         UNIQUE INDEX \`UQ_service_categories_tenant_name\`
           (\`tenantId\`, \`name\`),
         PRIMARY KEY (\`id\`)
       ) ENGINE=InnoDB`,
    );

    await queryRunner.query(
      `ALTER TABLE \`service_categories\`
         ADD CONSTRAINT \`FK_service_categories_tenant\`
         FOREIGN KEY (\`tenantId\`) REFERENCES \`tenants\`(\`id\`)
         ON DELETE CASCADE`,
    );

    await queryRunner.query(
      `ALTER TABLE \`services\` ADD \`categoryId\` varchar(36) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`services\`
         ADD CONSTRAINT \`FK_services_category\`
         FOREIGN KEY (\`categoryId\`) REFERENCES \`service_categories\`(\`id\`)
         ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`services\` DROP FOREIGN KEY \`FK_services_category\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`services\` DROP COLUMN \`categoryId\``,
    );
    await queryRunner.query(`DROP TABLE \`service_categories\``);
  }
}
