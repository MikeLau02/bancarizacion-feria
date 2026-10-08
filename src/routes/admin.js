'use strict';
/** API del administrador. Todas las rutas exigen rol ADMIN (ver server.js). */
const express = require('express');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const archiver = require('archiver');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { query, transaccion } = require('../db');
const { asyncH, ErrorApp, ahora, hoy, aEntero, texto, nuevoTokenQR } = require('../utils');
const { obtenerConfig, normalizar } = require('../services/configuracion');
const { auditar } = require('../services/auditoria');
const saldos = require('../services/saldos');

const router = express.Router();
const TIPOS = ['ESTUDIANTE', 'DOCENTE', 'DIRECTIVO', 'ADMINISTRATIVO', 'FAMILIA', 'OTRO'];
const idParam = (req) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) throw new ErrorApp(400, 'Identificador no válido.');
  return id;
};
const fechaValida = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);

// =====================================================================
// Dashboard
// =====================================================================
router.get('/dashboard', asyncH(async (req, res) => {
  const cfg = await obtenerConfig();
  const [[personas], [cargado], [vendido], [anuladas], porTipo, porEmp, porDia, recientes, agotados, bajos, porCursoEmp] = await Promise.all([
    query(`SELECT COUNT(*) AS total, COALESCE(SUM(saldo),0) AS saldo_pendiente,
             COALESCE(SUM(saldo_dia1),0) AS saldo_dia1, COALESCE(SUM(saldo_dia2),0) AS saldo_dia2,
             COALESCE(SUM(saldo = 0),0) AS agotados, COALESCE(SUM(saldo > 0 AND saldo < ?),0) AS bajos,
             COALESCE(SUM(estado = 'BLOQUEADA'),0) AS bloqueadas FROM estudiantes`, [cfg.saldo_bajo]),
    query('SELECT COALESCE(SUM(valor),0) AS total FROM recargas'),
    query(`SELECT COUNT(*) AS cantidad, COALESCE(SUM(valor),0) AS total FROM transacciones WHERE estado = 'CONFIRMADA'`),
    query(`SELECT COUNT(*) AS cantidad, COALESCE(SUM(valor),0) AS total FROM transacciones WHERE estado = 'ANULADA'`),
    query(`SELECT e.tipo, COUNT(DISTINCT e.id) AS personas, COUNT(t.id) AS cantidad, COALESCE(SUM(t.valor),0) AS total
           FROM estudiantes e LEFT JOIN transacciones t ON t.estudiante_id = e.id AND t.estado = 'CONFIRMADA'
           GROUP BY e.tipo ORDER BY total DESC, personas DESC`),
    query(`SELECT em.id, em.nombre, c.nombre AS curso, COUNT(t.id) AS cantidad, COALESCE(SUM(t.valor),0) AS total
           FROM emprendimientos em LEFT JOIN cursos c ON c.id = em.curso_id
           LEFT JOIN transacciones t ON t.emprendimiento_id = em.id AND t.estado = 'CONFIRMADA'
           GROUP BY em.id, em.nombre, c.nombre ORDER BY total DESC, em.nombre`),
    query(`SELECT DATE_FORMAT(fecha_hora, '%Y-%m-%d') AS dia, COUNT(*) AS cantidad, SUM(valor) AS total
           FROM transacciones WHERE estado = 'CONFIRMADA' GROUP BY dia ORDER BY dia`),
    query(`SELECT t.id, t.fecha_hora, t.valor, t.saldo_posterior, t.estado, e.nombre_completo, em.nombre AS emprendimiento
           FROM transacciones t JOIN estudiantes e ON e.id = t.estudiante_id JOIN emprendimientos em ON em.id = t.emprendimiento_id
           ORDER BY t.id DESC LIMIT 10`),
    query(`SELECT e.id, e.nombre_completo, c.nombre AS curso, e.saldo FROM estudiantes e LEFT JOIN cursos c ON c.id = e.curso_id
           WHERE e.saldo = 0 ORDER BY e.nombre_completo LIMIT 100`),
    query(`SELECT e.id, e.nombre_completo, c.nombre AS curso, e.saldo FROM estudiantes e LEFT JOIN cursos c ON c.id = e.curso_id
           WHERE e.saldo > 0 AND e.saldo < ? ORDER BY e.saldo, e.nombre_completo LIMIT 100`, [cfg.saldo_bajo]),
    query(`SELECT COALESCE(c.nombre,'Sin curso') AS curso, COUNT(t.id) AS cantidad, COALESCE(SUM(t.valor),0) AS total
           FROM transacciones t JOIN emprendimientos em ON em.id = t.emprendimiento_id LEFT JOIN cursos c ON c.id = em.curso_id
           WHERE t.estado = 'CONFIRMADA' GROUP BY c.nombre ORDER BY total DESC`),
  ]);
  res.json({
    config: cfg,
    hoy: hoy(),
    indicadores: {
      personas: personas.total,
      total_cargado: cargado.total,
      total_vendido: vendido.total,
      saldo_pendiente: personas.saldo_pendiente,
      saldo_dia1: personas.saldo_dia1,
      saldo_dia2: personas.saldo_dia2,
      transacciones: vendido.cantidad,
      agotados: personas.agotados,
      saldo_bajo: personas.bajos,
      bloqueadas: personas.bloqueadas,
      anuladas: anuladas.cantidad,
      valor_anulado: anuladas.total,
    },
    por_tipo: porTipo,
    actualizado: ahora(),
    dia2_habilitado: hoy() >= (cfg.fecha_dia2 || '0000') || !cfg.limite_diario_activo,
    por_emprendimiento: porEmp,
    por_dia: porDia,
    por_curso_emprendimiento: porCursoEmp,
    recientes,
    lista_agotados: agotados,
    lista_saldo_bajo: bajos,
  });
}));

