'use strict';
/**
 * Lógica central de dinero: compras, anulaciones, recargas y saldo por día.
 *
 * Cada persona tiene dos "bolsillos":
 *   saldo_dia1 → se puede gastar desde el día 1 de la feria.
 *   saldo_dia2 → queda reservado y solo se puede gastar desde el día 2.
 * La primera carga se divide automáticamente (50 % / 50 % por defecto); en las
 * recargas siguientes el administrador elige a qué día se asigna el dinero.
 * Antes del día 2 solo se puede gastar saldo_dia1; desde el día 2 se puede gastar
 * todo (lo que sobró del día 1 más lo del día 2).
 *
 * Todas las operaciones que cambian un saldo:
 *   1. abren una transacción de base de datos,
 *   2. bloquean la fila de la persona con SELECT ... FOR UPDATE
 *      (si dos vendedores cobran a la misma persona a la vez, el segundo
 *      espera a que el primero termine y ve el saldo ya actualizado),
 *   3. validan, escriben el movimiento y actualizan el saldo,
 *   4. confirman (COMMIT) o deshacen todo (ROLLBACK) si algo falla.
 */
const { query, transaccion, pool } = require('../db');
const { ErrorApp, ahora, hoy, pesos } = require('../utils');
const { obtenerConfig } = require('./configuracion');
const { auditar } = require('./auditoria');

const MAX_COMPRA = 1000000;
const fechaCorta = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : 'día 2');

/**
 * Extrae el identificador secreto del texto leído en el QR.
 * Formato del QR: FERIAQR:<identificador>|<nombre>|<curso o rol>
 * También acepta solo el código de 32 caracteres (escrito a mano, con o sin espacios).
 */
function normalizarToken(texto) {
  let t = String(texto || '').trim();
  const i = t.toUpperCase().indexOf('FERIAQR:');
  if (i >= 0) t = t.slice(i + 8).split('|')[0];
  const limpio = t.toLowerCase().replace(/[\s-]/g, '');
  return /^[a-f0-9]{32}$/.test(limpio) ? limpio : null;
}

/** ¿Hoy ya se puede gastar el saldo reservado para el día 2? */
function dia2Habilitado(cfg) {
  if (!cfg.limite_diario_activo || !cfg.fecha_dia2) return true;
  return hoy() >= cfg.fecha_dia2;
}

/** Cuánto puede gastar hoy una persona y cuánto tiene reservado para el día 2. */
function disponibleHoy(est, cfg) {
  const fecha = hoy();
  const info = { disponible_hoy: est.saldo, reservado_dia2: 0, regla: null };
  if (cfg.solo_dias_feria && fecha !== cfg.fecha_dia1 && fecha !== cfg.fecha_dia2) {
    info.disponible_hoy = 0;
    info.regla = 'Hoy no es un día de feria. No se pueden registrar compras.';
    return info;
  }
  if (!dia2Habilitado(cfg)) {
    info.disponible_hoy = est.saldo_dia1;
    info.reservado_dia2 = est.saldo_dia2;
    if (est.saldo_dia2 > 0) info.regla = `${pesos(est.saldo_dia2)} están reservados para el día 2 (${fechaCorta(cfg.fecha_dia2)}) y no se pueden gastar hoy.`;
  }
  return info;
}

