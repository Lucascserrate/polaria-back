import { MigrationInterface, QueryRunner } from 'typeorm';

/** El enum de estados con el paso de categorías, en el orden de la entidad. */
const STATES_WITH_CATEGORY = `'ASK_CATEGORY', 'ASK_SERVICE', 'ASK_STAFF', 'ASK_SLOT', 'ASK_DATE', 'CONFIRM', 'COMPLETED', 'CANCELLED', 'EXPIRED'`;

const STATES_WITHOUT_CATEGORY = `'ASK_SERVICE', 'ASK_STAFF', 'ASK_SLOT', 'ASK_DATE', 'CONFIRM', 'COMPLETED', 'CANCELLED', 'EXPIRED'`;

/**
 * El flujo de WhatsApp puede preguntar la categoría antes del servicio.
 *
 * Una lista nativa muestra diez filas. Un salón con treinta servicios entraba en
 * un "Ver más opciones" que hay que tocar tres veces para ver el catálogo, y el
 * cliente abandona antes. Preguntar la categoría primero convierte esa lista
 * imposible en dos cortas.
 *
 * El paso es **condicional**, no un paso nuevo del recorrido: mientras el
 * catálogo entre en una lista, el flujo sigue yendo directo al servicio. Ver
 * `planServiceStep`.
 *
 * `categorySelection` existe por lo mismo que `staffPreference`: sin ella, un
 * `selectedCategoryId` nulo no distingue "eligió Otros servicios" de "no hubo
 * paso de categorías", y el paso siguiente no sabría si filtrar por los que no
 * tienen categoría o no filtrar nada. Las dos columnas nacen en `NULL`, que es lo
 * correcto para las sesiones abiertas al momento de desplegar: son de negocios
 * sin categorías, o de un flujo que ya pasó ese punto.
 *
 * `selectedCategoryId` **no** lleva foreign key, a diferencia de la del catálogo.
 * Es a propósito: una sesión dura quince minutos y es un registro de lo que el
 * cliente tocó, no del catálogo. Si el negocio borra la categoría en el medio, la
 * reserva en curso no tiene que romperse ni perder el dato; lo que pasa es que el
 * paso siguiente no encuentra servicios y el flujo lo resuelve como cualquier
 * otro callejón.
 */
export class BookingCategoryStep1789900000000 implements MigrationInterface {
  name = 'BookingCategoryStep1789900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`booking_sessions\`
         MODIFY \`state\` enum (${STATES_WITH_CATEGORY})
         NOT NULL DEFAULT 'ASK_SERVICE'`,
    );

    await queryRunner.query(
      `ALTER TABLE \`booking_sessions\`
         ADD \`categorySelection\` enum ('SPECIFIC', 'UNCATEGORIZED') NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`booking_sessions\`
         ADD \`selectedCategoryId\` varchar(36) NULL`,
    );
  }

  /**
   * Las sesiones paradas en el paso de categorías no pueden seguir existiendo en
   * un esquema donde ese estado no existe, así que se cierran. Son como mucho las
   * de los últimos quince minutos y el cliente puede volver a empezar; la
   * alternativa —dejarlas en un estado que el enum no admite— no la acepta MySQL.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE \`booking_sessions\`
          SET \`state\` = 'CANCELLED', \`closedReason\` = 'schema-rollback'
        WHERE \`state\` = 'ASK_CATEGORY'`,
    );

    await queryRunner.query(
      `ALTER TABLE \`booking_sessions\` DROP COLUMN \`selectedCategoryId\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`booking_sessions\` DROP COLUMN \`categorySelection\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`booking_sessions\`
         MODIFY \`state\` enum (${STATES_WITHOUT_CATEGORY})
         NOT NULL DEFAULT 'ASK_SERVICE'`,
    );
  }
}
