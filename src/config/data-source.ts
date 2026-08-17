import { registerAs } from '@nestjs/config';
import { config as dotenvConfig } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';

dotenvConfig({ path: '.env' });

const configDB = {
  type: 'mysql',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../migrations/*{.ts,.js}'],

  /**
   * Siempre apagado, también en desarrollo.
   *
   * `synchronize` altera el esquema comparando entidades contra la base, sin
   * revisión ni historial: renombrar una propiedad borra la columna vieja y crea
   * otra vacía, y un índice que MySQL esté usando para sostener una foreign key
   * deja la app en un bucle de arranque.
   *
   * Tampoco conviene dejarlo encendido "solo en dev": lo que sincroniza a mano
   * no queda en ninguna migración, y la siguiente que se genere intentará
   * aplicar de nuevo un cambio que la base ya tiene. Un único camino para
   * cambiar el esquema, y es `migrations`.
   */
  synchronize: false,

  /**
   * Las migraciones pendientes corren al arrancar la app. Alcanza mientras haya
   * una sola instancia; con varias arrancando a la vez conviene sacarlas a un
   * paso propio del deploy (`npm run migration:run`) antes de levantar el
   * proceso, porque el DDL de MySQL no es transaccional y dos instancias
   * podrían pisarse.
   */
  migrationsRun: true,

  dropSchema: false,
  legacySpatialSupport: false,
  logging: ['error'],
};

export const dbConfig = registerAs('database', () => configDB);
export const connectionSource = new DataSource(configDB as DataSourceOptions);
