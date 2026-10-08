'use strict';
/**
 * Carga datos de ejemplo para probar el sistema (cursos, personas y emprendimientos).
 * No ejecutar en la base de datos real de la feria.
 */
const bcrypt = require('bcryptjs');
const { pool, transaccion } = require('../src/db');
const { ahora, nuevoTokenQR } = require('../src/utils');
const saldos = require('../src/services/saldos');

const NOMBRES = ['Juan', 'María', 'Santiago', 'Valentina', 'Samuel', 'Isabella', 'Matías', 'Sofía', 'Nicolás', 'Mariana',
  'Tomás', 'Gabriela', 'Emiliano', 'Luciana', 'Sebastián', 'Salomé', 'Daniel', 'Antonella', 'Martín', 'Sara'];
const APELLIDOS = ['Pérez', 'Gómez', 'Rodríguez', 'López', 'Martínez', 'García', 'Hernández', 'Torres', 'Ramírez', 'Castro',
  'Vargas', 'Moreno', 'Rojas', 'Díaz', 'Ortiz', 'Suárez'];
const CURSOS = ['6A', '7A', '8A', '9A', '10A', '10B', '11A', '11B'];
const EMPRENDIMIENTOS = [
  ['Dulces 10A', 'Laura Gómez, Andrés Ruiz', '10A', 'Dulces', 'Brownies, galletas, cupcakes', 'dulces10a'],
  ['Comidas 11B', 'Camilo Rojas, Sara Díaz', '11B', 'Comidas', 'Empanadas, arepas, perros calientes', 'comidas11b'],
  ['Jugos Naturales 9A', 'Felipe Castro, Ana Ortiz', '9A', 'Bebidas', 'Jugos, limonadas, malteadas', 'jugos9a'],
  ['Artesanías 8A', 'Paula Vargas', '8A', 'Artesanías', 'Manillas, llaveros, separadores', 'artesanias8a'],
  ['Juegos 7A', 'Mateo Suárez, Lucía Moreno', '7A', 'Entretenimiento', 'Tiro al blanco, lotería', 'juegos7a'],
];

(async () => {
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM estudiantes');
  if (n > 0) { console.log('ℹ Ya hay personas registradas; no se cargaron datos de ejemplo.'); return pool.end(); }
  const [[admin]] = await pool.query("SELECT id FROM usuarios WHERE rol='ADMIN' ORDER BY id LIMIT 1");
  if (!admin) throw new Error('Primero ejecute "npm run db:init".');
  const fecha = ahora();
  const cursoId = {};
  for (const c of CURSOS) {
    await pool.query('INSERT IGNORE INTO cursos (nombre, creado_en) VALUES (?,?)', [c, fecha]);
    const [[r]] = await pool.query('SELECT id FROM cursos WHERE nombre = ?', [c]);
    cursoId[c] = r.id;
  }
  let k = 0;
  const persona = async (tipo, nombre, curso, saldo) => transaccion(async (conn) => {
    k++;
    const [r] = await conn.query(
      `INSERT INTO estudiantes (tipo, nombre_completo, curso_id, identificacion, saldo_inicial, saldo, qr_token, creado_en, actualizado_en)
       VALUES (?,?,?,?,?,0,?,?,?)`, [tipo, nombre, curso ? cursoId[curso] : null, String(1000 + k), saldo, nuevoTokenQR(), fecha, fecha]);
    await saldos.moverSaldo(conn, { estudianteId: r.insertId, adminId: admin.id, tipo: 'INICIAL', valor: saldo, dia: 'AMBOS', observacion: 'Saldo inicial asignado' });
  });
  await persona('ESTUDIANTE', 'Juan Pérez', '10A', 25000);
  for (const c of CURSOS) {
    for (let i = 0; i < 5; i++) {
      const nom = `${NOMBRES[(k * 7 + i) % NOMBRES.length]} ${APELLIDOS[(k * 3 + i) % APELLIDOS.length]} ${APELLIDOS[(k + i * 5) % APELLIDOS.length]}`;
      await persona('ESTUDIANTE', nom, c, [20000, 25000, 30000][k % 3]);
    }
  }
  await persona('DOCENTE', 'Marta Lucía Herrera', null, 40000);
  await persona('DOCENTE', 'Carlos Andrés Mejía', null, 40000);
  for (const [nombre, , curso, cat, prod, usuario] of EMPRENDIMIENTOS) {
    const [alumnos] = await pool.query('SELECT id, nombre_completo FROM estudiantes WHERE curso_id = ? ORDER BY id LIMIT 2', [cursoId[curso]]);
    const [r] = await pool.query(
      'INSERT INTO emprendimientos (nombre, responsables, curso_id, categoria, productos, creado_en) VALUES (?,?,?,?,?,?)',
      [nombre, alumnos.map((a) => a.nombre_completo).join(', '), cursoId[curso], cat, prod, fecha]);
    for (const a of alumnos) await pool.query('INSERT INTO emprendimiento_responsables VALUES (?,?)', [r.insertId, a.id]);
    await pool.query(
      "INSERT INTO usuarios (usuario, password_hash, nombre, rol, emprendimiento_id, creado_en) VALUES (?,?,?,'VENDEDOR',?,?)",
      [usuario, await bcrypt.hash('1234', 10), `Vendedor ${nombre}`, r.insertId, fecha]);
  }
  console.log(`✔ Datos de ejemplo cargados: ${k} personas, ${CURSOS.length} cursos, ${EMPRENDIMIENTOS.length} emprendimientos.`);
  console.log('  Vendedores de ejemplo (contraseña 1234):', EMPRENDIMIENTOS.map((e) => e[5]).join(', '));
  await pool.end();
})().catch(async (e) => { console.error('✖', e.message); await pool.end(); process.exit(1); });
