import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Deja que un servicio no tenga precio.
 *
 * Hasta ahora todo servicio tenía uno, y para los rubros que cotizan después de
 * ver a la persona —una coloración, un tratamiento de piel, una ortodoncia— la
 * única salida era inventar un número. Un precio inventado es peor que ninguno:
 * el cliente lo lee como una promesa.
 *
 * `NULL` es "todavía no se sabe", y es distinto de `0`, que es "no se cobra".
 * Esa diferencia es la razón de hacerlo con la columna nullable y no con una
 * bandera al lado: con bandera, todo lo que no la mire —un `SUM`, una lista, un
 * mensaje— sigue leyendo el `0` y muestra un servicio gratis. Con `NULL`, lo que
 * no lo contempla devuelve nada, que es lo que hay.
 *
 * Lo mismo en `priceAtBooking`: una cita de un servicio que se cotiza nace sin
 * importe y lo recibe cuando el negocio lo escribe. Mientras tanto no suma a la
 * facturación, que es correcto —esa plata todavía no está pactada— y es lo que
 * `SUM` hace solo con los `NULL`.
 *
 * Ninguna fila existente cambia: todas tienen precio y siguen igual.
 */
export class QuotedPrice1789700000000 implements MigrationInterface {
  name = 'QuotedPrice1789700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`services\` MODIFY \`price\` decimal(10,2) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`appointment_services\`
         MODIFY \`priceAtBooking\` decimal(10,2) NULL`,
    );
  }

  /**
   * Volver atrás no puede dejar la columna sin valor, así que lo que se cotizaba
   * queda en `0`. Es una pérdida real —deja de distinguirse de lo gratuito— y por
   * eso está acá y no en el `up`: es el precio de revertir, no una conversión.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE \`services\` SET \`price\` = 0 WHERE \`price\` IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`services\` MODIFY \`price\` decimal(10,2) NOT NULL`,
    );

    await queryRunner.query(
      `UPDATE \`appointment_services\`
         SET \`priceAtBooking\` = 0 WHERE \`priceAtBooking\` IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`appointment_services\`
         MODIFY \`priceAtBooking\` decimal(10,2) NOT NULL`,
    );
  }
}
