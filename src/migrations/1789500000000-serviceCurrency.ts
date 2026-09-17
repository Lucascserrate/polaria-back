import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * La moneda pasa a ser del servicio, no del negocio.
 *
 * Era una columna del tenant, y con eso un catálogo sólo podía tener precios en
 * una moneda. Eso no alcanza: una psicóloga cobra las sesiones presenciales en
 * bolivianos y las online para el exterior en dólares, en el mismo catálogo. La
 * moneda no es una preferencia del negocio, es parte del precio.
 *
 * `tenants.currency` **no se elimina**: pasa a ser el valor por defecto de un
 * servicio nuevo, deducido de la zona horaria al crear el negocio. Sigue siendo
 * la respuesta correcta para el 99% de los catálogos, que usan una sola moneda y
 * no deberían tener que elegirla servicio por servicio.
 *
 * `currencyAtBooking` congela la moneda junto al precio, por la misma razón que
 * `priceAtBooking`: una cita agendada conserva lo que costaba cuando se agendó.
 * Sin esto, pasar un servicio de bolivianos a dólares reescribiría el historial
 * y la facturación de todas las citas viejas.
 */
export class ServiceCurrency1789500000000 implements MigrationInterface {
  name = 'ServiceCurrency1789500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`services\` ADD \`currency\` varchar(3) NOT NULL DEFAULT 'BOB'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`appointment_services\` ADD \`currencyAtBooking\` varchar(3) NOT NULL DEFAULT 'BOB'`,
    );

    /*
     * Lo que ya existe hereda la moneda de su negocio, que hasta ahora era la
     * única que tenía. El default de la columna es boliviano y arrancar todo en
     * boliviano le cambiaría la moneda a los negocios que no son de Bolivia.
     */
    await queryRunner.query(
      `UPDATE \`services\` \`s\`
         JOIN \`tenants\` \`t\` ON \`t\`.\`id\` = \`s\`.\`tenantId\`
          SET \`s\`.\`currency\` = \`t\`.\`currency\``,
    );

    /*
     * Las citas ya agendadas se congelan con la moneda que su negocio tenía, que
     * es la que estaba vigente cuando se agendaron: la moneda por servicio no
     * existía, así que no hay una más precisa que esa.
     */
    await queryRunner.query(
      `UPDATE \`appointment_services\` \`seg\`
         JOIN \`appointments\` \`a\` ON \`a\`.\`id\` = \`seg\`.\`appointmentId\`
         JOIN \`tenants\` \`t\` ON \`t\`.\`id\` = \`a\`.\`tenantId\`
          SET \`seg\`.\`currencyAtBooking\` = \`t\`.\`currency\``,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Un catálogo con dos monedas no se puede volver a guardar en una sola
    // columna del negocio: al bajar, esos precios pierden su unidad.
    await queryRunner.query(
      `ALTER TABLE \`appointment_services\` DROP COLUMN \`currencyAtBooking\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`services\` DROP COLUMN \`currency\``,
    );
  }
}
