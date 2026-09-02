import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El saludo con el que Polaria recibe a un cliente, escrito por el negocio.
 *
 * Era una constante en el código y por lo tanto el mismo texto para todos: la
 * primera frase que lee un cliente —la única parte de la conversación que el
 * negocio no controlaba— sonaba igual en una barbería que en un consultorio.
 *
 * `NULL` no es "sin saludo" sino "el de fábrica", y es el estado normal: la
 * enorme mayoría no va a tocarlo, y hacer que la columna naciera con el texto
 * copiado en cada fila habría congelado esa copia. Un cambio en el saludo por
 * defecto —una palabra que se lee mal, un emoji que no rinde— tiene que llegar
 * a todos los que nunca lo editaron, y con el valor copiado no llegaría a
 * ninguno.
 *
 * `varchar(1024)` y no `text`: es el techo del cuerpo de un mensaje con
 * botones, así que nada más largo podría enviarse. Lo que se acepta desde el
 * panel es bastante menos —ver `WELCOME_MESSAGE_MAX_LENGTH`—; la diferencia es
 * el margen que deja el nombre del negocio al reemplazar el marcador.
 */
export class WelcomeMessage1788800000000 implements MigrationInterface {
  name = 'WelcomeMessage1788800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`tenants\` ADD \`welcomeMessage\` varchar(1024) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`tenants\` DROP COLUMN \`welcomeMessage\``,
    );
  }
}
