'use strict';
const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 20,
  dateStrings: true,      // las fechas llegan como texto 'YYYY-MM-DD HH:MM:SS'
  charset: 'utf8mb4',
  decimalNumbers: true,
});

/** Ejecuta una consulta y devuelve las filas. */
async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

/**
 * Ejecuta "fn" dentro de una transacción de base de datos.
 * Si fn lanza un error se hace ROLLBACK; si no, COMMIT.
 */
async function transaccion(fn) {
  const conn = await pool.getConnection();
  try {
    // READ COMMITTED: cada lectura ve lo último confirmado por otros vendedores,
    // y el bloqueo FOR UPDATE de la fila del estudiante ordena las compras simultáneas.
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();
    const resultado = await fn(conn);
    await conn.commit();
    return resultado;
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignorar */ }
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, transaccion };
