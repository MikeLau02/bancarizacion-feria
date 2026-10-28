'use strict';
/**
 * Ingresos por administrador: cuánto dinero cargó (recibió) cada administrador en saldos.
 * Sirve para el cuadre de caja: por administrador, por fecha, por tipo de carga y por curso.
 */
const { query } = require('../db');

const fechaValida = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);

/** Filtros: desde, hasta, admin_id, tipo (INICIAL|RECARGA|AJUSTE), curso_id, q (persona). */
function filtrosIngresos(f = {}) {
  const cond = ['1=1'];
  const p = [];
  if (fechaValida(f.desde)) { cond.push('r.fecha_hora >= ?'); p.push(f.desde + ' 00:00:00'); }
  if (fechaValida(f.hasta)) { cond.push('r.fecha_hora < ? + INTERVAL 1 DAY'); p.push(f.hasta + ' 00:00:00'); }
  if (parseInt(f.admin_id, 10)) { cond.push('r.admin_id = ?'); p.push(parseInt(f.admin_id, 10)); }
  if (['INICIAL', 'RECARGA', 'AJUSTE'].includes(f.tipo)) { cond.push('r.tipo = ?'); p.push(f.tipo); }
  if (parseInt(f.curso_id, 10)) { cond.push('e.curso_id = ?'); p.push(parseInt(f.curso_id, 10)); }
  if (f.q) { cond.push('(e.nombre_completo LIKE ? OR e.identificacion LIKE ?)'); p.push(`%${String(f.q).slice(0, 80)}%`, `%${String(f.q).slice(0, 80)}%`); }
  return { sql: cond.join(' AND '), p };
}

const DESDE = `FROM recargas r JOIN usuarios u ON u.id = r.admin_id
  JOIN estudiantes e ON e.id = r.estudiante_id LEFT JOIN cursos c ON c.id = e.curso_id`;

const SUMAS = `COUNT(*) AS cantidad, COALESCE(SUM(r.valor),0) AS total,
  COALESCE(SUM(CASE WHEN r.tipo = 'INICIAL' THEN r.valor END),0) AS iniciales,
  COALESCE(SUM(CASE WHEN r.tipo = 'RECARGA' THEN r.valor END),0) AS recargas,
  COALESCE(SUM(CASE WHEN r.tipo = 'AJUSTE' THEN r.valor END),0) AS ajustes,
  COUNT(DISTINCT r.estudiante_id) AS personas`;

async function ingresos(f = {}, limiteDetalle = 1000) {
  const w = filtrosIngresos(f);
  const [[resumen], porAdmin, porDia, porCurso, detalle] = await Promise.all([
    query(`SELECT ${SUMAS} ${DESDE} WHERE ${w.sql}`, w.p),
    query(`SELECT u.id, u.nombre, u.usuario, ${SUMAS},
             DATE_FORMAT(MIN(r.fecha_hora), '%Y-%m-%d %H:%i:%s') AS primera, DATE_FORMAT(MAX(r.fecha_hora), '%Y-%m-%d %H:%i:%s') AS ultima
           ${DESDE} WHERE ${w.sql} GROUP BY u.id, u.nombre, u.usuario ORDER BY total DESC`, w.p),
    query(`SELECT DATE_FORMAT(r.fecha_hora, '%Y-%m-%d') AS dia, u.id AS admin_id, u.nombre AS administrador, ${SUMAS}
           ${DESDE} WHERE ${w.sql} GROUP BY DATE_FORMAT(r.fecha_hora, '%Y-%m-%d'), u.id, u.nombre ORDER BY dia DESC, total DESC`, w.p),
    query(`SELECT COALESCE(c.nombre, '(sin curso)') AS curso, ${SUMAS}
           ${DESDE} WHERE ${w.sql} GROUP BY c.nombre ORDER BY total DESC`, w.p),
    query(`SELECT r.id, r.fecha_hora, r.tipo, r.valor, r.saldo_anterior, r.saldo_nuevo, r.observacion,
             u.id AS admin_id, u.nombre AS administrador, e.id AS persona_id, e.nombre_completo AS persona, e.identificacion,
             COALESCE(c.nombre, '') AS curso
           ${DESDE} WHERE ${w.sql} ORDER BY r.fecha_hora DESC, r.id DESC LIMIT ?`, [...w.p, limiteDetalle]),
  ]);
  return { resumen, por_admin: porAdmin, por_dia: porDia, por_curso: porCurso, detalle };
}

module.exports = { ingresos, filtrosIngresos, DESDE, SUMAS };