// Buscador global por nombre, curso o código
router.get('/buscar', asyncH(async (req, res) => {
  const q = texto(req.query.q, 80);
  if (q.length < 1) return res.json([]);
  const like = `%${q}%`;
  const rol = TIPOS.find((t) => t.startsWith(q.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')) && q.length >= 3) || '-';
  const token = saldos.normalizarToken(q) || '-';
  res.json(await query(
    `SELECT e.id, e.nombre_completo, e.identificacion, e.tipo, e.saldo, e.estado, c.nombre AS curso
     FROM estudiantes e LEFT JOIN cursos c ON c.id = e.curso_id
     WHERE e.nombre_completo LIKE ? OR e.identificacion LIKE ? OR c.nombre = ? OR e.qr_token = ? OR e.tipo = ?
     ORDER BY e.nombre_completo LIMIT 50`, [like, like, q, token, rol]));
}));

// =====================================================================
// Cursos
// =====================================================================
router.get('/cursos', asyncH(async (req, res) => {
  res.json(await query(
    `SELECT c.id, c.nombre, c.activo,
       (SELECT COUNT(*) FROM estudiantes e WHERE e.curso_id = c.id) AS personas,
       (SELECT COUNT(*) FROM emprendimientos m WHERE m.curso_id = c.id) AS emprendimientos
     FROM cursos c ORDER BY c.nombre`));
}));

router.post('/cursos', asyncH(async (req, res) => {
  const nombre = texto(req.body.nombre, 30).toUpperCase();
  if (!nombre) throw new ErrorApp(400, 'Escriba el nombre del curso.');
  const r = await query('INSERT INTO cursos (nombre, creado_en) VALUES (?,?)', [nombre, ahora()]);
  res.status(201).json({ id: r.insertId, nombre });
}));

router.put('/cursos/:id', asyncH(async (req, res) => {
  const nombre = texto(req.body.nombre, 30).toUpperCase();
  if (!nombre) throw new ErrorApp(400, 'Escriba el nombre del curso.');
  await query('UPDATE cursos SET nombre = ? WHERE id = ?', [nombre, idParam(req)]);
  res.json({ ok: true });
}));

router.delete('/cursos/:id', asyncH(async (req, res) => {
  const id = idParam(req);
  const [uso] = await query('SELECT (SELECT COUNT(*) FROM estudiantes WHERE curso_id = ?) AS n', [id]);
  if (uso.n > 0) throw new ErrorApp(409, 'No se puede eliminar: hay personas registradas en este curso.');
  await query('DELETE FROM cursos WHERE id = ?', [id]);
  res.json({ ok: true });
}));

async function cursoId(conn, valor, crear = false) {
  if (valor === undefined || valor === null || valor === '') return null;
  if (/^\d+$/.test(String(valor))) {
    const [[c]] = await conn.query('SELECT id FROM cursos WHERE id = ?', [valor]);
    if (!c) throw new ErrorApp(400, 'El curso seleccionado no existe.');
    return c.id;
  }
  const nombre = texto(valor, 30).toUpperCase();
  const [[c]] = await conn.query('SELECT id FROM cursos WHERE nombre = ?', [nombre]);
  if (c) return c.id;
  if (!crear) throw new ErrorApp(400, `El curso ${nombre} no existe.`);
  const [r] = await conn.query('INSERT INTO cursos (nombre, creado_en) VALUES (?,?)', [nombre, ahora()]);
  return r.insertId;
}

// =====================================================================
// Personas (tabla "estudiantes")
// =====================================================================
router.get('/personas', asyncH(async (req, res) => {
  const cfg = await obtenerConfig();
  const cond = [];
  const p = [];
  const q = texto(req.query.q, 80);
  if (q) { cond.push('(e.nombre_completo LIKE ? OR e.identificacion LIKE ? OR c.nombre = ?)'); p.push(`%${q}%`, `%${q}%`, q); }
  if (req.query.curso_id) { cond.push('e.curso_id = ?'); p.push(parseInt(req.query.curso_id, 10)); }
  if (TIPOS.includes(req.query.tipo)) { cond.push('e.tipo = ?'); p.push(req.query.tipo); }
  if (['ACTIVA', 'BLOQUEADA'].includes(req.query.estado)) { cond.push('e.estado = ?'); p.push(req.query.estado); }
  if (req.query.saldo === 'agotado') cond.push('e.saldo = 0');
  if (req.query.saldo === 'bajo') { cond.push('e.saldo > 0 AND e.saldo < ?'); p.push(cfg.saldo_bajo); }
  const filas = await query(
    `SELECT e.id, e.tipo, e.nombre_completo, e.identificacion, e.curso_id, c.nombre AS curso, e.saldo_inicial, e.saldo, e.saldo_dia1, e.saldo_dia2,
       e.estado, e.creado_en,
       (SELECT COALESCE(SUM(valor),0) FROM recargas r WHERE r.estudiante_id = e.id) AS total_cargado,
       (SELECT COALESCE(SUM(valor),0) FROM transacciones t WHERE t.estudiante_id = e.id AND t.estado = 'CONFIRMADA') AS total_gastado
     FROM estudiantes e LEFT JOIN cursos c ON c.id = e.curso_id
     ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
     ORDER BY c.nombre IS NULL, c.nombre, e.nombre_completo LIMIT 5000`, p);
  res.json({ saldo_bajo: cfg.saldo_bajo, personas: filas });
}));

router.get('/personas/:id', asyncH(async (req, res) => {
  const id = idParam(req);
  const [e] = await query(
    `SELECT e.*, c.nombre AS curso,
       (SELECT COALESCE(SUM(valor),0) FROM recargas r WHERE r.estudiante_id = e.id) AS total_cargado
     FROM estudiantes e LEFT JOIN cursos c ON c.id = e.curso_id WHERE e.id = ?`, [id]);
  if (!e) throw new ErrorApp(404, 'La persona no existe.');
  const compras = await query(
    `SELECT t.id, t.fecha_hora, t.valor, t.valor_dia1, t.valor_dia2, t.saldo_anterior, t.saldo_posterior, t.estado, t.motivo_anulacion, t.anulada_en,
       em.nombre AS emprendimiento, u.nombre AS vendedor, ua.nombre AS anulada_por
     FROM transacciones t JOIN emprendimientos em ON em.id = t.emprendimiento_id JOIN usuarios u ON u.id = t.vendedor_id
     LEFT JOIN usuarios ua ON ua.id = t.anulada_por
     WHERE t.estudiante_id = ? ORDER BY t.fecha_hora, t.id`, [id]);
  const recargas = await query(
    `SELECT r.id, r.fecha_hora, r.tipo, r.dia, r.valor, r.valor_dia1, r.valor_dia2, r.saldo_anterior, r.saldo_nuevo, r.observacion,
       u.nombre AS administrador
     FROM recargas r JOIN usuarios u ON u.id = r.admin_id WHERE r.estudiante_id = ? ORDER BY r.fecha_hora, r.id`, [id]);
  const dia = saldos.disponibleHoy(e, await obtenerConfig());
  res.json({ persona: { ...e, ...dia }, compras, recargas });
}));

function datosPersona(body) {
  const d = {
    tipo: TIPOS.includes(body.tipo) ? body.tipo : 'ESTUDIANTE',
    nombre_completo: texto(body.nombre_completo, 150).replace(/\s+/g, ' '),
    identificacion: texto(body.identificacion, 40),
    curso: body.curso_id ?? body.curso ?? null,
  };
  if (d.nombre_completo.length < 3) throw new ErrorApp(400, 'Escriba el nombre completo.');
  if (!d.identificacion) throw new ErrorApp(400, 'Escriba el número de identificación o código interno.');
  if (d.tipo === 'ESTUDIANTE' && (d.curso === null || d.curso === '')) throw new ErrorApp(400, 'Seleccione el curso del estudiante.');
  return d;
}

async function crearPersona(conn, body, adminId, crearCurso = false) {
  const d = datosPersona(body);
  const saldoInicial = body.saldo_inicial === undefined || body.saldo_inicial === '' ? 0 : aEntero(body.saldo_inicial);
  if (!Number.isInteger(saldoInicial) || saldoInicial < 0) throw new ErrorApp(400, 'El saldo inicial no es válido.');
  const curso = await cursoId(conn, d.curso, crearCurso);
  const fecha = ahora();
  let r;
  for (let intento = 0; ; intento++) {
    try {
      [r] = await conn.query(
        `INSERT INTO estudiantes (tipo, nombre_completo, curso_id, identificacion, saldo_inicial, saldo, estado, qr_token, creado_en, actualizado_en)
         VALUES (?,?,?,?,?,0,?,?,?,?)`,
        [d.tipo, d.nombre_completo, curso, d.identificacion, saldoInicial, body.estado === 'BLOQUEADA' ? 'BLOQUEADA' : 'ACTIVA', nuevoTokenQR(), fecha, fecha]);
      break;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY' && /qr/.test(err.message) && intento < 3) continue; // token repetido: generar otro
      if (err.code === 'ER_DUP_ENTRY') throw new ErrorApp(409, `Ya existe una persona con la identificación ${d.identificacion}.`);
      throw err;
    }
  }
  if (saldoInicial > 0) {
    await saldos.moverSaldo(conn, { estudianteId: r.insertId, adminId, tipo: 'INICIAL', valor: saldoInicial, observacion: 'Saldo inicial asignado' });
  }
  return r.insertId;
}

router.post('/personas', asyncH(async (req, res) => {
  const id = await transaccion(async (conn) => {
    const nuevoId = await crearPersona(conn, req.body, req.usuario.id);
    await auditar(conn, req.usuario.id, 'CREAR_PERSONA', 'estudiantes', nuevoId, { nombre: req.body.nombre_completo });
    return nuevoId;
  });
  res.status(201).json({ id });
}));

// Importación masiva desde CSV/Excel (las filas llegan ya leídas por el navegador)
// Lee un archivo de Excel (.xlsx) enviado en base64 y devuelve sus filas como texto.
// La importación en sí la hace /personas/importar, igual que con CSV.
const textoCelda = (v) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return textoCelda(v.result);
    if ('text' in v) return String(v.text);
    return '';
  }
  return String(v);
};
router.post('/personas/leer-excel', asyncH(async (req, res) => {
  const b64 = String(req.body.archivo || '').replace(/^data:[^,]*,/, '');
  if (!b64) throw new ErrorApp(400, 'No se recibió el archivo.');
  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(Buffer.from(b64, 'base64'));
  } catch {
    throw new ErrorApp(400, 'No se pudo leer el archivo. Use formato Excel .xlsx (los .xls antiguos deben guardarse como .xlsx o CSV).');
  }
  const hoja = libro.worksheets.find((h) => h.actualRowCount > 0);
  if (!hoja) throw new ErrorApp(400, 'El archivo de Excel está vacío.');
  const filas = [];
  hoja.eachRow({ includeEmpty: false }, (row) => {
    const celdas = [];
    for (let c = 1; c <= row.cellCount; c++) celdas.push(textoCelda(row.getCell(c).value).trim());
    if (celdas.some(Boolean)) filas.push(celdas);
  });
  res.json({ hoja: hoja.name, filas: filas.slice(0, 5001) });
}));

