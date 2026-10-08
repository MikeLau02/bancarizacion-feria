'use strict';
/**
 * Prueba automática del flujo completo contra una base de datos MySQL de PRUEBA
 * (<DB_NAME>_prueba, que se borra y se crea de nuevo). No toca la base real.
 *   npm test
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const nombreBase = (process.env.DB_NAME || 'feria_qr') + '_prueba';
process.env.DB_NAME = nombreBase;

const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const mysql = require('mysql2/promise');
const config = require('../src/config');

let ok = 0;
const paso = (msg) => { ok++; console.log('  ✔', msg); };

function cliente(base) {
  let cookie = '';
  return async (metodo, url, body) => {
    const res = await fetch(base + url, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const tipo = res.headers.get('content-type') || '';
    const datos = tipo.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, datos, tipo, res };
  };
}

(async () => {
  const { database, ...cx } = config.db;
  const c = await mysql.createConnection(cx);
  await c.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await c.end();
  execFileSync(process.execPath, [require.resolve('./init-db.js')], { env: process.env, stdio: 'ignore' });
  execFileSync(process.execPath, [require.resolve('./seed-demo.js')], { env: process.env, stdio: 'ignore' });

  const app = require('../src/server');
  const { pool, query } = require('../src/db');
  const servidor = app.listen(0);
  const base = `http://127.0.0.1:${servidor.address().port}`;
  console.log(`Base de prueba: ${database}\n`);

  try {
    const admin = cliente(base);
    const vend = cliente(base);
    const vend2 = cliente(base);

    // ---------- autenticación y roles
    assert.equal((await admin('POST', '/api/auth/login', { usuario: 'admin', password: 'mala' })).status, 401);
    assert.equal((await admin('POST', '/api/auth/login', { usuario: config.admin.usuario, password: config.admin.password })).status, 200);
    assert.equal((await vend('POST', '/api/auth/login', { usuario: 'dulces10a', password: '1234' })).status, 200);
    assert.equal((await vend2('POST', '/api/auth/login', { usuario: 'comidas11b', password: '1234' })).status, 200);
    paso('inicio de sesión de administrador y vendedores');
    assert.equal((await vend('GET', '/api/admin/dashboard')).status, 403);
    assert.equal((await vend('GET', '/api/admin/reportes/resumen')).status, 403);
    assert.equal((await admin('POST', '/api/ventas/consultar', { qr: 'x' })).status, 403);
    assert.equal((await cliente(base)('GET', '/api/ventas/mis-ventas')).status, 401);
    const pag = await cliente(base)('GET', '/admin/');
    assert.equal(pag.status, 302);
    paso('cada rol solo accede a sus funciones (vendedor no ve el panel, sin sesión → login)');

    // Para las compras normales: el día 2 ya llegó (todo el saldo se puede gastar)
    const hoy = require('../src/utils').hoy();
    await admin('PUT', '/api/admin/config', { fecha_dia1: '2000-01-01', fecha_dia2: hoy, saldo_bajo: '5.000' });

    // ---------- registro de persona y QR
    const cursos = (await admin('GET', '/api/admin/cursos')).datos;
    const c10a = cursos.find((x) => x.nombre === '10A').id;
    const nueva = await admin('POST', '/api/admin/personas', { tipo: 'ESTUDIANTE', nombre_completo: 'Ana Prueba', curso_id: c10a, identificacion: 'T-1', saldo_inicial: '25.000' });
    assert.equal(nueva.status, 201);
    const dup = await admin('POST', '/api/admin/personas', { tipo: 'ESTUDIANTE', nombre_completo: 'Otra', curso_id: c10a, identificacion: 'T-1', saldo_inicial: 0 });
    assert.equal(dup.status, 409);
    const id = nueva.datos.id;
    const [est] = await query('SELECT qr_token, saldo, saldo_dia1, saldo_dia2 FROM estudiantes WHERE id = ?', [id]);
    assert.deepEqual([est.saldo, est.saldo_dia1, est.saldo_dia2], [25000, 12500, 12500]);
    assert.match(est.qr_token, /^[a-f0-9]{32}$/);
    const [{ n: repetidos }] = await query('SELECT COUNT(*) - COUNT(DISTINCT qr_token) AS n FROM estudiantes');
    assert.equal(repetidos, 0);
    const png = await admin('GET', `/api/admin/personas/${id}/qr.png`);
    assert.equal(png.status, 200);
    assert.equal(png.tipo, 'image/png');
    paso('persona registrada con $25.000 divididos automáticamente: $12.500 día 1 y $12.500 día 2; QR único');
    const qr = `FERIAQR:${est.qr_token}|Ana Prueba|10A`;

    // ---------- consulta del vendedor: datos mínimos
    const cons = await vend('POST', '/api/ventas/consultar', { qr });
    assert.equal(cons.status, 200);
    assert.equal(cons.datos.nombre, 'Ana Prueba');
    assert.equal(cons.datos.curso, '10A');
    assert.equal(cons.datos.saldo, 25000);
    assert.equal(cons.datos.identificacion, undefined);
    paso('el vendedor ve nombre, curso y saldo (sin identificación)');
    const noexiste = await vend('POST', '/api/ventas/consultar', { qr: 'FERIAQR:' + 'a'.repeat(32) });
    assert.equal(noexiste.status, 404);
    assert.equal(noexiste.datos.alerta, 'QR_INEXISTENTE');
    paso('QR inexistente → alerta');

    // ---------- compras del ejemplo: 5.000, 8.000, 12.000
    const comprar = (cli, valor, codigo) => cli('POST', '/api/ventas/compras', { qr, valor, codigo_operacion: codigo || require('crypto').randomUUID() });
    const v1 = await comprar(vend, '5.000', 'op-0000000000000001');
    assert.equal(v1.status, 201);
    assert.deepEqual([v1.datos.saldo_anterior, v1.datos.saldo_posterior], [25000, 20000]);
    const v1b = await comprar(vend, '5.000', 'op-0000000000000001');
    assert.equal(v1b.datos.duplicada, true);
    assert.equal((await query('SELECT saldo FROM estudiantes WHERE id = ?', [id]))[0].saldo, 20000);
    paso('compra $5.000 → $20.000; reenviar la misma operación NO cobra dos veces');
    const v2 = await comprar(vend2, 8000);
    assert.equal(v2.datos.saldo_posterior, 12000);
    const val = await vend('POST', '/api/ventas/validar', { qr, valor: 13000 });
    assert.equal(val.status, 409);
    assert.equal(val.datos.error, 'Saldo insuficiente. Saldo disponible: $12.000.');
    const ins = await comprar(vend, 13000);
    assert.equal(ins.status, 409);
    paso('compra $8.000 → $12.000; compra de $13.000 rechazada con "Saldo insuficiente. Saldo disponible: $12.000."');
    const v3 = await comprar(vend, 12000);
    assert.equal(v3.datos.saldo_posterior, 0);
    assert.equal(v3.datos.agotado, true);
    const ago = await comprar(vend, 100);
    assert.equal(ago.datos.error, 'Saldo agotado. Esta persona no puede realizar más compras.');
    paso('compra $12.000 → $0 y alerta "Saldo agotado..." en el siguiente intento');

    // ---------- historial
    const hist = (await admin('GET', `/api/admin/personas/${id}`)).datos;
    assert.deepEqual(hist.compras.map((t) => [t.emprendimiento, t.valor, t.saldo_posterior]),
      [['Dulces 10A', 5000, 20000], ['Comidas 11B', 8000, 12000], ['Dulces 10A', 12000, 0]]);
    const mis = (await vend('GET', '/api/ventas/mis-ventas')).datos;
    assert.equal(mis.ventas.length, 2);
    assert.ok(mis.ventas.every((v) => v.comprador === 'Ana Prueba'));
    paso('historial del estudiante correcto; el vendedor solo ve las ventas de su emprendimiento');

    // ---------- anulación y recarga
    const tid = hist.compras[2].id;
    assert.equal((await vend('POST', `/api/admin/transacciones/${tid}/anular`, { motivo: 'x' })).status, 403);
    const an = await admin('POST', `/api/admin/transacciones/${tid}/anular`, { motivo: 'Valor mal digitado' });
    assert.equal(an.datos.saldo_nuevo, 12000);
    assert.equal((await admin('POST', `/api/admin/transacciones/${tid}/anular`, { motivo: 'otra vez' })).status, 409);
    paso('anulación solo por administrador: devuelve $12.000 y no se puede anular dos veces');
    const rec = await admin('POST', `/api/admin/personas/${id}/saldo`, { tipo: 'RECARGA', valor: '3.000', dia: 'DIA2', observacion: 'aporte' });
    assert.deepEqual([rec.datos.saldo_anterior, rec.datos.saldo_nuevo, rec.datos.valor_dia2], [12000, 15000, 3000]);
    const neg = await admin('POST', `/api/admin/personas/${id}/saldo`, { tipo: 'AJUSTE', valor: -20000, dia: 'DIA1', observacion: 'prueba' });
    assert.equal(neg.status, 409);
    paso('recarga de $3.000 asignada al día 2 (12.000 → 15.000); ajuste que dejaría saldo negativo rechazado');

    // ---------- bloqueo
    await admin('PUT', `/api/admin/personas/${id}/estado`, { estado: 'BLOQUEADA' });
    const blo = await vend('POST', '/api/ventas/consultar', { qr });
    assert.equal(blo.status, 423);
    assert.equal((await comprar(vend, 1000)).status, 423);
    await admin('PUT', `/api/admin/personas/${id}/estado`, { estado: 'ACTIVA' });
    paso('cuenta bloqueada → no puede comprar; al activarla vuelve a funcionar');

    // ---------- concurrencia: 30 compras simultáneas de $1.000 sobre $15.000
    const simultaneas = await Promise.all(Array.from({ length: 30 }, (_, i) => comprar(i % 2 ? vend : vend2, 1000)));
    const exitosas = simultaneas.filter((r) => r.status === 201).length;
    const [fin] = await query('SELECT saldo FROM estudiantes WHERE id = ?', [id]);
    assert.equal(exitosas, 15);
    assert.equal(fin.saldo, 0);
    paso(`30 compras simultáneas desde 2 vendedores: exactamente 15 aprobadas, saldo final $0, nunca negativo`);

    // ---------- saldo por día
    await admin('PUT', '/api/admin/config', { limite_diario_activo: true, fecha_dia1: hoy, fecha_dia2: '2099-01-01', porcentaje_dia1: 50 });
    const p2 = await admin('POST', '/api/admin/personas', { tipo: 'DOCENTE', nombre_completo: 'Docente Prueba', identificacion: 'T-2', saldo_inicial: 20000 });
    const idDoc = p2.datos.id;
    const [e2] = await query('SELECT qr_token FROM estudiantes WHERE id = ?', [idDoc]);
    const qr2 = e2.qr_token;
    const info2 = (await vend('POST', '/api/ventas/consultar', { qr: qr2 })).datos;
    assert.deepEqual([info2.disponible_hoy, info2.reservado_dia2], [10000, 10000]);
    const d1 = await vend('POST', '/api/ventas/compras', { qr: qr2, valor: 7000, codigo_operacion: 'op-limite-000000001' });
    assert.equal(d1.status, 201);
    const d2 = await vend('POST', '/api/ventas/compras', { qr: qr2, valor: 4000, codigo_operacion: 'op-limite-000000002' });
    assert.equal(d2.status, 409);
    assert.equal(d2.datos.error, 'Saldo insuficiente. Saldo disponible: $3.000. ($10.000 más están reservados para el día 2)');
    const d3 = await vend('POST', '/api/ventas/compras', { qr: qr2, valor: 3000, codigo_operacion: 'op-limite-000000003' });
    assert.equal(d3.status, 201);
    const agoDia = (await vend('POST', '/api/ventas/consultar', { qr: qr2 })).datos;
    assert.equal(agoDia.alerta, 'DIA_AGOTADO');
    paso('día 1: solo se gasta la mitad ($10.000 de $20.000); la otra mitad queda reservada para el día 2');
    const r1 = await admin('POST', `/api/admin/personas/${idDoc}/saldo`, { tipo: 'RECARGA', valor: 4000, dia: 'DIA1' });
    assert.equal(r1.datos.valor_dia1, 4000);
    const r2 = await admin('POST', `/api/admin/personas/${idDoc}/saldo`, { tipo: 'RECARGA', valor: 4000, dia: 'AMBOS' });
    assert.deepEqual([r2.datos.valor_dia1, r2.datos.valor_dia2], [2000, 2000]);
    assert.equal((await vend('POST', '/api/ventas/consultar', { qr: qr2 })).datos.disponible_hoy, 6000);
    paso('recargas desde la segunda: asignada al día 1 ($4.000) o dividida entre los dos días ($2.000 + $2.000)');
    await admin('PUT', '/api/admin/config', { fecha_dia1: '2000-01-01', fecha_dia2: hoy });
    const d4 = await vend('POST', '/api/ventas/compras', { qr: qr2, valor: 18000, codigo_operacion: 'op-limite-000000004' });
    assert.equal(d4.status, 201);
    assert.equal(d4.datos.saldo_posterior, 0);
    const [t4] = await query('SELECT id, valor_dia1, valor_dia2 FROM transacciones WHERE codigo_operacion = ?', ['op-limite-000000004']);
    assert.deepEqual([t4.valor_dia1, t4.valor_dia2], [6000, 12000]);
    await admin('POST', `/api/admin/transacciones/${t4.id}/anular`, { motivo: 'prueba de devolución por día' });
    const [e2b] = await query('SELECT saldo_dia1, saldo_dia2 FROM estudiantes WHERE id = ?', [idDoc]);
    assert.deepEqual([e2b.saldo_dia1, e2b.saldo_dia2], [6000, 12000]);
    paso('día 2: se gasta todo (sobrante del día 1 + día 2); al anular, cada peso vuelve a su día');
    await admin('PUT', '/api/admin/config', { solo_dias_feria: true, fecha_dia1: '2000-01-01', fecha_dia2: '2000-01-02' });
    const p3 = await admin('POST', '/api/admin/personas', { tipo: 'OTRO', nombre_completo: 'Visitante', identificacion: 'T-3', saldo_inicial: 5000 });
    const [e3] = await query('SELECT qr_token FROM estudiantes WHERE id = ?', [p3.datos.id]);
    assert.equal((await vend('POST', '/api/ventas/compras', { qr: e3.qr_token, valor: 1000, codigo_operacion: 'op-fuera-0000000001' })).status, 409);
    await admin('PUT', '/api/admin/config', { solo_dias_feria: false });
    paso('con "solo días de feria" activo, fuera de esas fechas no se puede comprar');

    // ---------- consistencia contable
    const [{ n: descuadres }] = await query('SELECT COUNT(*) AS n FROM estudiantes WHERE saldo <> saldo_dia1 + saldo_dia2');
    assert.equal(descuadres, 0);
    const [[cuadre]] = await pool.query(`SELECT
      (SELECT SUM(valor) FROM recargas) AS cargado,
      (SELECT COALESCE(SUM(valor),0) FROM transacciones WHERE estado='CONFIRMADA') AS vendido,
      (SELECT SUM(saldo) FROM estudiantes) AS pendiente`);
    assert.equal(Number(cuadre.cargado) - Number(cuadre.vendido), Number(cuadre.pendiente));
    paso(`cuadre: cargado ${cuadre.cargado} − vendido ${cuadre.vendido} = pendiente ${cuadre.pendiente}`);

    // ---------- dashboard, reportes y exportación
    const dash = (await admin('GET', '/api/admin/dashboard')).datos;
    assert.equal(dash.indicadores.total_vendido, Number(cuadre.vendido));
    for (const rep of ['resumen', 'estudiantes', 'transacciones', 'emprendimientos', 'ventas-estudiante', 'ventas-curso', 'ventas-rol', 'recargas']) {
      const j = await admin('GET', `/api/admin/reportes/${rep}`);
      assert.equal(j.status, 200, rep);
      const x = await admin('GET', `/api/admin/reportes/${rep}?formato=xlsx`);
      assert.equal(x.status, 200);
      assert.equal(x.datos.subarray(0, 2).toString(), 'PK');
      const csv = await admin('GET', `/api/admin/reportes/${rep}?formato=csv`);
      assert.ok(csv.datos.toString('utf8').startsWith('﻿'));
    }
    const zip = await admin('GET', '/api/admin/qr/zip');
    assert.equal(zip.datos.subarray(0, 2).toString(), 'PK');
    const tarjetas = (await admin('GET', '/api/admin/qr/tarjetas')).datos.tarjetas;
    assert.ok(tarjetas.length > 40 && tarjetas[0].qr.startsWith('<svg'));
    const pdf = await admin('GET', '/api/admin/qr/pdf');
    assert.equal(pdf.datos.subarray(0, 4).toString(), '%PDF');
    const personasTotal = (await query('SELECT COUNT(*) AS n FROM estudiantes'))[0].n;
    const paginas = (pdf.datos.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
    assert.equal(paginas, Math.ceil(personasTotal / 12));
    paso(`dashboard, 8 reportes (pantalla, Excel y CSV), ZIP, impresión y PDF de QR (${personasTotal} QR en ${paginas} páginas de 12)`);

    // ---------- emprendimiento con responsables elegidos entre las personas
    const sinResp = await admin('POST', '/api/admin/emprendimientos', { nombre: 'Tienda Docentes', rol: 'DOCENTE', usuario: 'tiendadoc', password: 'abcd' });
    assert.equal(sinResp.status, 400);
    const emp = await admin('POST', '/api/admin/emprendimientos', { nombre: 'Tienda Docentes', rol: 'DOCENTE', responsables_ids: [idDoc], usuario: 'tiendadoc', password: 'abcd' });
    assert.equal(emp.status, 201);
    const empL = (await admin('GET', '/api/admin/emprendimientos')).datos.find((x) => x.id === emp.datos.id);
    assert.equal(empL.responsables, 'Docente Prueba');
    assert.equal(empL.rol, 'DOCENTE');
    const vend3 = cliente(base);
    assert.equal((await vend3('POST', '/api/auth/login', { usuario: 'tiendadoc', password: 'abcd' })).status, 200);
    await admin('PUT', `/api/admin/emprendimientos/${emp.datos.id}`, { nombre: 'Tienda Docentes', rol: 'DOCENTE', responsables_ids: [idDoc], usuario: 'tiendadoc', password: 'nueva1', activo: true });
    assert.equal((await cliente(base)('POST', '/api/auth/login', { usuario: 'tiendadoc', password: 'nueva1' })).status, 200);
    paso('emprendimiento con responsables elegidos de las personas, rol en vez de curso y contraseña modificable');

    // ---------- consulta del comprador y buscador por rol
    const pub = await cliente(base)('POST', '/api/publico/consulta', { qr: est.qr_token.match(/.{4}/g).join(' ') });
    assert.equal(pub.status, 200);
    assert.equal(pub.datos.nombre, 'Ana Prueba');
    assert.equal(pub.datos.identificacion, undefined);
    assert.ok(pub.datos.compras.length >= 4 && pub.datos.recargas.length === 2);
    assert.equal((await cliente(base)('POST', '/api/publico/consulta', { qr: 'b'.repeat(32) })).status, 404);
    const docentes = (await admin('GET', '/api/admin/buscar?q=docente')).datos;
    assert.ok(docentes.length >= 3 && docentes.every((x) => x.tipo === 'DOCENTE'));
    paso('el comprador consulta su saldo e historial con su código; buscador por rol');

    // ---------- varios administradores registrando a la vez + importación desde Excel
    assert.equal((await admin('POST', '/api/admin/administradores', { nombre: 'Admin Dos', usuario: 'admin2', password: 'clave22' })).status, 201);
    const admin2 = cliente(base);
    assert.equal((await admin2('POST', '/api/auth/login', { usuario: 'admin2', password: 'clave22' })).status, 200);
    const ExcelJS = require('exceljs');
    const libro = new ExcelJS.Workbook();
    const hoja = libro.addWorksheet('Lista');
    hoja.addRow(['Nombre', 'Tipo', 'Curso', 'Identificación', 'Saldo']);
    for (let i = 1; i <= 40; i++) hoja.addRow([`Excel Persona ${i}`, i % 10 ? '' : 'DOCENTE', i % 10 ? '6C' : '', 9000 + i, 20000]);
    hoja.addRow(['Repetida', '', '6C', 9001, 1000]);
    const b64 = (await libro.xlsx.writeBuffer()).toString('base64');
    const leido = await admin2('POST', '/api/admin/personas/leer-excel', { archivo: b64 });
    assert.equal(leido.status, 200);
    assert.equal(leido.datos.filas.length, 42);
    assert.deepEqual(leido.datos.filas[1], ['Excel Persona 1', '', '6C', '9001', '20000']);
    assert.equal((await admin2('POST', '/api/admin/personas/leer-excel', { archivo: Buffer.from('no es excel').toString('base64') })).status, 400);
    const plantilla = await admin('GET', '/api/admin/plantilla-personas.xlsx');
    assert.equal(plantilla.status, 200);
    const aFila = (r) => ({ nombre_completo: r[0], tipo: r[1] || 'ESTUDIANTE', curso: r[2], identificacion: r[3], saldo_inicial: r[4] });
    const filasExcel = leido.datos.filas.slice(1).map(aFila);
    // los dos administradores trabajan al mismo tiempo: uno importa el Excel y el otro registra personas a mano
    const [imp, ...manuales] = await Promise.all([
      admin2('POST', '/api/admin/personas/importar', { filas: filasExcel }),
      ...Array.from({ length: 10 }, (_, i) => admin('POST', '/api/admin/personas', { tipo: 'ESTUDIANTE', nombre_completo: `Manual ${i}`, curso_id: c10a, identificacion: `M-${i}`, saldo_inicial: 10000 })),
    ]);
    assert.equal(imp.datos.creadas, 40);
    assert.equal(imp.datos.errores.length, 1);
    assert.ok(manuales.every((r) => r.status === 201));
    const [p6c] = await query("SELECT COUNT(*) AS n, SUM(saldo_dia1) AS d1, SUM(saldo_dia2) AS d2 FROM estudiantes WHERE identificacion BETWEEN '9001' AND '9040'");
    assert.deepEqual([p6c.n, p6c.d1, p6c.d2], [40, 400000, 400000]);
    paso('dos administradores a la vez: uno importa 40 personas desde Excel (rechaza la repetida) y el otro registra 10 a mano');

    // ---------- inmutabilidad
    await assert.rejects(query("UPDATE estudiantes SET saldo = -1 WHERE id = ?", [id]));
    paso('la base de datos rechaza saldos negativos aunque se modifique directamente');

    console.log(`\n✔ ${ok} pruebas superadas.`);
    setImmediate(() => process.exit(0));
  } finally {
    servidor.close();
    await pool.end();
  }
})().catch((e) => { console.error('\n✖ Falló la prueba:', e.message, '\n', e.stack); process.exit(1); });
