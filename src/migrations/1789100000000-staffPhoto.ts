import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * La foto de un miembro del equipo.
 *
 * Columna en `staff` y no tabla aparte —como sí lo son las fotos del local—
 * porque es una sola por persona: no hay orden que guardar ni portada que
 * elegir, y el identificador en Cloudinary es determinista
 * (`.../staff/<staffId>`), así que se reconstruye y no hace falta guardarlo.
 * Es el mismo trato que `tenants.logoUrl`; ver esa migración para por qué se
 * guarda la URL con versión y no el identificador.
 *
 * `NULL` significa "sin foto", que es el estado de todo el equipo que ya
 * existe y el que tiene que verse bien: sin foto se muestran las iniciales
 * sobre el color de la agenda, que no es un hueco esperando una imagen sino la
 * forma normal de reconocer a alguien en la lista.
 */
export class StaffPhoto1789100000000 implements MigrationInterface {
  name = 'StaffPhoto1789100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`staff\` ADD \`photoUrl\` varchar(512) NULL`,
    );
  }

  /**
   * Revertir borra la referencia, no el archivo: las fotos siguen en Cloudinary
   * y se recuperan volviendo a aplicar la migración y subiéndolas de nuevo.
   * Borrarlas desde acá sería destruir datos por un cambio de esquema.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`staff\` DROP COLUMN \`photoUrl\``);
  }
}
