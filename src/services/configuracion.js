'use strict';
const { query } = require('../db');

const CLAVES = {
  nombre_feria: { tipo: 'texto' },
  saldo_bajo: { tipo: 'entero', min: 0 },
  // Fecha del (único) día de feria. Se guarda en la clave fecha_dia1 para conservar la configuración anterior.
  fecha_dia1: { tipo: 'fecha' },
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
    fecha_feria: cfg.fecha_dia1 || '',
    solo_dias_feria: cfg.solo_dias_feria === '1',
  };
}

/** Valida y convierte los valores recibidos del formulario de configuración. */
function normalizar(datos) {
  const salida = {};
  for (const [clave, def] of Object.entries(CLAVES)) {
    const nombre = clave === 'fecha_dia1' ? 'fecha_feria' : clave;
    if (!(nombre in datos)) continue;
    let v = datos[nombre];
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
