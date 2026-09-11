import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Franjas marcadas como no disponibles.
 *
 * Es la capa de excepciones por fecha que el resto del cálculo de horarios ya
 * daba por venir: `staff_schedules` es jornada recurrente y no puede decir "hoy
 * de 15:00 a 17:00 no se atiende", y `working-hours.resolver` recibe la fecha
 * completa —y no el día de la semana— justamente para poder preguntarle a esta
 * tabla si aplica.
 *
 * `staffId` nulable porque el bloqueo tiene dos alcances reales: una persona que
 * se va al médico y el local que cierra un rato. NULL es el segundo. Con una
 * tabla por alcance habría que consultar las dos en cada cálculo, y con una fila
 * por persona cerrar el local sería crear y borrar N filas a mano.
 *
 * Sin índice único: dos bloqueos que se pisan no son un error de datos, son
 * alguien anotando dos motivos distintos para el mismo rato. Lo que importa es
 * la unión de las franjas, y eso lo resuelve quien las resta.
 */
export class ScheduleBlocks1789300000000 implements MigrationInterface {
  name = 'ScheduleBlocks1789300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`schedule_blocks\` (
        \`id\` varchar(36) NOT NULL,
        \`tenantId\` varchar(36) NOT NULL,
        \`staffId\` varchar(36) NULL,
        \`startTime\` timestamp NOT NULL,
        \`endTime\` timestamp NOT NULL,
        \`reason\` varchar(140) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX \`IDX_schedule_blocks_tenant_start\` (\`tenantId\`, \`startTime\`),
        INDEX \`IDX_schedule_blocks_tenant_staff_start\` (\`tenantId\`, \`staffId\`, \`startTime\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB`,
    );

    await queryRunner.query(
      `ALTER TABLE \`schedule_blocks\`
        ADD CONSTRAINT \`FK_schedule_blocks_tenant\`
        FOREIGN KEY (\`tenantId\`) REFERENCES \`tenants\`(\`id\`)
        ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    /*
     * `CASCADE` y no `SET NULL`: al borrar físicamente a un profesional, sus
     * bloqueos se van con él. Convertirlos en bloqueos del negocio entero sería
     * cerrarle el local por algo que era de una persona que ya no está.
     *
     * La baja lógica —que es el camino normal, ver `resolveStaffDeletion`— no
     * dispara nada de esto y deja las filas vivas. No hacen daño: quien no
     * recibe reservas no tiene jornada de la que restar.
     */
    await queryRunner.query(
      `ALTER TABLE \`schedule_blocks\`
        ADD CONSTRAINT \`FK_schedule_blocks_staff\`
        FOREIGN KEY (\`staffId\`) REFERENCES \`staff\`(\`id\`)
        ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`schedule_blocks\` DROP FOREIGN KEY \`FK_schedule_blocks_staff\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`schedule_blocks\` DROP FOREIGN KEY \`FK_schedule_blocks_tenant\``,
    );
    await queryRunner.query(`DROP TABLE \`schedule_blocks\``);
  }
}
