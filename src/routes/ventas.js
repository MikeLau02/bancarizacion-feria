'use strict';
/** API del vendedor: solo lo necesario para cobrar y ver sus propias ventas. */
const express = require('express');
const { query } = require('../db');
const { asyncH, aEntero, hoy } = require('../utils');
const saldos = require('../services/saldos');

const router = express.Router();

// 1. Escanear QR → ver nombre, curso y saldo (nada más)
router.post('/consultar', asyncH(async (req, res) => {
  res.json(await saldos.consultarParaVendedor(req.body.qr));
}));

// 2. Validar el valor antes de mostrar la confirmación
router.post('/validar', asyncH(async (req, res) => {
  res.json(await saldos.validarCompra(req.body.qr, aEntero(req.body.valor)));
}));

// 3. Confirmar compra
router.post('/compras', asyncH(async (req, res) => {
  const r = await saldos.registrarCompra({
    textoQR: req.body.qr,
    valor: aEntero(req.body.valor),
    codigoOperacion: String(req.body.codigo_operacion || ''),
    vendedor: req.usuario,
  });
  res.status(r.duplicada ? 200 : 201).json(r);
}));

// Ventas del propio emprendimiento
router.get('/mis-ventas', asyncH(async (req, res) => {
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(req.query.fecha || '') ? req.query.fecha : null;
  const params = [req.usuario.emprendimiento_id];
  let filtro = '';
  if (fecha) { filtro = ' AND t.fecha_hora >= ? AND t.fecha_hora < ? + INTERVAL 1 DAY'; params.push(fecha + ' 00:00:00', fecha + ' 00:00:00'); }
  const ventas = await query(
    `SELECT t.id, t.fecha_hora, t.valor, t.estado, e.nombre_completo AS comprador, e.tipo AS rol, c.nombre AS curso, u.nombre AS vendedor
     FROM transacciones t
     JOIN estudiantes e ON e.id = t.estudiante_id
     LEFT JOIN cursos c ON c.id = e.curso_id
     JOIN usuarios u ON u.id = t.vendedor_id
     WHERE t.emprendimiento_id = ?${filtro}
     ORDER BY t.fecha_hora DESC, t.id DESC LIMIT 500`, params);
  const [tot] = await query(
    `SELECT COUNT(*) AS cantidad, COALESCE(SUM(valor),0) AS total,
            COALESCE(SUM(CASE WHEN fecha_hora >= ? AND fecha_hora < ? + INTERVAL 1 DAY THEN valor END),0) AS total_hoy,
            COALESCE(SUM(fecha_hora >= ? AND fecha_hora < ? + INTERVAL 1 DAY),0) AS cantidad_hoy
     FROM transacciones WHERE emprendimiento_id = ? AND estado = 'CONFIRMADA'`,
    [hoy() + ' 00:00:00', hoy() + ' 00:00:00', hoy() + ' 00:00:00', hoy() + ' 00:00:00', req.usuario.emprendimiento_id]);
  res.json({ emprendimiento: req.usuario.emprendimiento, ventas, resumen: tot });
}));

module.exports = router;
