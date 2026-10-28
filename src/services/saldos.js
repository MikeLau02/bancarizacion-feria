'use strict';
/**
 * Lógica central de dinero: compras, anulaciones y recargas.
 *
 * La feria es de UN SOLO DÍA: cada persona puede gastar todo su saldo ese día.
 * (Las columnas saldo_dia1 / saldo_dia2 se conservan en la base de datos por
 * compatibilidad con la versión de dos días, pero ya no reservan dinero: todo
 * el saldo está disponible y las cargas nuevas van a un único bolsillo.)
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

/**
 * Cuánto puede gastar hoy una persona: todo su saldo (feria de un solo día).
 * Si está activada la opción "solo el día de la feria", fuera de esa fecha no se puede comprar.
 */
function disponibleHoy(est, cfg) {
  const info = { disponible_hoy: est.saldo, regla: null };
  if (cfg.solo_dias_feria && cfg.fecha_feria && hoy() !== cfg.fecha_feria) {
    info.disponible_hoy = 0;
    info.regla = 'Hoy no es el día de la feria. No se pueden registrar compras.';
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
    mensaje: mensajeSinSaldo({ saldo: est.saldo, ...lim }),
  };
}

function mensajeSinSaldo(info) {
  if (info.saldo <= 0) return 'Saldo agotado. Esta persona no puede realizar más compras.';
  if (info.disponible_hoy <= 0) return info.regla || 'No tiene saldo disponible hoy.';
  return null;
}

/** Revisa una compra antes de pedir confirmación (no modifica nada). */
async function validarCompra(textoQR, valor) {
  const info = await consultarParaVendedor(textoQR);
  verificarValor(valor);
  verificarFondos(info, valor);
  return { ...info, valor, saldo_anterior: info.saldo, saldo_restante: info.saldo - valor, disponible_restante: info.disponible_hoy - valor };
}

function verificarValor(valor) {
  if (!Number.isInteger(valor) || valor <= 0) throw new ErrorApp(400, 'Ingrese un valor de compra válido (mayor que $0).');
  if (valor > MAX_COMPRA) throw new ErrorApp(400, `El valor máximo de una compra es ${pesos(MAX_COMPRA)}.`);
}

