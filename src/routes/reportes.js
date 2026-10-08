'use strict';
/**
 * Reportes del administrador. Cada reporte se puede ver (formato=json)
 * o exportar a Excel (formato=xlsx) o CSV (formato=csv).
 */
const express = require('express');
const ExcelJS = require('exceljs');
const { query } = require('../db');
const { asyncH, ErrorApp, hoy } = require('../utils');
const { obtenerConfig } = require('../services/configuracion');

const router = express.Router();
const fechaValida = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);

function rangoFechas(qs, campo) {
  const cond = [];
  const p = [];
  if (fechaValida(qs.desde)) { cond.push(`${campo} >= ?`); p.push(qs.desde + ' 00:00:00'); }
  if (fechaValida(qs.hasta)) { cond.push(`${campo} < ? + INTERVAL 1 DAY`); p.push(qs.hasta + ' 00:00:00'); }
  return { sql: cond.length ? ' AND ' + cond.join(' AND ') : '', params: p };
}

const D = 'dinero';
const REPORTES = {
  estudiantes: {
    titulo: 'Listado de personas y saldo',
    columnas: [
      ['curso', 'Curso'], ['nombre_completo', 'Nombre completo'], ['tipo', 'Rol'], ['identificacion', 'Identificación'],
      ['estado', 'Estado'], ['total_cargado', 'Total cargado', D], ['total_gastado', 'Total gastado', D], ['saldo_dia1', 'Saldo día 1', D],
      ['saldo_dia2', 'Saldo día 2', D], ['saldo', 'Saldo total', D],
      ['compras', 'N.º compras'],
    ],
    async datos(qs) {
      const p = [];
      let w = '';
      if (qs.curso_id) { w = 'WHERE e.curso_id = ?'; p.push(parseInt(qs.curso_id, 10)); }
      return query(
        `SELECT COALESCE(c.nombre,'') AS curso, e.nombre_completo, e.tipo, e.identificacion, e.estado, e.saldo, e.saldo_dia1, e.saldo_dia2,
           (SELECT COALESCE(SUM(valor),0) FROM recargas r WHERE r.estudiante_id = e.id) AS total_cargado,
           (SELECT COALESCE(SUM(valor),0) FROM transacciones t WHERE t.estudiante_id = e.id AND t.estado='CONFIRMADA') AS total_gastado,
           (SELECT COUNT(*) FROM transacciones t WHERE t.estudiante_id = e.id AND t.estado='CONFIRMADA') AS compras
         FROM estudiantes e LEFT JOIN cursos c ON c.id = e.curso_id ${w} ORDER BY c.nombre, e.nombre_completo`, p);
    },
  },
  transacciones: {
    titulo: 'Historial de transacciones',
    columnas: [
      ['id', 'N.º'], ['fecha', 'Fecha'], ['hora', 'Hora'], ['estudiante', 'Comprador'], ['identificacion', 'Identificación'],
      ['rol', 'Rol'], ['curso', 'Curso'], ['emprendimiento', 'Emprendimiento'], ['vendedor', 'Vendedor'], ['valor', 'Valor', D],
      ['saldo_anterior', 'Saldo anterior', D], ['saldo_posterior', 'Saldo posterior', D], ['estado', 'Estado'],
      ['anulada_por', 'Anulada por'], ['anulada_en', 'Fecha anulación'], ['motivo_anulacion', 'Motivo anulación'],
    ],
    async datos(qs) {
      const r = rangoFechas(qs, 't.fecha_hora');
      const p = [...r.params];
      let extra = '';
      if (qs.emprendimiento_id) { extra += ' AND t.emprendimiento_id = ?'; p.push(parseInt(qs.emprendimiento_id, 10)); }
      if (qs.estudiante_id) { extra += ' AND t.estudiante_id = ?'; p.push(parseInt(qs.estudiante_id, 10)); }
      if (qs.curso_id) { extra += ' AND e.curso_id = ?'; p.push(parseInt(qs.curso_id, 10)); }
      if (/^[A-Z]+$/.test(qs.tipo || '')) { extra += ' AND e.tipo = ?'; p.push(qs.tipo); }
      return query(
        `SELECT t.id, DATE_FORMAT(t.fecha_hora,'%d/%m/%Y') AS fecha, DATE_FORMAT(t.fecha_hora,'%H:%i') AS hora,
           e.nombre_completo AS estudiante, e.identificacion, e.tipo AS rol, COALESCE(c.nombre,'') AS curso, em.nombre AS emprendimiento,
           u.nombre AS vendedor, t.valor, t.saldo_anterior, t.saldo_posterior, t.estado,
           COALESCE(ua.nombre,'') AS anulada_por, COALESCE(DATE_FORMAT(t.anulada_en,'%d/%m/%Y %H:%i'),'') AS anulada_en,
           COALESCE(t.motivo_anulacion,'') AS motivo_anulacion
         FROM transacciones t JOIN estudiantes e ON e.id = t.estudiante_id LEFT JOIN cursos c ON c.id = e.curso_id
         JOIN emprendimientos em ON em.id = t.emprendimiento_id JOIN usuarios u ON u.id = t.vendedor_id
         LEFT JOIN usuarios ua ON ua.id = t.anulada_por
         WHERE 1=1 ${r.sql}${extra} ORDER BY t.fecha_hora, t.id`, p);
    },
  },
  emprendimientos: {
    titulo: 'Ventas por emprendimiento',
    columnas: [
      ['nombre', 'Emprendimiento'], ['curso', 'Curso'], ['categoria', 'Categoría'], ['responsables', 'Responsables'],
      ['cantidad', 'N.º ventas'], ['total', 'Total vendido', D], ['promedio', 'Venta promedio', D], ['anuladas', 'Anuladas'],
    ],
    async datos(qs) {
      const r = rangoFechas(qs, 't.fecha_hora');
      return query(
        `SELECT em.nombre, COALESCE(c.nombre,'') AS curso, COALESCE(em.categoria,'') AS categoria, em.responsables,
           COUNT(CASE WHEN t.estado='CONFIRMADA' THEN 1 END) AS cantidad,
           COALESCE(SUM(CASE WHEN t.estado='CONFIRMADA' THEN t.valor END),0) AS total,
           COALESCE(ROUND(AVG(CASE WHEN t.estado='CONFIRMADA' THEN t.valor END)),0) AS promedio,
           COUNT(CASE WHEN t.estado='ANULADA' THEN 1 END) AS anuladas
         FROM emprendimientos em LEFT JOIN cursos c ON c.id = em.curso_id
         LEFT JOIN transacciones t ON t.emprendimiento_id = em.id ${r.sql}
         GROUP BY em.id, em.nombre, c.nombre, em.categoria, em.responsables ORDER BY total DESC, em.nombre`, r.params);
    },
  },
  'ventas-estudiante': {
    titulo: 'Compras por persona',
    columnas: [
      ['curso', 'Curso'], ['nombre_completo', 'Comprador'], ['tipo', 'Rol'], ['identificacion', 'Identificación'], ['cantidad', 'N.º compras'],
      ['total', 'Total comprado', D], ['saldo', 'Saldo actual', D],
    ],
    async datos(qs) {
      const r = rangoFechas(qs, 't.fecha_hora');
      return query(
        `SELECT COALESCE(c.nombre,'') AS curso, e.nombre_completo, e.tipo, e.identificacion, COUNT(t.id) AS cantidad,
           COALESCE(SUM(t.valor),0) AS total, e.saldo
         FROM estudiantes e LEFT JOIN cursos c ON c.id = e.curso_id
         LEFT JOIN transacciones t ON t.estudiante_id = e.id AND t.estado = 'CONFIRMADA' ${r.sql}
         GROUP BY e.id, c.nombre, e.nombre_completo, e.tipo, e.identificacion, e.saldo ORDER BY total DESC, e.nombre_completo`, r.params);
    },
  },
  'ventas-curso': {
    titulo: 'Ventas por curso',
    columnas: [
      ['curso', 'Curso'], ['personas', 'Personas'], ['compras', 'Compras hechas por el curso'], ['total_comprado', 'Total comprado por el curso', D],
      ['emprendimientos', 'Emprendimientos del curso'], ['total_vendido', 'Total vendido por emprendimientos del curso', D],
      ['saldo_pendiente', 'Saldo pendiente del curso', D],
    ],
    async datos(qs) {
      const r = rangoFechas(qs, 't.fecha_hora');
      return query(
        `SELECT c.nombre AS curso,
           (SELECT COUNT(*) FROM estudiantes e WHERE e.curso_id = c.id) AS personas,
           (SELECT COUNT(*) FROM transacciones t JOIN estudiantes e ON e.id = t.estudiante_id
              WHERE e.curso_id = c.id AND t.estado='CONFIRMADA' ${r.sql}) AS compras,
           (SELECT COALESCE(SUM(t.valor),0) FROM transacciones t JOIN estudiantes e ON e.id = t.estudiante_id
              WHERE e.curso_id = c.id AND t.estado='CONFIRMADA' ${r.sql}) AS total_comprado,
           (SELECT COUNT(*) FROM emprendimientos m WHERE m.curso_id = c.id) AS emprendimientos,
           (SELECT COALESCE(SUM(t.valor),0) FROM transacciones t JOIN emprendimientos m ON m.id = t.emprendimiento_id
              WHERE m.curso_id = c.id AND t.estado='CONFIRMADA' ${r.sql}) AS total_vendido,
           (SELECT COALESCE(SUM(saldo),0) FROM estudiantes e WHERE e.curso_id = c.id) AS saldo_pendiente
         FROM cursos c ORDER BY c.nombre`, [...r.params, ...r.params, ...r.params]);
    },
  },
  'ventas-rol': {
    titulo: 'Ventas por rol',
    columnas: [
      ['rol', 'Rol'], ['personas', 'Personas'], ['compras', 'Compras'], ['total', 'Total comprado', D], ['saldo_pendiente', 'Saldo pendiente', D],
    ],
    async datos(qs) {
      const r = rangoFechas(qs, 't.fecha_hora');
      return query(
        `SELECT e.tipo AS rol, COUNT(DISTINCT e.id) AS personas, COUNT(t.id) AS compras, COALESCE(SUM(t.valor),0) AS total,
           (SELECT COALESCE(SUM(x.saldo),0) FROM estudiantes x WHERE x.tipo = e.tipo) AS saldo_pendiente
         FROM estudiantes e LEFT JOIN transacciones t ON t.estudiante_id = e.id AND t.estado = 'CONFIRMADA' ${r.sql}
         GROUP BY e.tipo ORDER BY total DESC`, r.params);
    },
  },
  recargas: {
    titulo: 'Cargas y recargas de saldo',
    columnas: [
      ['fecha', 'Fecha'], ['hora', 'Hora'], ['persona', 'Persona'], ['curso', 'Curso'], ['tipo', 'Tipo'], ['dia', 'Asignado a'],
      ['valor', 'Valor', D], ['valor_dia1', 'Para día 1', D], ['valor_dia2', 'Para día 2', D],
      ['saldo_anterior', 'Saldo anterior', D], ['saldo_nuevo', 'Nuevo saldo', D], ['administrador', 'Administrador'], ['observacion', 'Observación'],
    ],
    async datos(qs) {
      const r = rangoFechas(qs, 'rc.fecha_hora');
      return query(
        `SELECT DATE_FORMAT(rc.fecha_hora,'%d/%m/%Y') AS fecha, DATE_FORMAT(rc.fecha_hora,'%H:%i') AS hora, e.nombre_completo AS persona,
           COALESCE(c.nombre,'') AS curso, rc.tipo,
           CASE rc.dia WHEN 'DIA1' THEN 'Día 1' WHEN 'DIA2' THEN 'Día 2' ELSE 'Dividido entre los dos días' END AS dia,
           rc.valor, rc.valor_dia1, rc.valor_dia2, rc.saldo_anterior, rc.saldo_nuevo, u.nombre AS administrador,
           COALESCE(rc.observacion,'') AS observacion
         FROM recargas rc JOIN estudiantes e ON e.id = rc.estudiante_id LEFT JOIN cursos c ON c.id = e.curso_id
         JOIN usuarios u ON u.id = rc.admin_id WHERE 1=1 ${r.sql} ORDER BY rc.fecha_hora, rc.id`, r.params);
    },
  },
  resumen: {
    titulo: 'Resumen general de la feria',
    columnas: [['indicador', 'Indicador'], ['valor', 'Valor']],
    async datos() {
      const cfg = await obtenerConfig();
      const [[p], [c], [v], [a], [e], dias] = await Promise.all([
        query(`SELECT COUNT(*) n, COALESCE(SUM(saldo),0) s, COALESCE(SUM(saldo_dia1),0) s1, COALESCE(SUM(saldo_dia2),0) s2, COALESCE(SUM(saldo=0),0) ag, COALESCE(SUM(saldo>0 AND saldo<?),0) b,
                 COALESCE(SUM(estado='BLOQUEADA'),0) bl FROM estudiantes`, [cfg.saldo_bajo]),
        query('SELECT COALESCE(SUM(valor),0) t FROM recargas'),
        query(`SELECT COUNT(*) n, COALESCE(SUM(valor),0) t, COUNT(DISTINCT estudiante_id) comp FROM transacciones WHERE estado='CONFIRMADA'`),
        query(`SELECT COUNT(*) n, COALESCE(SUM(valor),0) t FROM transacciones WHERE estado='ANULADA'`),
        query('SELECT COUNT(*) n FROM emprendimientos'),
        query(`SELECT DATE_FORMAT(fecha_hora,'%d/%m/%Y') d, COUNT(*) n, SUM(valor) t FROM transacciones WHERE estado='CONFIRMADA'
               GROUP BY DATE(fecha_hora), d ORDER BY DATE(fecha_hora)`),
      ]);
      const $ = (n) => '$' + Number(n).toLocaleString('es-CO');
      const filas = [
        { indicador: 'Feria', valor: cfg.nombre_feria },
        { indicador: 'Fecha del reporte', valor: hoy() },
        { indicador: 'Personas registradas', valor: p.n },
        { indicador: 'Emprendimientos', valor: e.n },
        { indicador: 'Total de saldo cargado', valor: $(c.t) },
        { indicador: 'Total vendido', valor: $(v.t) },
        { indicador: 'Saldo pendiente por gastar', valor: $(p.s) },
        { indicador: '   · Saldo del día 1 sin gastar', valor: $(p.s1) },
        { indicador: '   · Saldo reservado para el día 2', valor: $(p.s2) },
        { indicador: 'Número de transacciones', valor: v.n },
        { indicador: 'Personas que compraron', valor: v.comp },
        { indicador: 'Venta promedio', valor: $(v.n ? Math.round(v.t / v.n) : 0) },
        { indicador: 'Personas con saldo agotado', valor: p.ag },
        { indicador: `Personas con saldo bajo (menos de ${$(cfg.saldo_bajo)})`, valor: p.b },
        { indicador: 'Cuentas bloqueadas', valor: p.bl },
        { indicador: 'Transacciones anuladas', valor: `${a.n} (${$(a.t)})` },
      ];
      for (const d of dias) filas.push({ indicador: `Ventas del ${d.d}`, valor: `${d.n} compras · ${$(d.t)}` });
      return filas;
    },
  },
};

