'use strict';
/**
 * Historial unificado de actividad (quién hizo qué y cuándo) y métricas para el panel.
 * Junta ventas, anulaciones, cargas de saldo, operaciones administrativas e inicios de sesión.
 */
const { query } = require('../db');

const ACCIONES = {
  ANULAR_COMPRA: 'Anuló una compra', CREAR_PERSONA: 'Registró una persona', EDITAR_PERSONA: 'Editó una persona',
  BLOQUEAR_CUENTA: 'Bloqueó una cuenta', ACTIVAR_CUENTA: 'Activó una cuenta', REGENERAR_QR: 'Generó un QR nuevo',
  IMPORTAR_PERSONAS: 'Importó personas', BLOQUEO_MASIVO: 'Bloqueó cuentas en grupo', ACTIVACION_MASIVA: 'Activó cuentas en grupo',
  CARGAR_CURSOS: 'Cargó los cursos del colegio', CREAR_EMPRENDIMIENTO: 'Registró un emprendimiento',
  EDITAR_EMPRENDIMIENTO: 'Editó un emprendimiento', CAMBIAR_CONFIGURACION: 'Cambió la configuración',
  CREAR_ADMIN: 'Creó un administrador', EDITAR_ADMIN: 'Editó un administrador',
  INICIO_SESION: 'Inició sesión', INICIO_FALLIDO: 'Intento de ingreso fallido', CIERRE_SESION: 'Cerró sesión',
  CAMBIAR_PASSWORD: 'Cambió su contraseña',
};
const SESIONES = ['INICIO_SESION', 'INICIO_FALLIDO', 'CIERRE_SESION'];
const TIPOS = { VENTA: 'Venta', ANULACION: 'Anulación', CARGA: 'Carga de saldo', ADMIN: 'Administración', SESION: 'Ingreso' };
const CARGAS = { INICIAL: 'Saldo inicial', RECARGA: 'Recarga', AJUSTE: 'Ajuste' };
const DIAS = { DIA1: 'día 1', DIA2: 'día 2', AMBOS: 'ambos días' };

const fechaValida = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);

/** Condición de rango de fechas sobre una columna. */
function rango(f, campo) {
  const cond = [];
  const p = [];
  if (fechaValida(f.desde)) { cond.push(`${campo} >= ?`); p.push(f.desde + ' 00:00:00'); }
  if (fechaValida(f.hasta)) { cond.push(`${campo} < ? + INTERVAL 1 DAY`); p.push(f.hasta + ' 00:00:00'); }
  return { sql: cond.length ? cond.join(' AND ') : '1=1', p };
}

/** Historial: filtros desde, hasta, usuario_id, tipo (VENTA, ANULACION, CARGA, ADMIN, SESION), q (texto). */
async function historial(f = {}, limite = 500) {
  const sesiones = SESIONES.map((s) => `'${s}'`).join(',');
  const filas = await query(
    `SELECT * FROM (
       SELECT t.fecha_hora, 'VENTA' AS tipo, NULL AS accion, u.id AS usuario_id, u.nombre AS usuario, u.rol,
              em.nombre AS emprendimiento, e.nombre_completo AS persona, t.valor, NULL AS detalle, t.estado
         FROM transacciones t JOIN usuarios u ON u.id = t.vendedor_id
         JOIN emprendimientos em ON em.id = t.emprendimiento_id JOIN estudiantes e ON e.id = t.estudiante_id
       UNION ALL
       SELECT t.anulada_en, 'ANULACION', NULL, u.id, u.nombre, u.rol, em.nombre, e.nombre_completo, t.valor, t.motivo_anulacion, NULL
         FROM transacciones t JOIN usuarios u ON u.id = t.anulada_por
         JOIN emprendimientos em ON em.id = t.emprendimiento_id JOIN estudiantes e ON e.id = t.estudiante_id
        WHERE t.estado = 'ANULADA'
       UNION ALL
       SELECT r.fecha_hora, 'CARGA', r.tipo, u.id, u.nombre, u.rol, NULL, e.nombre_completo, r.valor,
              CONCAT(r.dia, IF(r.observacion IS NULL OR r.observacion = '', '', CONCAT(' · ', r.observacion))), NULL
         FROM recargas r JOIN usuarios u ON u.id = r.admin_id JOIN estudiantes e ON e.id = r.estudiante_id
       UNION ALL
       SELECT a.fecha_hora, IF(a.accion IN (${sesiones}), 'SESION', 'ADMIN'), a.accion, u.id, COALESCE(u.nombre, '(usuario no registrado)'),
              u.rol, NULL, NULL, NULL, a.detalle, NULL
         FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
        WHERE a.accion <> 'ANULAR_COMPRA'
     ) h
     WHERE ${rango(f, 'h.fecha_hora').sql}
       ${f.usuario_id ? 'AND h.usuario_id = ?' : ''}
       ${TIPOS[f.tipo] ? 'AND h.tipo = ?' : ''}
       ${f.q ? 'AND (h.persona LIKE ? OR h.emprendimiento LIKE ? OR h.detalle LIKE ? OR h.usuario LIKE ?)' : ''}
     ORDER BY h.fecha_hora DESC LIMIT ?`,
    [...rango(f, 'h.fecha_hora').p,
      ...(f.usuario_id ? [parseInt(f.usuario_id, 10)] : []),
      ...(TIPOS[f.tipo] ? [f.tipo] : []),
      ...(f.q ? Array(4).fill(`%${String(f.q).slice(0, 80)}%`) : []),
      limite]);
  return filas.map((h) => ({ ...h, tipo_texto: TIPOS[h.tipo], descripcion: describir(h) }));
}

