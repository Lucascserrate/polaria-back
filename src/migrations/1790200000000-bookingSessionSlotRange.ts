import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Recuerda qué tramo del día está mirando quien reserva por WhatsApp.
 *
 * Nace de un límite del canal: una lista nativa tiene diez filas y una jornada de
 * doce horas no entra. Paginando, llegar a las 17:00 desde las 9:00 costaba dos
 * toques de "ver más" con horarios cada media hora y cinco con horarios cada
 * cuarto — y ese costo crece con el largo del día, así que el negocio con más
 * para ofrecer es al que peor se le ofrece. Agrupando en tramos, llegar a
 * cualquier hora cuesta uno solo.
 *
 * Son dos columnas y no el número del tramo elegido, y la diferencia importa:
 * los tramos se calculan de la disponibilidad del momento, así que si entra una
 * reserva mientras el cliente decide, "el segundo tramo" pasa a señalar otra
 * cosa. Un par de instantes no puede cambiar de significado.
 *
 * `NULL` en las dos es el estado normal: el cliente todavía no eligió tramo, o el
 * día tenía pocos horarios y nunca se le ofrecieron agrupados. Las sesiones que
 * ya existen quedan así, que es exactamente donde estaban.
 */
export class BookingSessionSlotRange1790200000000 implements MigrationInterface {
  name = 'BookingSessionSlotRange1790200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`booking_sessions\`
         ADD \`selectedRangeStart\` datetime NULL,
         ADD \`selectedRangeEnd\` datetime NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`booking_sessions\`
         DROP COLUMN \`selectedRangeStart\`,
         DROP COLUMN \`selectedRangeEnd\``,
    );
  }
}
