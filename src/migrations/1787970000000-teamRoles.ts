import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El personal pasa a ser el equipo: rol, si atiende, nombre partido y color.
 *
 * La propiedad que sostiene esta migración es que **no cambia el comportamiento
 * de nada**. Todo el equipo que ya existía era reservable, así que
 * `providesServices` nace en `true` y nadie desaparece de la agenda; `accessRole`
 * nace en `PROFESSIONAL` pero todavía no habilita ninguna sesión, porque el login
 * sigue siendo únicamente el del dueño.
 *
 * `name` no se toca. Se sigue guardando, ahora derivado de `firstName` y
 * `lastName`: es lo que leen los reportes, los avisos de WhatsApp y las consultas
 * que ordenan alfabéticamente. Ver `utils/display-name.ts`.
 */
export class TeamRoles1787970000000 implements MigrationInterface {
  name = 'TeamRoles1787970000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`staff\`
         ADD \`firstName\` varchar(255) NULL,
         ADD \`lastName\` varchar(255) NULL,
         ADD \`jobTitle\` varchar(120) NULL,
         ADD \`calendarColor\` varchar(16) NULL,
         ADD \`accessRole\` varchar(16) NOT NULL DEFAULT 'PROFESSIONAL',
         ADD \`providesServices\` tinyint NOT NULL DEFAULT 1`,
    );

    /*
     * Parte lo cargado: primer token el nombre, el resto el apellido.
     *
     * `CHAR_LENGTH` y no `LENGTH`: la segunda cuenta bytes, y con un nombre
     * acentuado —"José Pérez"— el corte caería a mitad de carácter y el apellido
     * saldría con basura. Es el mismo criterio que `splitFullName`, que es quien
     * lo tiene testeado.
     */
    await queryRunner.query(
      `UPDATE \`staff\` SET
         \`firstName\` = SUBSTRING_INDEX(TRIM(\`name\`), ' ', 1),
         \`lastName\` = NULLIF(
           TRIM(SUBSTRING(
             TRIM(\`name\`),
             CHAR_LENGTH(SUBSTRING_INDEX(TRIM(\`name\`), ' ', 1)) + 1
           )),
           ''
         )`,
    );

    // Recién ahora es obligatorio: antes del backfill, la columna estaba vacía.
    await queryRunner.query(
      `ALTER TABLE \`staff\` MODIFY \`firstName\` varchar(255) NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // `name` nunca dejó de escribirse, así que volver atrás no pierde el nombre
    // de nadie.
    await queryRunner.query(
      `ALTER TABLE \`staff\`
         DROP COLUMN \`providesServices\`,
         DROP COLUMN \`accessRole\`,
         DROP COLUMN \`calendarColor\`,
         DROP COLUMN \`jobTitle\`,
         DROP COLUMN \`lastName\`,
         DROP COLUMN \`firstName\``,
    );
  }
}