function describir(h) {
  if (h.tipo === 'VENTA') return `Vendió en ${h.emprendimiento} a ${h.persona}${h.estado === 'ANULADA' ? ' (luego anulada)' : ''}`;
  if (h.tipo === 'ANULACION') return `Anuló la venta de ${h.emprendimiento} a ${h.persona}${h.detalle ? ': ' + h.detalle : ''}`;
  if (h.tipo === 'CARGA') {
    const [dia, ...obs] = String(h.detalle || '').split(' · ');
    return `${CARGAS[h.accion] || h.accion} a ${h.persona} (${DIAS[dia] || dia})${obs.length ? ' · ' + obs.join(' · ') : ''}`;
  }
  let det = h.detalle || '';
  try {
    const o = JSON.parse(det);
    if (o && typeof o === 'object') det = Object.entries(o).filter(([, v]) => v !== null && v !== '' && typeof v !== 'object').map(([k, v]) => `${k}: ${v}`).join(', ');
  } catch (_) { /* texto plano */ }
  return `${ACCIONES[h.accion] || h.accion}${det ? ' · ' + det : ''}`;
}

/** Métricas del rango elegido para la sección Métricas del panel. */
async function metricas(f = {}) {
  const rt = rango(f, 't.fecha_hora');
  const rr = rango(f, 'r.fecha_hora');
  const ra = rango(f, 'a.fecha_hora');
  const ran = rango(f, 't.anulada_en');
  const re = rango(f, 'e.creado_en');
  const [[ventas], [anuladas], [cargas], [registros], porHora, porDia, topEmp, topComp, porUsuario] = await Promise.all([
    query(`SELECT COUNT(*) AS cantidad, COALESCE(SUM(valor),0) AS total, COALESCE(ROUND(AVG(valor)),0) AS promedio,
             COUNT(DISTINCT estudiante_id) AS compradores, COUNT(DISTINCT emprendimiento_id) AS emprendimientos
           FROM transacciones t WHERE t.estado = 'CONFIRMADA' AND ${rt.sql}`, rt.p),
    query(`SELECT COUNT(*) AS cantidad, COALESCE(SUM(valor),0) AS total FROM transacciones t WHERE t.estado = 'ANULADA' AND ${ran.sql}`, ran.p),
    query(`SELECT COUNT(*) AS cantidad, COALESCE(SUM(valor),0) AS total FROM recargas r WHERE ${rr.sql}`, rr.p),
    query(`SELECT COUNT(*) AS cantidad FROM estudiantes e WHERE ${re.sql}`, re.p),
    query(`SELECT HOUR(t.fecha_hora) AS hora, COUNT(*) AS cantidad, SUM(t.valor) AS total
           FROM transacciones t WHERE t.estado = 'CONFIRMADA' AND ${rt.sql} GROUP BY HOUR(t.fecha_hora) ORDER BY hora`, rt.p),
    query(`SELECT DATE_FORMAT(t.fecha_hora, '%Y-%m-%d') AS dia, COUNT(*) AS cantidad, SUM(t.valor) AS total
           FROM transacciones t WHERE t.estado = 'CONFIRMADA' AND ${rt.sql} GROUP BY DATE_FORMAT(t.fecha_hora, '%Y-%m-%d') ORDER BY dia`, rt.p),
    query(`SELECT em.id, em.nombre, COUNT(*) AS cantidad, SUM(t.valor) AS total, COUNT(DISTINCT t.estudiante_id) AS compradores
           FROM transacciones t JOIN emprendimientos em ON em.id = t.emprendimiento_id
           WHERE t.estado = 'CONFIRMADA' AND ${rt.sql} GROUP BY em.id, em.nombre ORDER BY total DESC LIMIT 10`, rt.p),
    query(`SELECT e.id, e.nombre_completo AS nombre, COALESCE(c.nombre, e.tipo) AS curso, COUNT(*) AS cantidad, SUM(t.valor) AS total
           FROM transacciones t JOIN estudiantes e ON e.id = t.estudiante_id LEFT JOIN cursos c ON c.id = e.curso_id
           WHERE t.estado = 'CONFIRMADA' AND ${rt.sql} GROUP BY e.id, e.nombre_completo, c.nombre, e.tipo ORDER BY total DESC LIMIT 10`, rt.p),
    query(`SELECT u.id, u.nombre, u.usuario, u.rol, u.activo, u.ultimo_acceso, em.nombre AS emprendimiento,
             (SELECT COUNT(*) FROM transacciones t WHERE t.vendedor_id = u.id AND t.estado = 'CONFIRMADA' AND ${rt.sql}) AS ventas,
             (SELECT COALESCE(SUM(valor),0) FROM transacciones t WHERE t.vendedor_id = u.id AND t.estado = 'CONFIRMADA' AND ${rt.sql}) AS total_ventas,
             (SELECT COUNT(*) FROM recargas r WHERE r.admin_id = u.id AND ${rr.sql}) AS cargas,
             (SELECT COALESCE(SUM(valor),0) FROM recargas r WHERE r.admin_id = u.id AND ${rr.sql}) AS total_cargas,
             (SELECT COUNT(*) FROM transacciones t WHERE t.anulada_por = u.id AND ${ran.sql}) AS anulaciones,
             (SELECT COUNT(*) FROM auditoria a WHERE a.usuario_id = u.id AND a.accion NOT IN ('ANULAR_COMPRA','INICIO_SESION','INICIO_FALLIDO','CIERRE_SESION') AND ${ra.sql}) AS operaciones,
             (SELECT COUNT(*) FROM auditoria a WHERE a.usuario_id = u.id AND a.accion = 'INICIO_SESION' AND ${ra.sql}) AS ingresos,
             (SELECT COUNT(*) FROM auditoria a WHERE a.usuario_id = u.id AND a.accion = 'INICIO_FALLIDO' AND ${ra.sql}) AS fallidos
           FROM usuarios u LEFT JOIN emprendimientos em ON em.id = u.emprendimiento_id
           ORDER BY u.rol, u.nombre`,
    [...rt.p, ...rt.p, ...rr.p, ...rr.p, ...ran.p, ...ra.p, ...ra.p, ...ra.p]),
  ]);
  return {
    resumen: {
      ventas: ventas.cantidad, total_ventas: ventas.total, ticket_promedio: ventas.promedio, compradores: ventas.compradores,
      emprendimientos_con_ventas: ventas.emprendimientos, anuladas: anuladas.cantidad, total_anulado: anuladas.total,
      cargas: cargas.cantidad, total_cargado: cargas.total, personas_registradas: registros.cantidad,
    },
    por_hora: porHora, por_dia: porDia, top_emprendimientos: topEmp, top_compradores: topComp, por_usuario: porUsuario,
  };
}

module.exports = { historial, metricas, ACCIONES, TIPOS };
