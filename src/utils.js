'use strict';
const crypto = require('crypto');

/** Error con código HTTP y mensaje pensado para mostrarse al usuario. */
class ErrorApp extends Error {
  constructor(status, mensaje, extra = {}) {
    super(mensaje);
    this.status = status;
    this.extra = extra;
  }
}

const dos = (n) => String(n).padStart(2, '0');

/** Fecha y hora local (según TZ) en formato MySQL. */
function ahora() {
  const d = new Date();
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
}

/** Fecha local de hoy 'YYYY-MM-DD'. */
function hoy() {
  return ahora().slice(0, 10);
}

/** Identificador aleatorio de 32 caracteres hexadecimales (128 bits) para el QR. */
function nuevoTokenQR() {
  return crypto.randomBytes(16).toString('hex');
}

/** Formato de dinero colombiano: $25.000 */
function pesos(n) {
  return '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');
}

/** Convierte un valor recibido en un entero de pesos (acepta "25.000", "$25000"...). */
function aEntero(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : NaN;
  if (typeof v !== 'string') return NaN;
  const limpio = v.replace(/[$\s.]/g, '').replace(/,\d{0,2}$/, '');
  return /^-?\d+$/.test(limpio) ? parseInt(limpio, 10) : NaN;
}

/** Envuelve un manejador async para que sus errores lleguen al middleware de errores. */
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Limpia un texto: recorta y limita longitud. */
function texto(v, max = 255) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max);
}

module.exports = { ErrorApp, ahora, hoy, nuevoTokenQR, pesos, aEntero, asyncH, texto };