router.get('/plantilla-personas.xlsx', asyncH(async (req, res) => {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Personas');
  hoja.columns = [
    { header: 'nombre', width: 32 }, { header: 'tipo', width: 16 }, { header: 'curso', width: 10 },
    { header: 'identificacion', width: 18 }, { header: 'saldo', width: 12 },
  ];
  hoja.addRow(['Juan Pérez', 'ESTUDIANTE', '10A', '1001', 25000]);
  hoja.addRow(['Marta Herrera', 'DOCENTE', '', 'CC52000111', 40000]);
  hoja.getRow(1).font = { bold: true };
  hoja.getColumn(4).numFmt = '@';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla-personas.xlsx"');
  await libro.xlsx.write(res);
  res.end();
}));

router.post('/personas/importar', asyncH(async (req, res) => {
  const filas = Array.isArray(req.body.filas) ? req.body.filas.slice(0, 5000) : [];
  if (!filas.length) throw new ErrorApp(400, 'El archivo no tiene filas para importar.');
  const resultado = { creadas: 0, errores: [] };
  for (let i = 0; i < filas.length; i++) {
    try {
      await transaccion((conn) => crearPersona(conn, filas[i], req.usuario.id, true));
      resultado.creadas++;
    } catch (err) {
      resultado.errores.push({ fila: i + 2, error: err.status ? err.message : 'Error inesperado' });
    }
  }
  await auditar(null, req.usuario.id, 'IMPORTAR_PERSONAS', 'estudiantes', null, { creadas: resultado.creadas, errores: resultado.errores.length });
  res.json(resultado);
}));

