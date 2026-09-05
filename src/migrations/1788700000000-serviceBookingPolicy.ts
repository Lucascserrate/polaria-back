import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Separa "el negocio ofrece esto" de "el cliente puede reservarlo solo".
 *
 * Hasta ahora eran lo mismo: todo servicio activo aparecía entre las opciones. Eso
 * deja afuera a los rubros donde hay que ver a la persona antes de agendar —una
 * ortodoncia, un tratamiento estético, una coloración que necesita prueba de
 * mecha—, y el único recorte disponible era darlo de baja, que lo borra del
 * catálogo y del asistente.
 *
 * Todas las filas existentes quedan en `CLIENT_BOOKS`, que es lo que hoy son. Es el
 * default de la columna, así que el `ALTER TABLE` ya las deja ahí sin necesidad de
 * un `UPDATE`: no hay ningún negocio al que esto le cambie el comportamiento.
 *
 * `varchar` y no `enum` de MySQL para que sumar una política —"requiere seña",
 * "requiere aprobación"— no sea un `ALTER TABLE` sobre una tabla que crece con cada
 * negocio. El valor lo valida el DTO.
 */
export class ServiceBookingPolicy1788700000000 implements MigrationInterface {
  name = 'ServiceBookingPolicy1788700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`services\`
         ADD \`bookingPolicy\` varchar(24) NOT NULL DEFAULT 'CLIENT_BOOKS'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`services\` DROP COLUMN \`bookingPolicy\``,
    );
  }
}
