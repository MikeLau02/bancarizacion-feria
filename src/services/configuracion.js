'use strict';
const { query } = require('../db');

const CLAVES = {
  nombre_feria: { tipo: 'texto' },
  saldo_bajo: { tipo: 'entero', min: 0 },
  limite_diario_activo: { tipo: 'bool' },
  fecha_dia1: { tipo: 'fecha' },
  fecha_dia2: { tipo: 'fecha' },
  porcentaje_dia1: { tipo: 'entero', min: 1, max: 100 },
  solo_dias_feria: { tipo: 'bool' },
};

async function obtenerConfig(conn) {
  const ejecutar = conn ? (s, p) => conn.query(s, p).then((r) => r[0]) : query;
  const filas = await ejecutar('SELECT clave, valor FROM configuracion');
  const cfg = {};
  for (const f of filas) cfg[f.clave] = f.valor;
  return {
    nombre_feria: cfg.nombre_feria || 'Feria de Emprendimiento Escolar',
    saldo_bajo: parseInt(cfg.saldo_bajo || '5000', 10),
    limite_diario_activo: cfg.limite_diario_activo === '1',
    fecha_dia1: cfg.fecha_dia1 || '',
    fecha_dia2: cfg.fecha_dia2 || '',
    porcentaje_dia1: parseInt(cfg.porcentaje_dia1 || '50', 10),
    solo_dias_feria: cfg.solo_dias_feria === '1',
  };
}

/** Valida y convierte los valores recibidos del formulario de configuración. */
function normalizar(datos) {
  const salida = {};
  for (const [clave, def] of Object.entries(CLAVES)) {
    if (!(clave in datos)) continue;
    let v = datos[clave];
    if (def.tipo === 'bool') v = v === true || v === '1' || v === 1 || v === 'true' ? '1' : '0';
    else if (def.tipo === 'entero') {
      const n = parseInt(String(v).replace(/[.$\s]/g, ''), 10);
      if (!Number.isFinite(n) || n < (def.min ?? -Infinity) || n > (def.max ?? Infinity)) {
        throw new Error(`Valor no válido para ${clave}`);
      }
      v = String(n);
    } else if (def.tipo === 'fecha') {
      v = String(v || '').trim();
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`Fecha no válida para ${clave}`);
    } else v = String(v || '').trim().slice(0, 255);
    salida[clave] = v;
  }
  return salida;
}

module.exports = { obtenerConfig, normalizar, CLAVES };
