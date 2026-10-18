'use strict';
/**
 * Reinicio después de la prueba piloto (uso interno, no hay botón en la app).
 * Borra ventas, cargas de saldo, emprendimientos (con sus usuarios vendedores) y el historial.
 * Conserva las personas con su QR, los cursos, los administradores y la configuración.
 * Todas las personas quedan con saldo $0 y BLOQUEADAS; cada una se activa sola con su primera recarga.
 */
const { ahora } = require('../utils');
const { auditar } = require('./auditoria');

async function reiniciarPiloto(conn) {
  const cuenta = async (sql) => (await conn.query(sql))[0][0].n;
  const borrado = {
    ventas: await cuenta('SELECT COUNT(*) AS n FROM transacciones'),
    cargas: await cuenta('SELECT COUNT(*) AS n FROM recargas'),
    emprendimientos: await cuenta('SELECT COUNT(*) AS n FROM emprendimientos'),
    vendedores: await cuenta("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'VENDEDOR'"),
    registros_historial: await cuenta('SELECT COUNT(*) AS n FROM auditoria'),
  };
  await conn.query('DELETE FROM transacciones');
  await conn.query('DELETE FROM recargas');
  await conn.query('DELETE FROM emprendimiento_responsables');
  await conn.query("DELETE FROM usuarios WHERE rol = 'VENDEDOR'");
  await conn.query('DELETE FROM emprendimientos');
  await conn.query('DELETE FROM auditoria');
  await conn.query(`UPDATE estudiantes SET saldo = 0, saldo_dia1 = 0, saldo_dia2 = 0, saldo_inicial = 0,
                      estado = 'BLOQUEADA', actualizado_en = ?`, [ahora()]);
  const personas = await cuenta('SELECT COUNT(*) AS n FROM estudiantes');
  await auditar(conn, null, 'REINICIO_PILOTO', 'sistema', null, { ...borrado, personas_conservadas: personas });
  return { borrado, personas };
}

/**
 * Ejecuta el reinicio una sola vez por cada valor de la variable REINICIAR_PILOTO
 * (p. ej. REINICIAR_PILOTO=2026-10-18). Si la app se reinicia con el mismo valor, no vuelve a borrar.
 */
async function reiniciarSiSePide(conn, valor, log = console.log) {
  valor = String(valor || '').trim();
  if (!valor) return null;
  const [[hecho]] = await conn.query("SELECT valor FROM configuracion WHERE clave = 'reinicio_piloto'");
  if (hecho && hecho.valor === valor) {
    log(`ℹ El reinicio "${valor}" ya se había hecho; no se borró nada. Quite la variable REINICIAR_PILOTO.`);
    return null;
  }
  await conn.query('START TRANSACTION');
  try {
    const r = await reiniciarPiloto(conn);
    await conn.query("INSERT INTO configuracion (clave, valor) VALUES ('reinicio_piloto', ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)", [valor]);
    await conn.query('COMMIT');
    log(`✔ Reinicio de la prueba piloto hecho: se borraron ${r.borrado.ventas} ventas, ${r.borrado.cargas} cargas, `
      + `${r.borrado.emprendimientos} emprendimientos y ${r.borrado.vendedores} vendedores. `
      + `${r.personas} personas conservadas con saldo $0 y bloqueadas hasta su primera recarga.`);
    return r;
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  }
}

module.exports = { reiniciarPiloto, reiniciarSiSePide };
