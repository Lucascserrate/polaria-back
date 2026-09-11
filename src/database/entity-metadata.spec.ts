import 'reflect-metadata';
import { DataSource } from 'typeorm';

/**
 * Que las entidades se puedan traducir a columnas de MySQL.
 *
 * Existe por una caída: declarar `businessType!: string | null` sin escribir el
 * `type` del `@Column` compilaba, pasaba el linter y pasaba los 765 tests, y la
 * aplicación no arrancaba. TypeORM deduce la columna del tipo de TypeScript, y
 * de una unión lo que reflexiona es `Object`, que ningún motor sabe qué es. El
 * fallo ocurre al construir los metadatos, o sea antes de atender la primera
 * petición, así que en producción se vio como un reinicio en bucle.
 *
 * Nada de lo que había podía verlo: es un error de metadatos en tiempo de
 * arranque, no de tipos ni de lógica, y ninguna prueba levantaba el DataSource.
 *
 * No se conecta a nada. `buildMetadatas` es el paso que valida, y no necesita
 * base: las credenciales de abajo son de relleno para poder construir el
 * driver, que es lo único que exige el constructor.
 */
describe('metadatos de las entidades', () => {
  it('todas se traducen a columnas que MySQL soporta', async () => {
    const dataSource = new DataSource({
      type: 'mysql',
      host: 'localhost',
      port: 3306,
      username: 'unused',
      password: 'unused',
      database: 'unused',
      // El mismo glob que usa `data-source.ts`, resuelto desde `src`.
      entities: [`${__dirname}/../**/*.entity{.ts,.js}`],
    });

    await expect(
      (
        dataSource as unknown as { buildMetadatas: () => Promise<void> }
      ).buildMetadatas(),
    ).resolves.toBeUndefined();

    // Si el glob dejara de encontrar entidades, la prueba pasaría sin mirar
    // ninguna. Es la comprobación de que estuvo mirando algo.
    expect(dataSource.entityMetadatas.length).toBeGreaterThan(10);
  });
});
