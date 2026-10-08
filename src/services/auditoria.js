'use strict';
const { query } = require('../db');
const { ahora } = require('../utils');

/** Registra una operación en la bitácora. Acepta una conexión de transacción opcional. */
async function auditar(conn, usuarioId, accion, entidad, entidadId, detalle) {
  const sql = 'INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, detalle, fecha_hora) VALUES (?,?,?,?,?,?)';
  const params = [usuarioId || null, accion, entidad, entidadId || null,
    detalle ? (typeof detalle === 'string' ? detalle : JSON.stringify(detalle)) : null, ahora()];
  if (conn) await conn.query(sql, params);
  else await query(sql, params);
}

module.exports = { auditar };
