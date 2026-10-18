'use strict';
/** Cursos del colegio: lista predeterminada, comparación tolerante y orden natural. */

// Jardín a 11; solo 8.° y 11.° tienen dos grupos.
const CURSOS_COLEGIO = ['JARDÍN', 'TRANSICIÓN', '1°', '2°', '3°', '4°', '5°', '6°', '7°', '8A', '8B', '9°', '10°', '11A', '11B'];

/** "9", "9°", "9º", "9 °" → "9";  "8 a", "8-A" → "8A";  "jardin" → "JARDIN" */
function claveCurso(nombre) {
  return String(nombre || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/GRADO|[°º.\s\-_]/g, '');
}

const PREESCOLAR = ['PREJARDIN', 'JARDIN', 'TRANSICION'];
function ordenCurso(nombre) {
  const k = claveCurso(nombre);
  const pre = PREESCOLAR.indexOf(k);
  if (pre >= 0) return [pre, ''];
  const m = k.match(/^(\d+)(.*)$/);
  if (m) return [10 + Number(m[1]), m[2]];
  return [1000, k];
}
function compararCursos(a, b) {
  const [na, la] = ordenCurso(a);
  const [nb, lb] = ordenCurso(b);
  return na - nb || la.localeCompare(lb, 'es');
}

/** Busca un curso por nombre aunque esté escrito distinto ("9" encuentra "9°"). */
async function buscarCurso(conn, nombre) {
  const clave = claveCurso(nombre);
  if (!clave) return null;
  const [filas] = await conn.query('SELECT id, nombre FROM cursos');
  return filas.find((c) => claveCurso(c.nombre) === clave) || null;
}

/** Agrega los cursos del colegio que falten. Devuelve los nombres agregados. */
async function crearCursosColegio(conn, fecha) {
  const agregados = [];
  for (const nombre of CURSOS_COLEGIO) {
    if (await buscarCurso(conn, nombre)) continue;
    await conn.query('INSERT INTO cursos (nombre, creado_en) VALUES (?,?)', [nombre, fecha]);
    agregados.push(nombre);
  }
  return agregados;
}

module.exports = { CURSOS_COLEGIO, claveCurso, compararCursos, buscarCurso, crearCursosColegio };
