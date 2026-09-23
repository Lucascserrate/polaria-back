import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Deja que un negocio declare qué categorías se pueden atender al mismo tiempo.
 *
 * Nace de un salón de uñas: una clienta que pide manicure y pedicure no espera
 * dos horas, espera una, porque son dos profesionales trabajando a la vez. Hasta
 * ahora el planificador sumaba las duraciones de todos los servicios de una
 * reserva, así que ofrecía el doble de tiempo del que el trabajo realmente lleva.
 *
 * La regla va entre **categorías** y no entre servicios porque diez manicures y
 * diez pedicures son cien pares, y ese es exactamente el trabajo de carga que
 * hace que nadie configure la función. Entre categorías es una sola fila.
 *
 * **Nace vacía, y esa es la propiedad importante.** Sin reglas ningún par es
 * compatible, el planificador produce un único plan —una ronda por servicio— y
 * ese plan es idéntico al encadenado de siempre. Ningún negocio cambia de
 * comportamiento hasta que lo pide, y borrar sus reglas lo devuelve al anterior
 * sin migrar ningún dato.
 *
 * El par se guarda en forma canónica (`categoryAId` < `categoryBId`), que es lo
 * que permite que el índice único impida duplicados: la regla es simétrica, y
 * con una fila por sentido sería posible que A permita a B sin que B permita a
 * A. Quien lo normaliza es el servicio; acá se sostiene.
 *
 * `ON DELETE CASCADE` sobre las categorías, a diferencia de `services`: una
 * regla sin sus dos categorías no es un dato a medias, no es nada. Borrar
 * "Pedicures" tiene que llevarse la regla, no dejarla apuntando al vacío.
 */
export class CategorySchedulingRules1790100000000 implements MigrationInterface {
  name = 'CategorySchedulingRules1790100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`category_scheduling_rules\` (
         \`id\` varchar(36) NOT NULL,
         \`tenantId\` varchar(36) NOT NULL,
         \`categoryAId\` varchar(36) NOT NULL,
         \`categoryBId\` varchar(36) NOT NULL,
         \`mode\` varchar(24) NOT NULL DEFAULT 'PARALLEL',
         \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
         \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
           ON UPDATE CURRENT_TIMESTAMP(6),
         INDEX \`IDX_category_scheduling_rules_tenant\` (\`tenantId\`),
         UNIQUE INDEX \`UQ_category_scheduling_rules_pair\`
           (\`tenantId\`, \`categoryAId\`, \`categoryBId\`),
         PRIMARY KEY (\`id\`)
       ) ENGINE=InnoDB`,
    );

    await queryRunner.query(
      `ALTER TABLE \`category_scheduling_rules\`
         ADD CONSTRAINT \`FK_category_scheduling_rules_tenant\`
         FOREIGN KEY (\`tenantId\`) REFERENCES \`tenants\`(\`id\`)
         ON DELETE CASCADE`,
    );

    await queryRunner.query(
      `ALTER TABLE \`category_scheduling_rules\`
         ADD CONSTRAINT \`FK_category_scheduling_rules_category_a\`
         FOREIGN KEY (\`categoryAId\`) REFERENCES \`service_categories\`(\`id\`)
         ON DELETE CASCADE`,
    );

    await queryRunner.query(
      `ALTER TABLE \`category_scheduling_rules\`
         ADD CONSTRAINT \`FK_category_scheduling_rules_category_b\`
         FOREIGN KEY (\`categoryBId\`) REFERENCES \`service_categories\`(\`id\`)
         ON DELETE CASCADE`,
    );
  }

  /**
   * Volver atrás borra las reglas y nada más. Ninguna cita las referencia: lo
   * que una regla produjo son segmentos con horarios propios, que ya están
   * escritos y siguen siendo válidos. Una reserva paralela creada bajo esta
   * migración sobrevive a revertirla; lo único que se pierde es la capacidad de
   * volver a ofrecer una igual.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`category_scheduling_rules\``);
  }
}