router.put('/personas/:id', asyncH(async (req, res) => {
  const id = idParam(req);
  const d = datosPersona(req.body);
  await transaccion(async (conn) => {
    const curso = await cursoId(conn, d.curso);
    try {
      const [r] = await conn.query(
        'UPDATE estudiantes SET tipo = ?, nombre_completo = ?, curso_id = ?, identificacion = ?, actualizado_en = ? WHERE id = ?',
        [d.tipo, d.nombre_completo, curso, d.identificacion, ahora(), id]);
      if (!r.affectedRows) throw new ErrorApp(404, 'La persona no existe.');
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw new ErrorApp(409, `Ya existe otra persona con la identificación ${d.identificacion}.`);
      throw err;
    }
    await auditar(conn, req.usuario.id, 'EDITAR_PERSONA', 'estudiantes', id, d);
  });
  res.json({ ok: true });
}));

router.put('/personas/:id/estado', asyncH(async (req, res) => {
  const id = idParam(req);
  const estado = req.body.estado === 'BLOQUEADA' ? 'BLOQUEADA' : 'ACTIVA';
  const r = await query('UPDATE estudiantes SET estado = ?, actualizado_en = ? WHERE id = ?', [estado, ahora(), id]);
  if (!r.affectedRows) throw new ErrorApp(404, 'La persona no existe.');
  await auditar(null, req.usuario.id, estado === 'BLOQUEADA' ? 'BLOQUEAR_CUENTA' : 'ACTIVAR_CUENTA', 'estudiantes', id, texto(req.body.motivo));
  res.json({ ok: true, estado });
}));

// Recarga (suma) o ajuste (suma o resta) de saldo
router.post('/personas/:id/saldo', asyncH(async (req, res) => {
  const id = idParam(req);
  const tipo = req.body.tipo === 'AJUSTE' ? 'AJUSTE' : 'RECARGA';
  const valor = aEntero(req.body.valor);
  const r = await transaccion((conn) => saldos.moverSaldo(conn, {
    estudianteId: id, adminId: req.usuario.id, tipo, valor, dia: req.body.dia, observacion: texto(req.body.observacion),
  }));
  res.json(r);
}));

// Genera un QR nuevo (el anterior deja de funcionar), por ejemplo si se perdió la tarjeta
router.post('/personas/:id/regenerar-qr', asyncH(async (req, res) => {
  const id = idParam(req);
  const r = await query('UPDATE estudiantes SET qr_token = ?, actualizado_en = ? WHERE id = ?', [nuevoTokenQR(), ahora(), id]);
  if (!r.affectedRows) throw new ErrorApp(404, 'La persona no existe.');
  await auditar(null, req.usuario.id, 'REGENERAR_QR', 'estudiantes', id, 'El QR anterior quedó inválido');
  res.json({ ok: true });
}));

