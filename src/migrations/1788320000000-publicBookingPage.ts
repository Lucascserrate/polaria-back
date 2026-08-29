import { MigrationInterface, QueryRunner } from 'typeorm';

import { buildUniqueSlug } from '../tenants/slug.util';

/**
 * La página pública de reservas necesita dos datos que el negocio todavía no
 * tenía: una dirección en la URL y una dirección en la calle.
 *
 * `slug` es lo que vuelve direccionable a un negocio desde afuera
 * (`polariahq.com/royal-barber`). `address` es lo que se lee en la página: las
 * coordenadas que ya guardábamos sirven para mandar la ubicación por WhatsApp,
 * pero un par de decimales no le dice nada a alguien que quiere saber si el
 * local le queda cerca.
 *
 * El nombre del índice es el que TypeORM deriva de `('tenants', ['slug'])`, no
 * uno legible. Es a propósito: con otro nombre, el primer `migration:generate`
 * que alguien corra vería un índice "desconocido", lo borraría y crearía el
 * suyo. El resto de los índices del esquema tiene el mismo aspecto.
 *
 * El índice único se crea **después** del relleno y no antes: los negocios que
 * ya existen se numeran entre sí —dos "Royal Barber" dan `royal-barber` y
 * `royal-barber-2`— y con el índice puesto primero la segunda actualización
 * fallaría en lugar de desempatar.
 */
export class PublicBookingPage1788320000000 implements MigrationInterface {
  name = 'PublicBookingPage1788320000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `tenants` ADD `slug` varchar(60) NULL, ADD `address` varchar(255) NULL',
    );

    /*
     * El relleno corre en JavaScript y no en SQL porque slugificar es quitar
     * acentos, colapsar puntuación y desempatar: en MySQL eso serían varias
     * capas de REPLACE que nadie podría volver a leer, y encima quedaría una
     * segunda definición de la regla, distinta de la que usa la aplicación.
     */
    const tenants = (await queryRunner.query(
      'SELECT `id`, `name` FROM `tenants` ORDER BY `createdAt` ASC',
    )) as { id: string; name: string }[];

    const taken = new Set<string>();
    for (const tenant of tenants) {
      const slug = buildUniqueSlug(tenant.name ?? '', taken);
      taken.add(slug);

      await queryRunner.query(
        'UPDATE `tenants` SET `slug` = ? WHERE `id` = ?',
        [slug, tenant.id],
      );
    }

    await queryRunner.query(
      'CREATE UNIQUE INDEX `IDX_2310ecc5cb8be427097154b18fc` ON `tenants` (`slug`)',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX `IDX_2310ecc5cb8be427097154b18fc` ON `tenants`',
    );
    await queryRunner.query(
      'ALTER TABLE `tenants` DROP COLUMN `slug`, DROP COLUMN `address`',
    );
  }
}