function verificarFondos(info, valor) {
  const sinSaldo = mensajeSinSaldo(info);
  if (sinSaldo) {
    const alerta = info.saldo <= 0 ? 'AGOTADO' : 'DIA_AGOTADO';
    throw new ErrorApp(409, sinSaldo, { alerta, saldo: info.saldo, disponible_hoy: info.disponible_hoy });
  }
  if (valor > info.disponible_hoy) {
    throw new ErrorApp(409, `Saldo insuficiente. Saldo disponible: ${pesos(info.disponible_hoy)}.`,
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
      verificarFondos({ saldo: est.saldo, ...lim }, valor);

      // 4) Registrar y descontar (las columnas por día se mantienen cuadradas: primero dia1, luego dia2)
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

      const despues = disponibleHoy({ saldo: saldoPosterior }, cfg);
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

/** Anula una compra (solo administrador): devuelve el valor al saldo de la persona y deja registro. */
async function anularCompra(transaccionId, adminId, motivo) {
  if (!motivo || motivo.trim().length < 3) throw new ErrorApp(400, 'Escriba el motivo de la anulación.');
  return transaccion(async (conn) => {
    const [[t]] = await conn.query('SELECT * FROM transacciones WHERE id = ? FOR UPDATE', [transaccionId]);
    if (!t) throw new ErrorApp(404, 'La transacción no existe.');
    if (t.estado === 'ANULADA') throw new ErrorApp(409, 'Esta transacción ya fue anulada.');
    const [[est]] = await conn.query('SELECT id, saldo FROM estudiantes WHERE id = ? FOR UPDATE', [t.estudiante_id]);
    const fecha = ahora();
    await conn.query(
      'UPDATE estudiantes SET saldo = saldo + ?, saldo_dia1 = saldo_dia1 + ?, actualizado_en = ? WHERE id = ?',
      [t.valor, t.valor, fecha, est.id]);
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
 * Feria de un solo día: todo el dinero queda disponible de inmediato (un solo bolsillo).
 * Si la persona aún tenía saldo de la versión de dos días en saldo_dia2, se une al saldo principal.
 */
async function moverSaldo(conn, { estudianteId, adminId, tipo, valor, observacion }) {
  if (!Number.isInteger(valor) || valor === 0) throw new ErrorApp(400, 'Ingrese un valor válido.');
  if (tipo !== 'AJUSTE' && valor < 0) throw new ErrorApp(400, 'La recarga debe ser un valor positivo.');
  if (Math.abs(valor) > 10000000) throw new ErrorApp(400, 'Valor demasiado alto.');
  const [[est]] = await conn.query('SELECT id, saldo, estado FROM estudiantes WHERE id = ? FOR UPDATE', [estudianteId]);
  if (!est) throw new ErrorApp(404, 'La persona no existe.');
  const [[previas]] = await conn.query('SELECT COUNT(*) AS n FROM recargas WHERE estudiante_id = ?', [est.id]);

  const nuevo = est.saldo + valor;
  if (nuevo < 0) throw new ErrorApp(409, `El ajuste dejaría el saldo en negativo. Saldo actual: ${pesos(est.saldo)}.`);
  const fecha = ahora();
  await conn.query(
    `INSERT INTO recargas (estudiante_id, admin_id, tipo, dia, valor, valor_dia1, valor_dia2, saldo_anterior, saldo_nuevo, observacion, fecha_hora)
     VALUES (?,?,?,'DIA1',?,?,0,?,?,?,?)`, [est.id, adminId, tipo, valor, valor, est.saldo, nuevo, observacion || null, fecha]);
  // La primera carga activa la cuenta (después de reiniciar la prueba piloto todas quedan bloqueadas
  // hasta su primera recarga). Una cuenta bloqueada a mano que ya tenía cargas sigue bloqueada.
  const primera = previas.n === 0 && valor > 0;
  const activada = primera && est.estado === 'BLOQUEADA';
  await conn.query(
    `UPDATE estudiantes SET saldo = ?, saldo_dia1 = ?, saldo_dia2 = 0, actualizado_en = ?
       ${primera ? ', saldo_inicial = ?' : ''}${activada ? ", estado = 'ACTIVA'" : ''} WHERE id = ?`,
    [nuevo, nuevo, fecha, ...(primera ? [valor] : []), est.id]);
  return { saldo_anterior: est.saldo, saldo_nuevo: nuevo, valor, fecha_hora: fecha, activada };
}

/** Consulta del propio comprador: saldo, cuánto le queda e historial (sin datos de otros). */
async function consultaComprador(textoQR) {
  const token = normalizarToken(textoQR);
  if (!token) throw new ErrorApp(404, 'Código no válido. Revise el código impreso debajo de su QR.');
  const cfg = await obtenerConfig();
  const [p] = await query(
    `SELECT e.id, e.nombre_completo, e.tipo, e.saldo, e.saldo_inicial, e.estado, c.nombre AS curso
     FROM estudiantes e LEFT JOIN cursos c ON c.id = e.curso_id WHERE e.qr_token = ?`, [token]);
  if (!p) throw new ErrorApp(404, 'No existe ninguna cuenta con ese código.');
  const compras = await query(
    `SELECT t.fecha_hora, em.nombre AS emprendimiento, t.valor, t.saldo_posterior, t.estado
     FROM transacciones t JOIN emprendimientos em ON em.id = t.emprendimiento_id WHERE t.estudiante_id = ? ORDER BY t.fecha_hora, t.id`, [p.id]);
  const recargas = await query(
    'SELECT fecha_hora, tipo, valor, saldo_nuevo FROM recargas WHERE estudiante_id = ? ORDER BY fecha_hora, id', [p.id]);
  const cargado = recargas.reduce((s, r) => s + r.valor, 0);
  const gastado = compras.filter((c) => c.estado === 'CONFIRMADA').reduce((s, c) => s + c.valor, 0);
  return {
    nombre: p.nombre_completo, tipo: p.tipo, curso: p.curso, estado: p.estado,
    saldo: p.saldo, total_cargado: cargado, total_gastado: gastado,
    ...disponibleHoy(p, cfg),
    fecha_feria: cfg.fecha_feria, feria: cfg.nombre_feria,
    compras, recargas,
  };
}

module.exports = {
  normalizarToken, consultarParaVendedor, validarCompra, registrarCompra, anularCompra, moverSaldo, consultaComprador, disponibleHoy,
};