/** CSV con separador ";" y BOM UTF-8 para que Excel en español lo abra con tildes correctas. */
function aCSV(def, filas) {
  const celda = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = [def.columnas.map((c) => celda(c[1])).join(';')];
  for (const f of filas) lineas.push(def.columnas.map((c) => celda(f[c[0]])).join(';'));
  return '﻿' + lineas.join('\r\n');
}

async function aExcel(def, filas, nombreFeria) {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Feria QR';
  const hoja = libro.addWorksheet(def.titulo.slice(0, 31));
  hoja.addRow([`${nombreFeria} · ${def.titulo}`]).font = { bold: true, size: 14 };
  hoja.addRow([`Generado: ${new Date().toLocaleString('es-CO')}`]).font = { italic: true, color: { argb: 'FF666666' } };
  hoja.addRow([]);
  const enc = hoja.addRow(def.columnas.map((c) => c[1]));
  enc.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  enc.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F6FEB' } }; });
  for (const f of filas) hoja.addRow(def.columnas.map((c) => f[c[0]]));
  def.columnas.forEach((c, i) => {
    const col = hoja.getColumn(i + 1);
    if (c[2] === D) col.numFmt = '"$"#,##0';
    let ancho = c[1].length;
    for (const f of filas.slice(0, 300)) ancho = Math.max(ancho, String(f[c[0]] ?? '').length);
    col.width = Math.min(50, ancho + 3);
  });
  hoja.views = [{ state: 'frozen', ySplit: 4 }];
  hoja.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: def.columnas.length } };
  return libro.xlsx.writeBuffer();
}

router.get('/:tipo', asyncH(async (req, res) => {
  const def = REPORTES[req.params.tipo];
  if (!def) throw new ErrorApp(404, 'Reporte no encontrado.');
  const filas = await def.datos(req.query);
  const formato = req.query.formato || 'json';
  const archivo = `${req.params.tipo}-${hoy()}`;
  if (formato === 'csv') {
    res.attachment(`${archivo}.csv`);
    res.type('text/csv; charset=utf-8');
    return res.send(aCSV(def, filas));
  }
  if (formato === 'xlsx') {
    const cfg = await obtenerConfig();
    res.attachment(`${archivo}.xlsx`);
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(Buffer.from(await aExcel(def, filas, cfg.nombre_feria)));
  }
  res.json({ titulo: def.titulo, columnas: def.columnas.map(([clave, titulo, tipo]) => ({ clave, titulo, tipo: tipo || 'texto' })), filas });
}));

module.exports = router;
