'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { asyncH, ahora, texto, ErrorApp } = require('../utils');
const { obtenerConfig } = require('../services/configuracion');

const router = express.Router();

// Protección básica contra adivinar contraseñas: 10 intentos fallidos por usuario y conexión cada 10 minutos.
// Se cuenta por usuario y no solo por IP porque en internet todo el colegio suele salir por la misma IP.
const intentos = new Map();
function demasiadosIntentos(ip) {
  const r = intentos.get(ip);
  if (!r) return false;
  if (Date.now() - r.desde > 10 * 60 * 1000) { intentos.delete(ip); return false; }
  return r.n >= 10;
}
function sumarIntento(ip) {
  const r = intentos.get(ip) || { n: 0, desde: Date.now() };
  r.n += 1;
  intentos.set(ip, r);
  if (intentos.size > 10000) intentos.clear();
}

router.post('/login', asyncH(async (req, res) => {
  const usuario = texto(req.body.usuario, 60).toLowerCase();
  const ip = `${req.ip}|${usuario}`;
  if (demasiadosIntentos(ip)) throw new ErrorApp(429, 'Demasiados intentos fallidos. Espere unos minutos.');
  const password = String(req.body.password || '');
  const [u] = await query('SELECT * FROM usuarios WHERE usuario = ?', [usuario]);
  if (!u || !(await bcrypt.compare(password, u.password_hash))) {
    sumarIntento(ip);
    throw new ErrorApp(401, 'Usuario o contraseña incorrectos.');
  }
  if (!u.activo) throw new ErrorApp(403, 'Este usuario está desactivado. Consulte con el administrador.');
  intentos.delete(ip);
  await new Promise((ok, mal) => req.session.regenerate((e) => (e ? mal(e) : ok())));
  req.session.usuarioId = u.id;
  await query('UPDATE usuarios SET ultimo_acceso = ? WHERE id = ?', [ahora(), u.id]);
  res.json({ ok: true, rol: u.rol, destino: u.rol === 'ADMIN' ? '/admin/' : '/vendedor/' });
}));

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('feria.sid');
    res.json({ ok: true });
  });
});

router.get('/yo', asyncH(async (req, res) => {
  if (!req.usuario) return res.status(401).json({ error: 'Sin sesión' });
  const cfg = await obtenerConfig();
  const { id, usuario, nombre, rol, emprendimiento_id, emprendimiento } = req.usuario;
  res.json({ id, usuario, nombre, rol, emprendimiento_id, emprendimiento, feria: cfg.nombre_feria, saldo_bajo: cfg.saldo_bajo });
}));

router.post('/cambiar-password', asyncH(async (req, res) => {
  if (!req.usuario) throw new ErrorApp(401, 'Sin sesión');
  const { actual, nueva } = req.body;
  if (!nueva || String(nueva).length < 6) throw new ErrorApp(400, 'La nueva contraseña debe tener al menos 6 caracteres.');
  const [u] = await query('SELECT password_hash FROM usuarios WHERE id = ?', [req.usuario.id]);
  if (!(await bcrypt.compare(String(actual || ''), u.password_hash))) throw new ErrorApp(400, 'La contraseña actual no es correcta.');
  await query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [await bcrypt.hash(String(nueva), 10), req.usuario.id]);
  res.json({ ok: true });
}));

module.exports = router;
