import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Le da a `clients` lo que necesita para ser una ficha y no sólo un teléfono con
 * nombre: email, cumpleaños, por qué puerta entró, y una baja que no destruya.
 *
 * `deletedAt` es la columna que más importa y no se nota. Sin ella, la única
 * forma de sacar a un cliente de la lista era el `DELETE`, y
 * `appointments.clientId` borra en cascada: se llevaba sus citas y con ellas los
 * `appointment_services`, que es donde vive `priceAtBooking`. O sea que eliminar
 * a un cliente le borraba al negocio su propia facturación, sin preguntar nada.
 *
 * `createdVia` se rellena sólo donde hay evidencia y se deja en `NULL` en el
 * resto. Suponerlo sería peor que no saberlo: la única pregunta que esta columna
 * existe para responder —cuántos clientes trajo cada canal— quedaría contestada
 * con datos inventados, y nadie podría distinguir después lo medido de lo
 * adivinado.
 */
export class ClientProfileAndSoftDelete1788700000000 implements MigrationInterface {
  name = 'ClientProfileAndSoftDelete1788700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`clients\`
         ADD \`email\` varchar(255) NULL,
         ADD \`birthDate\` date NULL,
         ADD \`createdVia\` enum ('whatsapp', 'web', 'panel') NULL,
         ADD \`deletedAt\` datetime(6) NULL`,
    );

    /*
     * Un cliente con conversación llegó por WhatsApp, y se puede afirmar: el
     * asistente crea la conversación inmediatamente después del cliente, en el
     * mismo flujo, y ningún otro canal crea conversaciones. Es la única parte
     * del pasado que se puede reconstruir sin adivinar.
     *
     * Los demás —con teléfono y sin conversación— pudieron entrar por la página
     * pública o haberlos cargado el negocio a mano, y nada en la base los
     * distingue. Se quedan en `NULL`.
     */
    await queryRunner.query(
      `UPDATE \`clients\` \`c\`
          SET \`c\`.\`createdVia\` = 'whatsapp'
        WHERE EXISTS (
          SELECT 1 FROM \`conversations\` \`v\` WHERE \`v\`.\`clientId\` = \`c\`.\`id\`
        )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /*
     * Los clientes dados de baja vuelven a aparecer en la lista al revertir. Es
     * lo correcto: sus filas y su historial siguen enteros, y lo único que se
     * pierde es la marca de que el negocio los había archivado. Borrarlos para
     * "respetar" esa marca convertiría una reversión en una pérdida de datos.
     */
    await queryRunner.query(
      `ALTER TABLE \`clients\`
         DROP COLUMN \`email\`,
         DROP COLUMN \`birthDate\`,
         DROP COLUMN \`createdVia\`,
         DROP COLUMN \`deletedAt\``,
    );
  }
}