// =====================================================================
// Códigos QR
// El QR lleva: FERIAQR:<identificador secreto>|<nombre>|<curso o rol>
// Nunca el saldo. Solo el identificador sirve para cobrar; nombre y curso son informativos.
// =====================================================================
const rolTexto = (tipo) => (TIPOS.includes(tipo) ? tipo.charAt(0) + tipo.slice(1).toLowerCase() : '');
const cursoORol = (p) => (p.curso ? p.curso : rolTexto(p.tipo));
const limpiarQR = (s) => String(s || '').replace(/[|\r\n]/g, ' ').trim();
const contenidoQR = (p) => `FERIAQR:${p.qr_token}|${limpiarQR(p.nombre_completo)}|${limpiarQR(cursoORol(p))}`;
const nombreArchivo = (p) => `${cursoORol(p) ? cursoORol(p) + ' - ' : ''}${p.nombre_completo}`.replace(/[\\/:*?"<>|]/g, '').slice(0, 90);
const opcionesPNG = { errorCorrectionLevel: 'M', margin: 2, width: 600 };

/** Personas para QR según filtros (ids, curso, tipo). */
async function personasQR(qs) {
  const cond = [];
  const p = [];
  if (qs.ids) {
    const ids = String(qs.ids).split(',').map((x) => parseInt(x, 10)).filter((x) => x > 0).slice(0, 5000);
    if (!ids.length) return [];
    cond.push(`e.id IN (${ids.map(() => '?').join(',')})`); p.push(...ids);
  }
  if (qs.curso_id) { cond.push('e.curso_id = ?'); p.push(parseInt(qs.curso_id, 10)); }
  if (TIPOS.includes(qs.tipo)) { cond.push('e.tipo = ?'); p.push(qs.tipo); }
  return query(
    `SELECT e.id, e.nombre_completo, e.tipo, e.qr_token, c.nombre AS curso FROM estudiantes e LEFT JOIN cursos c ON c.id = e.curso_id
     ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY c.nombre IS NULL, c.nombre, e.tipo, e.nombre_completo`, p);
}

router.get('/personas/:id/qr.png', asyncH(async (req, res) => {
  const [p] = await personasQR({ ids: String(idParam(req)) });
  if (!p) throw new ErrorApp(404, 'La persona no existe.');
  const png = await QRCode.toBuffer(contenidoQR(p), opcionesPNG);
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'private, no-store');
  if (req.query.descargar) res.attachment(`QR ${nombreArchivo(p)}.png`);
  res.send(png);
}));

// Datos para la hoja de impresión (tarjetas con nombre, curso y QR)
router.get('/qr/tarjetas', asyncH(async (req, res) => {
  const filas = await personasQR(req.query);
  const cfg = await obtenerConfig();
  const tarjetas = await Promise.all(filas.map(async (f) => ({
    id: f.id,
    nombre: f.nombre_completo,
    tipo: f.tipo,
    curso: f.curso,
    rol: rolTexto(f.tipo),
    codigo: f.qr_token.match(/.{4}/g).join(' '),
    qr: await QRCode.toString(contenidoQR(f), { type: 'svg', errorCorrectionLevel: 'M', margin: 1 }),
  })));
  res.set('Cache-Control', 'private, no-store');
  res.json({ feria: cfg.nombre_feria, tarjetas });
}));

// PDF con todos los QR: 12 por página (4 filas × 3 columnas), tamaño carta, listo para recortar
router.get('/qr/pdf', asyncH(async (req, res) => {
  const filas = await personasQR(req.query);
  if (!filas.length) throw new ErrorApp(404, 'No hay personas para generar el PDF.');
  const cfg = await obtenerConfig();
  const doc = new PDFDocument({ size: 'LETTER', margin: 0, info: { Title: `Códigos QR · ${cfg.nombre_feria}`, Author: 'Feria QR' } });
  res.attachment(`codigos-qr-${hoy()}.pdf`);
  res.type('application/pdf');
  doc.pipe(res);
  const COLS = 3; const FILAS = 4; const M = 28;
  const anchoCelda = (doc.page.width - 2 * M) / COLS;
  const altoCelda = (doc.page.height - 2 * M - 14) / FILAS;
  const lado = Math.min(anchoCelda - 40, altoCelda - 62);
  for (let i = 0; i < filas.length; i++) {
    const f = filas[i];
    const pos = i % (COLS * FILAS);
    if (i > 0 && pos === 0) doc.addPage();
    if (pos === 0) {
      const pagina = Math.floor(i / (COLS * FILAS)) + 1;
      const total = Math.ceil(filas.length / (COLS * FILAS));
      doc.font('Helvetica').fontSize(7).fillColor('#777')
        .text(`${cfg.nombre_feria} · Códigos QR · Página ${pagina} de ${total}`, M, doc.page.height - M + 6, { width: doc.page.width - 2 * M, align: 'center', lineBreak: false });
    }
    const x = M + (pos % COLS) * anchoCelda;
    const y = M + Math.floor(pos / COLS) * altoCelda;
    doc.save().lineWidth(0.6).dash(3, { space: 3 }).strokeColor('#9aa4b2')
      .roundedRect(x + 4, y + 4, anchoCelda - 8, altoCelda - 8, 8).stroke().undash().restore();
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#1f6feb')
      .text(cfg.nombre_feria.toUpperCase(), x + 8, y + 10, { width: anchoCelda - 16, align: 'center', lineBreak: false, ellipsis: true });
    const png = await QRCode.toBuffer(contenidoQR(f), { errorCorrectionLevel: 'M', margin: 0, width: 400 });
    doc.image(png, x + (anchoCelda - lado) / 2, y + 21, { width: lado, height: lado });
    let ty = y + 25 + lado;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#111')
      .text(f.nombre_completo, x + 8, ty, { width: anchoCelda - 16, align: 'center', height: 24, ellipsis: true });
    ty = Math.max(doc.y, ty + 12);
    doc.font('Helvetica').fontSize(8.5).fillColor('#333')
      .text(f.curso ? `Curso ${f.curso}` : rolTexto(f.tipo), x + 8, ty, { width: anchoCelda - 16, align: 'center', lineBreak: false });
    doc.font('Courier').fontSize(6).fillColor('#666')
      .text(f.qr_token.match(/.{4}/g).join(' '), x + 8, ty + 11, { width: anchoCelda - 16, align: 'center', lineBreak: false });
  }
  doc.end();
}));

// Descargar todos los QR (o los de un curso) en un archivo ZIP de imágenes PNG
router.get('/qr/zip', asyncH(async (req, res) => {
  const filas = await personasQR(req.query);
  res.attachment(`codigos-qr-${hoy()}.zip`);
  const zip = archiver('zip', { zlib: { level: 6 } });
  zip.on('error', (e) => res.destroy(e));
  zip.pipe(res);
  const usados = new Set();
  for (const f of filas) {
    let nombre = nombreArchivo(f);
    if (usados.has(nombre)) nombre += ` (${f.id})`;
    usados.add(nombre);
    zip.append(await QRCode.toBuffer(contenidoQR(f), opcionesPNG), { name: `${cursoORol(f) || 'Otros'}/${nombre}.png` });
  }
  await zip.finalize();
}));

// =====================================================================
// Emprendimientos, sus responsables (personas registradas) y su usuario vendedor
// =====================================================================
router.get('/emprendimientos', asyncH(async (req, res) => {
  const lista = await query(
    `SELECT em.id, em.nombre, em.responsables, em.curso_id, c.nombre AS curso, em.rol, em.categoria, em.productos, em.activo,
       u.id AS usuario_id, u.usuario, u.activo AS usuario_activo, u.ultimo_acceso,
       (SELECT COUNT(*) FROM transacciones t WHERE t.emprendimiento_id = em.id AND t.estado = 'CONFIRMADA') AS ventas,
       (SELECT COALESCE(SUM(valor),0) FROM transacciones t WHERE t.emprendimiento_id = em.id AND t.estado = 'CONFIRMADA') AS total
     FROM emprendimientos em LEFT JOIN cursos c ON c.id = em.curso_id
     LEFT JOIN usuarios u ON u.id = (SELECT MIN(id) FROM usuarios WHERE emprendimiento_id = em.id AND rol = 'VENDEDOR')
     ORDER BY em.nombre`);
  const resp = await query(
    `SELECT r.emprendimiento_id, e.id, e.nombre_completo, e.tipo, c.nombre AS curso
     FROM emprendimiento_responsables r JOIN estudiantes e ON e.id = r.estudiante_id LEFT JOIN cursos c ON c.id = e.curso_id
     ORDER BY e.nombre_completo`);
  for (const em of lista) em.responsables_lista = resp.filter((r) => r.emprendimiento_id === em.id);
  res.json(lista);
}));

function datosEmprendimiento(body) {
  const ids = [...new Set((Array.isArray(body.responsables_ids) ? body.responsables_ids : String(body.responsables_ids || '').split(','))
    .map((x) => parseInt(x, 10)).filter((x) => x > 0))].slice(0, 30);
  const d = {
    nombre: texto(body.nombre, 120),
    responsables_ids: ids,
    curso: body.curso_id || null,
    rol: TIPOS.includes(body.rol) ? body.rol : null,
    categoria: texto(body.categoria, 80) || null,
    productos: texto(body.productos, 500) || null,
    activo: body.activo === false || body.activo === '0' || body.activo === 0 ? 0 : 1,
  };
  if (d.nombre.length < 2) throw new ErrorApp(400, 'Escriba el nombre del emprendimiento.');
  if (!ids.length) throw new ErrorApp(400, 'Seleccione al menos un responsable entre las personas registradas.');
  if (d.curso) d.rol = null;
  return d;
}

/** Guarda los responsables y devuelve sus nombres (copia de texto para reportes). */
async function guardarResponsables(conn, emprendimientoId, ids) {
  const [personas] = await conn.query(`SELECT id, nombre_completo FROM estudiantes WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  if (personas.length !== ids.length) throw new ErrorApp(400, 'Alguno de los responsables seleccionados no existe.');
  await conn.query('DELETE FROM emprendimiento_responsables WHERE emprendimiento_id = ?', [emprendimientoId]);
  await conn.query('INSERT INTO emprendimiento_responsables (emprendimiento_id, estudiante_id) VALUES ?', [ids.map((id) => [emprendimientoId, id])]);
  const nombres = personas.map((p) => p.nombre_completo).join(', ').slice(0, 500);
  await conn.query('UPDATE emprendimientos SET responsables = ? WHERE id = ?', [nombres, emprendimientoId]);
  return nombres;
}

function datosUsuario(body, requierePassword) {
  const usuario = texto(body.usuario, 60).toLowerCase();
  if (!/^[a-z0-9._-]{3,60}$/.test(usuario)) throw new ErrorApp(400, 'El usuario debe tener al menos 3 caracteres: letras, números, punto o guion, sin espacios.');
  const password = body.password ? String(body.password) : '';
  if (requierePassword && password.length < 4) throw new ErrorApp(400, 'La contraseña del vendedor debe tener al menos 4 caracteres.');
  if (password && password.length < 4) throw new ErrorApp(400, 'La contraseña del vendedor debe tener al menos 4 caracteres.');
  return { usuario, password };
}
const errorDuplicado = (err) => {
  if (err.code === 'ER_DUP_ENTRY') {
    if (/usuario/.test(err.message)) return new ErrorApp(409, 'Ese nombre de usuario ya está en uso. Elija otro.');
    return new ErrorApp(409, 'Ya existe un emprendimiento con ese nombre.');
  }
  return err;
};

router.post('/emprendimientos', asyncH(async (req, res) => {
  const d = datosEmprendimiento(req.body);
  const u = datosUsuario(req.body, true);
  const id = await transaccion(async (conn) => {
    try {
      const curso = await cursoId(conn, d.curso);
      const fecha = ahora();
      const [r] = await conn.query(
        'INSERT INTO emprendimientos (nombre, responsables, curso_id, rol, categoria, productos, activo, creado_en) VALUES (?,?,?,?,?,?,?,?)',
        [d.nombre, '', curso, d.rol, d.categoria, d.productos, d.activo, fecha]);
      await guardarResponsables(conn, r.insertId, d.responsables_ids);
      await conn.query(
        `INSERT INTO usuarios (usuario, password_hash, nombre, rol, emprendimiento_id, creado_en) VALUES (?,?,?, 'VENDEDOR', ?, ?)`,
        [u.usuario, await bcrypt.hash(u.password, 10), `Vendedor ${d.nombre}`.slice(0, 120), r.insertId, fecha]);
      await auditar(conn, req.usuario.id, 'CREAR_EMPRENDIMIENTO', 'emprendimientos', r.insertId, { nombre: d.nombre, usuario: u.usuario });
      return r.insertId;
    } catch (err) { throw errorDuplicado(err); }
  });
  res.status(201).json({ id });
}));

router.put('/emprendimientos/:id', asyncH(async (req, res) => {
  const id = idParam(req);
  const d = datosEmprendimiento(req.body);
  const u = datosUsuario(req.body, false);
  await transaccion(async (conn) => {
    try {
      const curso = await cursoId(conn, d.curso);
      const [r] = await conn.query(
        'UPDATE emprendimientos SET nombre = ?, curso_id = ?, rol = ?, categoria = ?, productos = ?, activo = ? WHERE id = ?',
        [d.nombre, curso, d.rol, d.categoria, d.productos, d.activo, id]);
      if (!r.affectedRows) throw new ErrorApp(404, 'El emprendimiento no existe.');
      await guardarResponsables(conn, id, d.responsables_ids);
      const [[vend]] = await conn.query(`SELECT id FROM usuarios WHERE emprendimiento_id = ? AND rol = 'VENDEDOR' ORDER BY id LIMIT 1`, [id]);
      if (vend) {
        await conn.query('UPDATE usuarios SET usuario = ?, nombre = ?, activo = ? WHERE id = ?', [u.usuario, `Vendedor ${d.nombre}`.slice(0, 120), d.activo, vend.id]);
        if (u.password) await conn.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [await bcrypt.hash(u.password, 10), vend.id]);
      } else {
        if (!u.password) throw new ErrorApp(400, 'Asigne una contraseña al vendedor.');
        await conn.query(
          `INSERT INTO usuarios (usuario, password_hash, nombre, rol, emprendimiento_id, creado_en) VALUES (?,?,?, 'VENDEDOR', ?, ?)`,
          [u.usuario, await bcrypt.hash(u.password, 10), `Vendedor ${d.nombre}`.slice(0, 120), id, ahora()]);
      }
      await auditar(conn, req.usuario.id, 'EDITAR_EMPRENDIMIENTO', 'emprendimientos', id, { ...d, usuario: u.usuario, cambio_password: !!u.password });
    } catch (err) { throw errorDuplicado(err); }
  });
  res.json({ ok: true });
}));

// =====================================================================
// Transacciones
// =====================================================================
function filtrosTransacciones(qs) {
  const cond = [];
  const p = [];
  const entero = (v) => parseInt(v, 10);
  if (qs.estudiante_id) { cond.push('t.estudiante_id = ?'); p.push(entero(qs.estudiante_id)); }
  if (qs.emprendimiento_id) { cond.push('t.emprendimiento_id = ?'); p.push(entero(qs.emprendimiento_id)); }
  if (qs.curso_id) { cond.push('e.curso_id = ?'); p.push(entero(qs.curso_id)); }
  if (TIPOS.includes(qs.tipo)) { cond.push('e.tipo = ?'); p.push(qs.tipo); }
  if (['CONFIRMADA', 'ANULADA'].includes(qs.estado)) { cond.push('t.estado = ?'); p.push(qs.estado); }
  if (fechaValida(qs.desde)) { cond.push('t.fecha_hora >= ?'); p.push(qs.desde + ' 00:00:00'); }
  if (fechaValida(qs.hasta)) { cond.push('t.fecha_hora < ? + INTERVAL 1 DAY'); p.push(qs.hasta + ' 00:00:00'); }
  if (qs.q) { cond.push('(e.nombre_completo LIKE ? OR e.identificacion LIKE ?)'); p.push(`%${texto(qs.q, 80)}%`, `%${texto(qs.q, 80)}%`); }
  return { where: cond.length ? 'WHERE ' + cond.join(' AND ') : '', params: p };
}

const SQL_TRANSACCIONES = `
  SELECT t.id, t.fecha_hora, e.id AS estudiante_id, e.nombre_completo AS estudiante, e.identificacion, e.tipo AS rol, c.nombre AS curso,
    em.nombre AS emprendimiento, u.nombre AS vendedor, u.usuario AS usuario_vendedor, t.valor, t.saldo_anterior, t.saldo_posterior,
    t.estado, t.anulada_en, ua.nombre AS anulada_por, t.motivo_anulacion, t.codigo_operacion
  FROM transacciones t
  JOIN estudiantes e ON e.id = t.estudiante_id
  LEFT JOIN cursos c ON c.id = e.curso_id
  JOIN emprendimientos em ON em.id = t.emprendimiento_id
  JOIN usuarios u ON u.id = t.vendedor_id
  LEFT JOIN usuarios ua ON ua.id = t.anulada_por`;

router.get('/transacciones', asyncH(async (req, res) => {
  const f = filtrosTransacciones(req.query);
  const filas = await query(`${SQL_TRANSACCIONES} ${f.where} ORDER BY t.fecha_hora DESC, t.id DESC LIMIT 3000`, f.params);
  const [tot] = await query(
    `SELECT COUNT(*) AS cantidad, COALESCE(SUM(CASE WHEN t.estado='CONFIRMADA' THEN t.valor END),0) AS total
     FROM transacciones t JOIN estudiantes e ON e.id = t.estudiante_id ${f.where}`, f.params);
  res.json({ transacciones: filas, resumen: tot });
}));

router.post('/transacciones/:id/anular', asyncH(async (req, res) => {
  res.json(await saldos.anularCompra(idParam(req), req.usuario.id, texto(req.body.motivo)));
}));

router.get('/recargas', asyncH(async (req, res) => {
  res.json(await query(
    `SELECT r.id, r.fecha_hora, r.tipo, r.dia, r.valor, r.valor_dia1, r.valor_dia2, r.saldo_anterior, r.saldo_nuevo, r.observacion,
       e.nombre_completo AS persona, c.nombre AS curso, u.nombre AS administrador
     FROM recargas r JOIN estudiantes e ON e.id = r.estudiante_id LEFT JOIN cursos c ON c.id = e.curso_id
     JOIN usuarios u ON u.id = r.admin_id ORDER BY r.id DESC LIMIT 3000`));
}));

router.get('/auditoria', asyncH(async (req, res) => {
  res.json(await query(
    `SELECT a.id, a.fecha_hora, a.accion, a.entidad, a.entidad_id, a.detalle, u.nombre AS usuario
     FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id ORDER BY a.id DESC LIMIT 1000`));
}));

// =====================================================================
// Configuración y administradores
// =====================================================================
router.get('/config', asyncH(async (req, res) => res.json({ ...(await obtenerConfig()), hoy: hoy() })));

router.put('/config', asyncH(async (req, res) => {
  let valores;
  try { valores = normalizar(req.body); } catch (e) { throw new ErrorApp(400, e.message); }
  const actual = await obtenerConfig();
  const d1 = valores.fecha_dia1 ?? actual.fecha_dia1;
  const d2 = valores.fecha_dia2 ?? actual.fecha_dia2;
  if (d1 && d2 && d2 <= d1) throw new ErrorApp(400, 'La fecha del día 2 debe ser posterior a la del día 1.');
  await transaccion(async (conn) => {
    for (const [clave, valor] of Object.entries(valores)) {
      await conn.query('INSERT INTO configuracion (clave, valor) VALUES (?,?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)', [clave, valor]);
    }
    await auditar(conn, req.usuario.id, 'CAMBIAR_CONFIGURACION', 'configuracion', null, valores);
  });
  res.json(await obtenerConfig());
}));

router.get('/administradores', asyncH(async (req, res) => {
  res.json(await query(`SELECT id, usuario, nombre, activo, ultimo_acceso, creado_en FROM usuarios WHERE rol = 'ADMIN' ORDER BY nombre`));
}));

router.post('/administradores', asyncH(async (req, res) => {
  const u = datosUsuario(req.body, true);
  const nombre = texto(req.body.nombre, 120);
  if (nombre.length < 3) throw new ErrorApp(400, 'Escriba el nombre del administrador.');
  if (u.password.length < 6) throw new ErrorApp(400, 'La contraseña del administrador debe tener al menos 6 caracteres.');
  try {
    const r = await query(`INSERT INTO usuarios (usuario, password_hash, nombre, rol, creado_en) VALUES (?,?,?, 'ADMIN', ?)`,
      [u.usuario, await bcrypt.hash(u.password, 10), nombre, ahora()]);
    await auditar(null, req.usuario.id, 'CREAR_ADMIN', 'usuarios', r.insertId, { usuario: u.usuario });
    res.status(201).json({ id: r.insertId });
  } catch (err) { throw errorDuplicado(err); }
}));

router.put('/administradores/:id', asyncH(async (req, res) => {
  const id = idParam(req);
  if (id === req.usuario.id && req.body.activo === false) throw new ErrorApp(400, 'No puede desactivar su propio usuario.');
  if (typeof req.body.activo === 'boolean') await query(`UPDATE usuarios SET activo = ? WHERE id = ? AND rol = 'ADMIN'`, [req.body.activo ? 1 : 0, id]);
  if (req.body.password) {
    if (String(req.body.password).length < 6) throw new ErrorApp(400, 'La contraseña debe tener al menos 6 caracteres.');
    await query(`UPDATE usuarios SET password_hash = ? WHERE id = ? AND rol = 'ADMIN'`, [await bcrypt.hash(String(req.body.password), 10), id]);
  }
  await auditar(null, req.usuario.id, 'EDITAR_ADMIN', 'usuarios', id, { activo: req.body.activo, cambio_password: !!req.body.password });
  res.json({ ok: true });
}));

module.exports = router;
