import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * La plantilla `staff_alert` parametrizada se parte en tres, una por evento.
 *
 * No hay cambio de esquema: `whatsapp_templates` ya está indexada por
 * `(tenantId, templateKey)` y las filas nuevas las crea el aprovisionamiento. Lo
 * único que hace esta migración es borrar la fila que quedó huérfana.
 *
 * Esa fila existe porque el aprovisionamiento **guarda también los fallos**, para
 * poder espaciar los reintentos: en producción quedó una `staff_alert` en
 * `NOT_CREATED` del rechazo de Meta (`code=100, subcode=2388293`). Con la clave
 * fuera de `TEMPLATE_KEYS` esa fila ya no la lee nadie —es inerte— pero dejarla es
 * dejar una afirmación falsa en la tabla: dice que este negocio tiene una plantilla
 * llamada `staff_alert`, que ya no existe en el código.
 *
 * No se toca nada en Meta. Si el rechazo llegó a dejar una plantilla registrada en
 * alguna WABA, se resuelve desde el Business Manager: los nombres nuevos son otros
 * —`polaria_staff_appointment_new`, `_moved`, `_cancelled`— así que no colisionan.
 */
export class SplitStaffAlertTemplates1788230000000 implements MigrationInterface {
  name = 'SplitStaffAlertTemplates1788230000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM \`whatsapp_templates\` WHERE \`templateKey\` = 'staff_alert'`,
    );
  }

  public async down(): Promise<void> {
    /*
     * Sin vuelta atrás, y no es una omisión.
     *
     * Lo que se borró era el registro de un intento fallido de una plantilla que ya
     * no existe en el código. Recrearlo daría una fila que apunta a una clave que
     * nadie lee, y el aprovisionamiento la volvería a generar sola si se revirtiera
     * el código.
     */
  }
}