/** Información mínima que ve el vendedor al escanear un QR (sin identificación ni historial). */
async function consultarParaVendedor(textoQR) {
  const token = normalizarToken(textoQR);
  if (!token) throw new ErrorApp(404, 'QR no válido. Este código no pertenece a la feria.', { alerta: 'QR_INEXISTENTE' });
  const cfg = await obtenerConfig();
  const [est] = await query(
    `SELECT e.id, e.nombre_completo, e.tipo, e.saldo, e.saldo_dia1, e.saldo_dia2, e.estado, c.nombre AS curso
     FROM estudiantes e LEFT JOIN cursos c ON c.id = e.curso_id WHERE e.qr_token = ?`, [token]);
  if (!est) throw new ErrorApp(404, 'QR no registrado. No existe ninguna cuenta asociada a este código.', { alerta: 'QR_INEXISTENTE' });
  if (est.estado === 'BLOQUEADA') {
    throw new ErrorApp(423, `La cuenta de ${est.nombre_completo} está BLOQUEADA. No puede realizar compras.`, { alerta: 'BLOQUEADA' });
  }
  const lim = disponibleHoy(est, cfg);
  let alerta = null;
  if (est.saldo === 0) alerta = 'AGOTADO';
  else if (lim.disponible_hoy === 0) alerta = 'DIA_AGOTADO';
  else if (lim.disponible_hoy < cfg.saldo_bajo) alerta = 'SALDO_BAJO';
  return {
    token,
    nombre: est.nombre_completo,
    tipo: est.tipo,
    curso: est.curso,
    saldo: est.saldo,
    ...lim,
    saldo_bajo: cfg.saldo_bajo,
    alerta,
    mensaje: mensajeSinSaldo({ saldo: est.saldo, ...lim }, cfg),
  };
}

function mensajeSinSaldo(info, cfg) {
  if (info.saldo <= 0) return 'Saldo agotado. Esta persona no puede realizar más compras.';
  if (info.disponible_hoy <= 0) {
    if (info.reservado_dia2 > 0) return `Saldo del día 1 agotado. Tiene ${pesos(info.reservado_dia2)} reservados para el día 2 (${fechaCorta(cfg.fecha_dia2)}).`;
    return info.regla || 'No tiene saldo disponible hoy.';
  }
  return null;
}

/** Revisa una compra antes de pedir confirmación (no modifica nada). */
async function validarCompra(textoQR, valor) {
  const info = await consultarParaVendedor(textoQR);
  const cfg = await obtenerConfig();
  verificarValor(valor);
  verificarFondos(info, valor, cfg);
  return { ...info, valor, saldo_anterior: info.saldo, saldo_restante: info.saldo - valor, disponible_restante: info.disponible_hoy - valor };
}

function verificarValor(valor) {
  if (!Number.isInteger(valor) || valor <= 0) throw new ErrorApp(400, 'Ingrese un valor de compra válido (mayor que $0).');
  if (valor > MAX_COMPRA) throw new ErrorApp(400, `El valor máximo de una compra es ${pesos(MAX_COMPRA)}.`);
}

function verificarFondos(info, valor, cfg) {
  const sinSaldo = mensajeSinSaldo(info, cfg);
  if (sinSaldo) {
    const alerta = info.saldo <= 0 ? 'AGOTADO' : 'DIA_AGOTADO';
    throw new ErrorApp(409, sinSaldo, { alerta, saldo: info.saldo, disponible_hoy: info.disponible_hoy });
  }
  if (valor > info.disponible_hoy) {
    const extra = info.reservado_dia2 > 0 ? ` (${pesos(info.reservado_dia2)} más están reservados para el día 2)` : '';
    throw new ErrorApp(409, `Saldo insuficiente. Saldo disponible: ${pesos(info.disponible_hoy)}.${extra}`,
      { alerta: 'INSUFICIENTE', saldo: info.saldo, disponible_hoy: info.disponible_hoy });
  }
}

function filaACompra(t) {
  return {
    id: t.id,
    codigo_operacion: t.codigo_operacion,
    valor: t.valor,
    saldo_anterior: t.saldo_anterior,
    saldo_posterior: t.saldo_posterior,
    fecha_hora: t.fecha_hora,
    estado: t.estado,
  };
}

/**
 * Registra una compra de forma atómica.
 * codigoOperacion es generado por el dispositivo del vendedor: si la misma
 * operación llega dos veces (doble toque, reintento por mala conexión),
 * se devuelve la compra ya registrada en lugar de cobrar de nuevo.
 */
