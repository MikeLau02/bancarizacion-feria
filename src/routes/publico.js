'use strict';
/**
 * Consulta para compradores (sin usuario ni contraseña): con su QR o el código
 * impreso debajo, cada persona ve su saldo por día y su historial.
 * El identificador del QR tiene 128 bits aleatorios, así que no se puede adivinar.
 */
const express = require('express');
const { asyncH, ErrorApp } = require('../utils');
const saldos = require('../services/saldos');

const router = express.Router();
const consultas = new Map();

// Límite de consultas por minuto por conexión. Es amplio porque en internet muchos celulares
// del colegio comparten la misma IP; los códigos QR no se pueden adivinar (128 bits).
router.use((req, res, next) => {
  const ahora = Date.now();
  const r = consultas.get(req.ip) || { n: 0, desde: ahora };
  if (ahora - r.desde > 60000) { r.n = 0; r.desde = ahora; }
  r.n += 1;
  consultas.set(req.ip, r);
  if (consultas.size > 5000) consultas.clear();
  if (r.n > 300) return next(new ErrorApp(429, 'Demasiadas consultas. Espere un minuto.'));
  next();
});

router.post('/consulta', asyncH(async (req, res) => {
  res.json(await saldos.consultaComprador(req.body.qr));
}));

module.exports = router;
