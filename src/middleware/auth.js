'use strict';
const { query } = require('../db');

/**
 * Carga el usuario de la sesión en cada petición, desde la base de datos,
 * para que un usuario desactivado pierda el acceso inmediatamente.
 */
async function cargarUsuario(req, res, next) {
  try {
    if (req.session && req.session.usuarioId) {
      const [u] = await query(
        `SELECT u.id, u.usuario, u.nombre, u.rol, u.emprendimiento_id, u.activo, e.nombre AS emprendimiento
         FROM usuarios u LEFT JOIN emprendimientos e ON e.id = u.emprendimiento_id WHERE u.id = ?`,
        [req.session.usuarioId]);
      if (u && u.activo) req.usuario = u;
      else req.session.usuarioId = null;
    }
    next();
  } catch (err) {
    next(err);
  }
}

function requiereSesion(req, res, next) {
  if (!req.usuario) return res.status(401).json({ error: 'Su sesión terminó. Inicie sesión de nuevo.' });
  next();
}

const requiereRol = (rol) => (req, res, next) => {
  if (!req.usuario) return res.status(401).json({ error: 'Su sesión terminó. Inicie sesión de nuevo.' });
  if (req.usuario.rol !== rol) return res.status(403).json({ error: 'No tiene permiso para esta función.' });
  next();
};

/** Protege páginas HTML: redirige al login si no hay sesión o el rol no corresponde. */
const paginaPara = (rol) => (req, res, next) => {
  if (!req.usuario) return res.redirect('/login.html');
  if (req.usuario.rol !== rol) return res.redirect(req.usuario.rol === 'ADMIN' ? '/admin/' : '/vendedor/');
  next();
};

module.exports = { cargarUsuario, requiereSesion, requiereRol, paginaPara };
