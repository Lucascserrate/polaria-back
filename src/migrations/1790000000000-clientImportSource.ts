import { MigrationInterface, QueryRunner } from 'typeorm';

const TABLE = 'clients';
const COLUMN = 'createdVia';
const VALUES = ['whatsapp', 'web', 'panel', 'import'] as const;

/**
 * `createdVia` aprende una cuarta puerta de entrada: la importación de contactos.
 *
 * El valor nuevo existe para no arruinar la única pregunta que esta columna
 * contesta —de dónde salió cada cliente—. Un negocio que importa su agenda del
 * teléfono carga mil fichas de una sentada; si entraran como `panel`, el panel
 * pasaría a explicar el 90% de la cartera y nadie podría volver a leer ese
 * número. Con un valor propio, el día que se pregunte "¿cuántos me trajo
 * WhatsApp?" la respuesta sigue siendo verdad.
 *
 * Es un `MODIFY` y no un `ADD`: agregar un valor a un enum de MySQL reescribe la
 * definición entera de la columna, así que hay que enumerarlos todos. Las filas
 * que ya están no se tocan —ningún valor viejo desaparece— y la columna sigue
 * admitiendo `NULL`, que es lo que tienen los clientes anteriores a que se
 * registrara el canal.
 *
 * Pregunta antes de actuar porque el DDL de MySQL no es transaccional: una
 * migración que falla a la mitad deja su trabajo hecho pero sin registrar, y el
 * arranque siguiente la reintenta desde cero. Ver `PhotoKind1789400000000`.
 */
export class ClientImportSource1790000000000 implements MigrationInterface {
  name = 'ClientImportSource1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await hasValue(queryRunner, 'import')) return;

    await queryRunner.query(
      `ALTER TABLE \`${TABLE}\`
        MODIFY \`${COLUMN}\` enum(${VALUES.map((value) => `'${value}'`).join(', ')}) NULL`,
    );
  }

  /**
   * Volver atrás implica decidir qué pasa con los clientes importados, y la
   * única respuesta que no pierde información es dejarlos como cargados a mano:
   * es lo más parecido que existe sin el valor nuevo. Se hace antes de achicar
   * el enum, porque si no MySQL los convertiría en cadena vacía sin avisar.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await hasValue(queryRunner, 'import'))) return;

    await queryRunner.query(
      `UPDATE \`${TABLE}\` SET \`${COLUMN}\` = 'panel' WHERE \`${COLUMN}\` = 'import'`,
    );

    await queryRunner.query(
      `ALTER TABLE \`${TABLE}\`
        MODIFY \`${COLUMN}\` enum('whatsapp', 'web', 'panel') NULL`,
    );
  }
}

/**
 * Si el enum de la base ya admite ese valor.
 *
 * Se pregunta por `information_schema` y no con `SHOW COLUMNS` porque acá se
 * puede filtrar por `DATABASE()`: un mismo servidor MySQL puede alojar varios
 * entornos, y sin ese filtro la respuesta sería "existe en algún lado". Mismo
 * criterio que `PhotoKind1789400000000`.
 */
const hasValue = async (
  queryRunner: QueryRunner,
  value: string,
): Promise<boolean> => {
  const rows = (await queryRunner.query(
    `SELECT COLUMN_TYPE AS type
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?`,
    [TABLE, COLUMN],
  )) as Array<{ type: string }>;

  return rows[0]?.type.includes(`'${value}'`) ?? false;
};
