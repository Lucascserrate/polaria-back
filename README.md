<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Migraciones de base de datos

El esquema se cambia **solo** con migraciones. `synchronize` está apagado en
todos los entornos, también en desarrollo: dejarlo encendido "solo en dev"
genera deriva, porque lo que sincroniza a mano no queda en ninguna migración y
la siguiente que se genere intenta aplicar un cambio que la base ya tiene.

Las migraciones pendientes se aplican **automáticamente al arrancar la app**
(`migrationsRun: true` en [`src/config/data-source.ts`](src/config/data-source.ts)).

### Comandos

```bash
# Generar una migración con el diff entre las entidades y la base actual
$ npm run migration:generate -- src/migrations/NombreDescriptivo

# Crear una migración vacía, para escribirla a mano
$ npm run migration:create -- src/migrations/NombreDescriptivo

# Aplicar las pendientes sin arrancar la app
$ npm run migration:run

# Revertir la última aplicada
$ npm run migration:revert

# Ver cuáles están aplicadas ([X]) y cuáles pendientes ([ ])
$ npm run migration:show
```

### Flujo para cambiar el esquema

1. Modificá la entidad (agregar columna, índice, tabla…).
2. `npm run migration:generate -- src/migrations/AgregarLoQueSea`
3. **Abrí el archivo generado y leé el SQL.** Que se pueda revisar antes de que
   toque la base es la mitad del valor de usar migraciones. Prestá atención a
   cualquier `DROP COLUMN`: un rename mal interpretado se ve así y borra datos.
4. Arrancá la app; la migración se aplica sola.

> **Ojo:** `migration:generate` compara las entidades contra la base a la que se
> conecta. Si esa base ya tiene el cambio aplicado a mano, genera una migración
> vacía.

### Crear el esquema desde cero

```bash
# Sin migraciones previas y con la base vacía: recién ahí el diff es el
# esquema completo.
$ rm src/migrations/*.ts
$ mysql -u root -p -e "DROP DATABASE IF EXISTS polaria; CREATE DATABASE polaria;"
$ npm run migration:generate -- src/migrations/InitialSchema
$ npm run start:dev
```

El orden importa. Si se genera contra una base que ya tiene el esquema, sale una
migración casi vacía —o peor, una que borra lo que las entidades no declaran— y
el error no se nota hasta que alguien levanta el proyecto desde cero.
Verificación rápida: el `InitialSchema` tiene que traer un `CREATE TABLE` por
cada entidad. Si son veinte líneas, la base no estaba vacía.

### Adoptar migraciones sin perder los datos

Cuando la base ya tiene el esquema —creado por un `synchronize` viejo o por otra
vía— y **no** se puede dropear, la baseline se arma contra una base descartable
y después se marca como aplicada en la real. La base con datos nunca se toca.

```bash
# 1. Base descartable, vacía
$ mysql -u root -p -e "CREATE DATABASE polaria_baseline;"

# 2. Generar la baseline apuntando a ella (la variable de entorno le gana al
#    .env, porque dotenv no pisa lo que ya está en process.env)
$ DB_NAME=polaria_baseline npm run migration:generate -- src/migrations/InitialSchema

# 3. Descartar la base auxiliar
$ mysql -u root -p -e "DROP DATABASE polaria_baseline;"

# 4. Marcar la migración como aplicada en la base real, para que TypeORM la
#    saltee en vez de intentar crear tablas que ya existen. El nombre y el
#    timestamp salen del archivo generado.
$ mysql -u root -p polaria -e "INSERT INTO migrations (timestamp, name) VALUES (1786311672585, 'InitialSchema1786311672585');"
```

En PowerShell el paso 2 es `$env:DB_NAME='polaria_baseline'; npm run migration:generate -- src/migrations/InitialSchema; Remove-Item Env:\DB_NAME`.

Si la tabla `migrations` todavía no existe en la base real, TypeORM la crea al
primer arranque; también se puede crear a mano:

```sql
CREATE TABLE IF NOT EXISTS migrations (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  timestamp BIGINT NOT NULL,
  name VARCHAR(255) NOT NULL
);
```

De ahí en adelante todo cambio es una migración incremental y nada se dropea.

### En producción

Las migraciones viajan compiladas en `dist/migrations` y se aplican al bootear,
así que un deploy normal alcanza. Dos advertencias:

- **Si la base ya tiene las tablas** (creadas por un `synchronize` anterior), la
  migración inicial falla al intentar crearlas de nuevo. La salida es adoptar
  migraciones sin perder los datos, como en la sección de arriba: nunca dropear
  producción.
- **`migrationsRun` asume una sola instancia.** Con varias arrancando a la vez
  pueden pisarse, porque el DDL de MySQL no es transaccional. Al escalar, sacar
  las migraciones a un paso propio del deploy:
  `npm run migration:run && npm run start:prod`.

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
