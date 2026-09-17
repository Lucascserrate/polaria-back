/**
 * Las variables que el código lee al cargarse, para que los tests puedan correr.
 *
 * Hace falta porque varios módulos de autenticación capturan el secreto en una
 * constante de módulo (`const jwtSecret = process.env.SECRET_JWT ?? ''`), y eso
 * pasa al importarlos: asignarlo dentro de un test llega tarde. `setupFiles`
 * corre antes de cargar el archivo de prueba, que es el único momento útil.
 *
 * Con `??=` no pisa nada: si alguien corre los tests con su `.env` cargado,
 * manda el suyo. El valor de acá solo existe para poder firmar y verificar en
 * memoria, y no abre ninguna puerta: no es el secreto de ningún entorno real.
 */
process.env.SECRET_JWT ??= 'jwt-secret-solo-para-tests';
