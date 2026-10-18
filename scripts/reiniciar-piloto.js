'use strict';
/**
 * Deja la base lista para la feria real después de la prueba piloto.
 *   npm run reiniciar-piloto -- --confirmar
 * Usa la base del archivo .env (DATABASE_URL o DB_*). Ver README, sección "Reiniciar después de la prueba piloto".
 */
const config = require('../src/config');
const mysql = require('mysql2/promise');
const { reiniciarSiSePide } = require('../src/services/reinicio');

(async () => {
  if (!process.argv.includes('--confirmar')) {
    console.log('Esto BORRA ventas, cargas de saldo, emprendimientos, vendedores e historial de la base');
    console.log(`"${config.db.database}" en ${config.db.host}. Conserva personas (con su QR), cursos y administradores.`);
    console.log('Todas las personas quedan con saldo $0 y bloqueadas hasta su primera recarga.\n');
    console.log('Para hacerlo ejecute:  npm run reiniciar-piloto -- --confirmar');
    process.exit(1);
  }
  const conn = await mysql.createConnection(config.db);
  try {
    await reiniciarSiSePide(conn, `manual-${new Date().toISOString()}`);
  } finally {
    await conn.end();
  }
})().catch((err) => {
  console.error('✖ No se pudo reiniciar:', err.message);
  process.exit(1);
});