async function registrarCompra({ textoQR, valor, codigoOperacion, vendedor }) {
  const token = normalizarToken(textoQR);
  if (!token) throw new ErrorApp(404, 'QR no válido. Este código no pertenece a la feria.', { alerta: 'QR_INEXISTENTE' });
  verificarValor(valor);
  if (!/^[A-Za-z0-9-]{16,64}$/.test(codigoOperacion || '')) throw new ErrorApp(400, 'Código de operación no válido. Recargue la página.');

  try {
    return await transaccion(async (conn) => {
      const cfg = await obtenerConfig(conn);
      // 1) Bloquear la cuenta hasta terminar la operación
      const [[est]] = await conn.query(
        `SELECT e.id, e.nombre_completo, e.tipo, e.saldo, e.saldo_dia1, e.saldo_dia2, e.estado, c.nombre AS curso
         FROM estudiantes e LEFT JOIN cursos c ON c.id = e.curso_id WHERE e.qr_token = ? FOR UPDATE`, [token]);
      if (!est) throw new ErrorApp(404, 'QR no registrado. No existe ninguna cuenta asociada a este código.', { alerta: 'QR_INEXISTENTE' });

      // 2) ¿Esta misma operación ya se había registrado? (protección contra duplicados)
      const [[previa]] = await conn.query('SELECT * FROM transacciones WHERE codigo_operacion = ?', [codigoOperacion]);
      if (previa) {
        if (previa.vendedor_id !== vendedor.id || previa.estudiante_id !== est.id) {
          throw new ErrorApp(409, 'Código de operación repetido. Recargue la página e intente de nuevo.');
        }
        return { duplicada: true, nombre: est.nombre_completo, curso: est.curso, ...filaACompra(previa), saldo_actual: est.saldo, agotado: est.saldo === 0 };
      }

      // 3) Validaciones con el saldo real y bloqueado
      if (est.estado === 'BLOQUEADA') throw new ErrorApp(423, `La cuenta de ${est.nombre_completo} está BLOQUEADA. No puede realizar compras.`, { alerta: 'BLOQUEADA' });
      const [[emp]] = await conn.query('SELECT id, nombre, activo FROM emprendimientos WHERE id = ?', [vendedor.emprendimiento_id]);
      if (!emp || !emp.activo) throw new ErrorApp(403, 'Su emprendimiento está desactivado. Comuníquese con el administrador.');
      const lim = disponibleHoy(est, cfg);
      verificarFondos({ saldo: est.saldo, ...lim }, valor, cfg);

      // 4) Registrar y descontar: primero del saldo del día 1, luego del día 2 (solo si ya está habilitado)
      const deDia1 = Math.min(valor, est.saldo_dia1);
      const deDia2 = valor - deDia1;
      const saldoAnterior = est.saldo;
      const saldoPosterior = saldoAnterior - valor;
      const fecha = ahora();
      const [ins] = await conn.query(
        `INSERT INTO transacciones (codigo_operacion, estudiante_id, emprendimiento_id, vendedor_id, valor, valor_dia1, valor_dia2,
           saldo_anterior, saldo_posterior, fecha_hora) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [codigoOperacion, est.id, emp.id, vendedor.id, valor, deDia1, deDia2, saldoAnterior, saldoPosterior, fecha]);
      const [upd] = await conn.query(
        `UPDATE estudiantes SET saldo = saldo - ?, saldo_dia1 = saldo_dia1 - ?, saldo_dia2 = saldo_dia2 - ?, actualizado_en = ?
         WHERE id = ? AND saldo = ? AND saldo_dia1 >= ? AND saldo_dia2 >= ?`,
        [valor, deDia1, deDia2, fecha, est.id, saldoAnterior, deDia1, deDia2]);
      if (upd.affectedRows !== 1) throw new ErrorApp(409, 'El saldo cambió durante la operación. Escanee de nuevo.');

      const despues = disponibleHoy({ saldo: saldoPosterior, saldo_dia1: est.saldo_dia1 - deDia1, saldo_dia2: est.saldo_dia2 - deDia2 }, cfg);
      return {
        duplicada: false,
        id: ins.insertId,
        codigo_operacion: codigoOperacion,
        nombre: est.nombre_completo,
        curso: est.curso,
        emprendimiento: emp.nombre,
        valor,
        saldo_anterior: saldoAnterior,
        saldo_posterior: saldoPosterior,
        saldo_actual: saldoPosterior,
        disponible_hoy: despues.disponible_hoy,
        reservado_dia2: despues.reservado_dia2,
        fecha_hora: fecha,
        estado: 'CONFIRMADA',
        agotado: saldoPosterior === 0,
        saldo_bajo: despues.disponible_hoy > 0 && despues.disponible_hoy < cfg.saldo_bajo,
      };
    });
  } catch (err) {
    // Dos peticiones idénticas exactamente al mismo tiempo: la segunda choca con la clave única.
    if (err.code === 'ER_DUP_ENTRY' && /codigo_operacion|uq_transacciones_operacion/.test(err.message)) {
      const [previa] = await query('SELECT * FROM transacciones WHERE codigo_operacion = ?', [codigoOperacion]);
      if (previa && previa.vendedor_id === vendedor.id) return { duplicada: true, ...filaACompra(previa), saldo_actual: previa.saldo_posterior };
    }
    throw err;
  }
}

/** Anula una compra (solo administrador): devuelve el valor a cada día de donde salió y deja registro. */
async function anularCompra(transaccionId, adminId, motivo) {
  if (!motivo || motivo.trim().length < 3) throw new ErrorApp(400, 'Escriba el motivo de la anulación.');
  return transaccion(async (conn) => {
    const [[t]] = await conn.query('SELECT * FROM transacciones WHERE id = ? FOR UPDATE', [transaccionId]);
    if (!t) throw new ErrorApp(404, 'La transacción no existe.');
    if (t.estado === 'ANULADA') throw new ErrorApp(409, 'Esta transacción ya fue anulada.');
    const [[est]] = await conn.query('SELECT id, saldo FROM estudiantes WHERE id = ? FOR UPDATE', [t.estudiante_id]);
    const fecha = ahora();
    await conn.query(
      'UPDATE estudiantes SET saldo = saldo + ?, saldo_dia1 = saldo_dia1 + ?, saldo_dia2 = saldo_dia2 + ?, actualizado_en = ? WHERE id = ?',
      [t.valor, t.valor_dia1, t.valor_dia2, fecha, est.id]);
    await conn.query(
      `UPDATE transacciones SET estado = 'ANULADA', anulada_por = ?, anulada_en = ?, motivo_anulacion = ?
       WHERE id = ? AND estado = 'CONFIRMADA'`, [adminId, fecha, motivo.trim().slice(0, 255), t.id]);
    await auditar(conn, adminId, 'ANULAR_COMPRA', 'transacciones', t.id, {
      valor: t.valor, estudiante_id: est.id, saldo_antes: est.saldo, saldo_despues: est.saldo + t.valor, motivo: motivo.trim(),
    });
    return { id: t.id, valor_devuelto: t.valor, saldo_anterior: est.saldo, saldo_nuevo: est.saldo + t.valor };
  });
}

/**
 * Carga, recarga o ajusta saldo (solo administrador).
 *   tipo: INICIAL | RECARGA (valor > 0) | AJUSTE (positivo o negativo, nunca deja saldo negativo)
 *   dia:  DIA1 | DIA2 | AMBOS (se divide según el porcentaje configurado, 50 % por defecto)
 * La PRIMERA carga de cada persona siempre se divide entre los dos días.
 */
async function moverSaldo(conn, { estudianteId, adminId, tipo, valor, dia, observacion }) {
  if (!Number.isInteger(valor) || valor === 0) throw new ErrorApp(400, 'Ingrese un valor válido.');
  if (tipo !== 'AJUSTE' && valor < 0) throw new ErrorApp(400, 'La recarga debe ser un valor positivo.');
  if (Math.abs(valor) > 10000000) throw new ErrorApp(400, 'Valor demasiado alto.');
  if (!['DIA1', 'DIA2', 'AMBOS'].includes(dia)) dia = 'AMBOS';
  const cfg = await obtenerConfig(conn);
  const [[est]] = await conn.query('SELECT id, saldo, saldo_dia1, saldo_dia2 FROM estudiantes WHERE id = ? FOR UPDATE', [estudianteId]);
  if (!est) throw new ErrorApp(404, 'La persona no existe.');
  const [[previas]] = await conn.query('SELECT COUNT(*) AS n FROM recargas WHERE estudiante_id = ?', [est.id]);
  if (previas.n === 0 && valor > 0) dia = 'AMBOS'; // primera carga: mitad para cada día
  if (valor < 0 && dia === 'AMBOS') throw new ErrorApp(400, 'Para restar saldo elija de qué día se descuenta (día 1 o día 2).');

  let d1 = 0;
  let d2 = 0;
  if (dia === 'DIA1') d1 = valor;
  else if (dia === 'DIA2') d2 = valor;
  else { d1 = Math.round((valor * cfg.porcentaje_dia1) / 100); d2 = valor - d1; }
  if (est.saldo_dia1 + d1 < 0) throw new ErrorApp(409, `El ajuste dejaría el saldo del día 1 en negativo. Saldo del día 1: ${pesos(est.saldo_dia1)}.`);
  if (est.saldo_dia2 + d2 < 0) throw new ErrorApp(409, `El ajuste dejaría el saldo del día 2 en negativo. Saldo del día 2: ${pesos(est.saldo_dia2)}.`);

  const nuevo = est.saldo + valor;
  const fecha = ahora();
  await conn.query(
    `INSERT INTO recargas (estudiante_id, admin_id, tipo, dia, valor, valor_dia1, valor_dia2, saldo_anterior, saldo_nuevo, observacion, fecha_hora)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [est.id, adminId, tipo, dia, valor, d1, d2, est.saldo, nuevo, observacion || null, fecha]);
  await conn.query('UPDATE estudiantes SET saldo = ?, saldo_dia1 = saldo_dia1 + ?, saldo_dia2 = saldo_dia2 + ?, actualizado_en = ? WHERE id = ?',
    [nuevo, d1, d2, fecha, est.id]);
  return { saldo_anterior: est.saldo, saldo_nuevo: nuevo, valor, dia, valor_dia1: d1, valor_dia2: d2, fecha_hora: fecha };
}

/** Consulta del propio comprador: saldo por día e historial (sin datos de otros). */
async function consultaComprador(textoQR) {
  const token = normalizarToken(textoQR);
  if (!token) throw new ErrorApp(404, 'Código no válido. Revise el código impreso debajo de su QR.');
  const cfg = await obtenerConfig();
  const [p] = await query(
    `SELECT e.id, e.nombre_completo, e.tipo, e.saldo, e.saldo_dia1, e.saldo_dia2, e.estado, c.nombre AS curso
     FROM estudiantes e LEFT JOIN cursos c ON c.id = e.curso_id WHERE e.qr_token = ?`, [token]);
  if (!p) throw new ErrorApp(404, 'No existe ninguna cuenta con ese código.');
  const compras = await query(
    `SELECT t.fecha_hora, em.nombre AS emprendimiento, t.valor, t.saldo_posterior, t.estado
     FROM transacciones t JOIN emprendimientos em ON em.id = t.emprendimiento_id WHERE t.estudiante_id = ? ORDER BY t.fecha_hora, t.id`, [p.id]);
  const recargas = await query(
    'SELECT fecha_hora, tipo, dia, valor, valor_dia1, valor_dia2, saldo_nuevo FROM recargas WHERE estudiante_id = ? ORDER BY fecha_hora, id', [p.id]);
  return {
    nombre: p.nombre_completo, tipo: p.tipo, curso: p.curso, estado: p.estado,
    saldo: p.saldo, saldo_dia1: p.saldo_dia1, saldo_dia2: p.saldo_dia2,
    ...disponibleHoy(p, cfg),
    fecha_dia1: cfg.fecha_dia1, fecha_dia2: cfg.fecha_dia2, feria: cfg.nombre_feria,
    compras, recargas,
  };
}

module.exports = {
  normalizarToken, consultarParaVendedor, validarCompra, registrarCompra, anularCompra, moverSaldo, consultaComprador, disponibleHoy,
};
