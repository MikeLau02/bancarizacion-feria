/* Panel del administrador (aplicación de una sola página, navegación con #) */
'use strict';

const C = document.getElementById('contenido');
const S = { yo: null, cursos: [], emprendimientos: [], cfg: null, refresco: null };
const TIPOS = { ESTUDIANTE: 'Estudiante', DOCENTE: 'Docente', DIRECTIVO: 'Directivo', ADMINISTRATIVO: 'Administrativo', FAMILIA: 'Familia', OTRO: 'Otro' };
const ACCIONES = {
  ANULAR_COMPRA: 'Anuló una compra', CREAR_PERSONA: 'Registró una persona', EDITAR_PERSONA: 'Editó una persona',
  BLOQUEAR_CUENTA: 'Bloqueó una cuenta', ACTIVAR_CUENTA: 'Activó una cuenta', REGENERAR_QR: 'Generó un QR nuevo',
  IMPORTAR_PERSONAS: 'Importó personas', CREAR_EMPRENDIMIENTO: 'Registró un emprendimiento', EDITAR_EMPRENDIMIENTO: 'Editó un emprendimiento',
  CAMBIAR_CONFIGURACION: 'Cambió la configuración', CREAR_ADMIN: 'Creó un administrador', EDITAR_ADMIN: 'Editó un administrador',
};

// ===================================================================== utilidades de interfaz
const qs = (sel, raiz = document) => raiz.querySelector(sel);
const params = () => new URLSearchParams((location.hash.split('?')[1]) || '');
const opcionesCursos = (sel, vacio = 'Todos los cursos') =>
  `<option value="">${vacio}</option>` + S.cursos.map((c) => `<option value="${c.id}" ${String(sel) === String(c.id) ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('');
const opcionesTipos = (sel) => Object.entries(TIPOS).map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${v}</option>`).join('');
const badgeEstado = (e) => (e === 'ACTIVA' ? '<span class="badge text-bg-success">Activa</span>' : '<span class="badge text-bg-danger"><i class="bi bi-lock-fill"></i> Bloqueada</span>');

function badgeSaldo(saldo) {
  const bajo = S.cfg ? S.cfg.saldo_bajo : 5000;
  if (saldo === 0) return `<span class="badge text-bg-danger" title="Saldo agotado"><i class="bi bi-x-circle"></i> ${pesos(0)}</span>`;
  if (saldo < bajo) return `<span class="badge text-bg-warning" title="Saldo bajo"><i class="bi bi-exclamation-triangle"></i> ${pesos(saldo)}</span>`;
  return `<span class="fw-semibold">${pesos(saldo)}</span>`;
}

function cargando() { C.innerHTML = '<div class="text-center text-secondary py-5"><div class="spinner-border"></div></div>'; }

function errorPantalla(e) {
  C.innerHTML = `<div class="alert alert-danger">${esc(e instanceof ErrorRed ? 'No hay conexión con el servidor.' : e.message)}</div>`;
}

const modalBS = new bootstrap.Modal(document.getElementById('modal'));
/**
 * Abre el modal. botones: [{texto, clase, accion: async (cuerpo) => boolean|void}]
 * Si la acción devuelve false, el modal queda abierto.
 */
function modal({ titulo, cuerpo, botones = [], tamano = '' }) {
  qs('#modalDialogo').className = `modal-dialog modal-dialog-scrollable ${tamano}`;
  qs('#modalTitulo').textContent = titulo;
  qs('#modalCuerpo').innerHTML = cuerpo;
  const pie = qs('#modalPie');
  pie.innerHTML = '';
  pie.classList.toggle('d-none', !botones.length);
  botones.forEach((b) => {
    const btn = document.createElement('button');
    btn.className = `btn ${b.clase || 'btn-secondary'}`;
    btn.innerHTML = b.texto;
    btn.addEventListener('click', async () => {
      if (!b.accion) return modalBS.hide();
      btn.disabled = true;
      try {
        const r = await b.accion(qs('#modalCuerpo'));
        if (r !== false) modalBS.hide();
      } catch (e) {
        mostrarErrorModal(e);
      } finally { btn.disabled = false; }
    });
    pie.appendChild(btn);
  });
  modalBS.show();
  setTimeout(() => { const f = qs('#modalCuerpo input:not([type=hidden]), #modalCuerpo select, #modalCuerpo textarea'); if (f) f.focus(); }, 350);
  return qs('#modalCuerpo');
}
function mostrarErrorModal(e) {
  let el = qs('#modalCuerpo .error-modal');
  if (!el) { el = document.createElement('div'); el.className = 'alert alert-danger error-modal mt-3 mb-0'; qs('#modalCuerpo').appendChild(el); }
  el.textContent = e instanceof ErrorRed ? 'Sin conexión con el servidor. No se guardó nada.' : e.message;
}
const datosForm = (raiz) => Object.fromEntries(new FormData(raiz.querySelector('form')).entries());

async function cargarCatalogos() {
  [S.cursos, S.cfg] = await Promise.all([api('/api/admin/cursos'), api('/api/admin/config')]);
}

// ===================================================================== navegación
const RUTAS = {
  panel: vistaPanel, personas: vistaPersonas, persona: vistaPersona, qr: vistaQR, emprendimientos: vistaEmprendimientos,
  transacciones: vistaTransacciones, reportes: vistaReportes, config: vistaConfig,
};
async function navegar() {
  clearInterval(S.refresco);
  modalBS.hide();
  const [ruta, id] = (location.hash.slice(1).split('?')[0] || 'panel').split('/');
  document.querySelectorAll('#menu .nav-link').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + (ruta === 'persona' ? 'personas' : ruta)));
  const menu = bootstrap.Collapse.getInstance(qs('#menu'));
  if (menu) menu.hide();
  cargando();
  try { await (RUTAS[ruta] || vistaPanel)(id); } catch (e) { errorPantalla(e); }
}
window.addEventListener('hashchange', navegar);

// ===================================================================== PANEL
function tile(icono, etiqueta, valor, color, enlace) {
  return `<div class="col-6 col-md-4 col-xl-3"><a class="text-reset text-decoration-none" ${enlace ? `href="${enlace}"` : ''}>
    <div class="card p-3 tile h-100"><div class="d-flex justify-content-between align-items-start">
    <div><div class="etiqueta">${etiqueta}</div><div class="valor">${valor}</div></div>
    <i class="bi ${icono} icono text-${color}"></i></div></div></a></div>`;
}

function tablaBarras(filas, etiqueta, extra = () => '') {
  const max = Math.max(1, ...filas.map((f) => Number(f.total)));
  if (!filas.length) return '<p class="text-secondary mb-0">Todavía no hay ventas.</p>';
  return `<div class="table-responsive"><table class="table table-sm align-middle mb-0">
    <thead><tr><th>${etiqueta}</th><th class="num">Ventas</th><th class="num">Total</th><th style="width:35%"></th></tr></thead><tbody>
    ${filas.map((f) => `<tr title="${esc(f.nombre || f.curso || f.dia)}: ${pesos(f.total)} en ${f.cantidad} ventas">
      <td>${esc(f.nombre || f.curso || fecha(f.dia + ' 00:00:00'))}${extra(f)}</td><td class="num">${f.cantidad}</td><td class="num fw-semibold">${pesos(f.total)}</td>
      <td><div class="barra-wrap"><div class="barra" style="width:${(Number(f.total) / max) * 100}%"></div></div></td></tr>`).join('')}
    </tbody></table></div>`;
}

async function vistaPanel() {
  const d = await api('/api/admin/dashboard');
  S.cfg = d.config;
  const i = d.indicadores;
  const limite = d.config.limite_diario_activo
    ? `Día 1 (${fecha(d.config.fecha_dia1 + ' 00:00:00')}): se gasta el saldo del día 1 · Día 2 (${fecha(d.config.fecha_dia2 + ' 00:00:00')}): todo el saldo · ${d.dia2_habilitado ? 'Hoy ya se puede gastar todo' : 'Hoy el saldo del día 2 está reservado'}`
    : 'Saldo por día desactivado: se puede gastar todo cualquier día';
  const listaPersonas = (arr, vacio) => (arr.length ? `<div class="list-group list-group-flush">${arr.map((p) => `
      <a href="#persona/${p.id}" class="list-group-item list-group-item-action d-flex justify-content-between">
      <span>${esc(p.nombre_completo)} <small class="text-secondary">${esc(p.curso || '')}</small></span>${badgeSaldo(p.saldo)}</a>`).join('')}</div>`
    : `<p class="text-secondary p-3 mb-0">${vacio}</p>`);
  C.innerHTML = `
    <div class="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
      <div><h1 class="h3 fw-bold mb-0">Panel de la feria</h1><div class="text-secondary small"><i class="bi bi-calendar-check"></i> ${esc(limite)}</div>
        <div class="text-secondary small"><span class="spinner-grow spinner-grow-sm text-success" style="width:.5rem;height:.5rem"></span> En vivo · actualizado ${hora(d.actualizado)}:${d.actualizado.slice(17, 19)}</div></div>
      <div class="d-flex gap-2"><a class="btn btn-primary" href="#personas"><i class="bi bi-person-plus"></i> Registrar persona</a>
      <a class="btn btn-outline-primary" href="/api/admin/reportes/resumen?formato=xlsx"><i class="bi bi-download"></i> Resumen Excel</a></div>
    </div>
    <div class="row g-3 mb-4">
      ${tile('bi-people-fill', 'Personas registradas', i.personas.toLocaleString('es-CO'), 'primary', '#personas')}
      ${tile('bi-wallet2', 'Total de saldo cargado', pesos(i.total_cargado), 'primary')}
      ${tile('bi-cart-check-fill', 'Total vendido', pesos(i.total_vendido), 'success', '#transacciones')}
      ${tile('bi-piggy-bank', 'Saldo pendiente por gastar', pesos(i.saldo_pendiente), 'info')}
      ${tile('bi-1-circle', 'Saldo del día 1 sin gastar', pesos(i.saldo_dia1), 'info')}
      ${tile('bi-2-circle', 'Saldo reservado para el día 2', pesos(i.saldo_dia2), 'info')}
      ${tile('bi-receipt', 'Transacciones', i.transacciones.toLocaleString('es-CO'), 'secondary', '#transacciones')}
      ${tile('bi-x-circle-fill', 'Con saldo agotado', i.agotados, 'danger', '#personas?saldo=agotado')}
      ${tile('bi-exclamation-triangle-fill', `Saldo bajo (menos de ${pesos(d.config.saldo_bajo)})`, i.saldo_bajo, 'warning', '#personas?saldo=bajo')}
      ${tile('bi-lock-fill', 'Cuentas bloqueadas', i.bloqueadas, 'danger', '#personas?estado=BLOQUEADA')}
    </div>
    <div class="row g-3">
      <div class="col-lg-7"><div class="card p-3 h-100"><h2 class="h6 fw-bold">Ventas por emprendimiento</h2>
        ${tablaBarras(d.por_emprendimiento, 'Emprendimiento', (f) => (f.curso ? ` <small class="text-secondary">${esc(f.curso)}</small>` : ''))}</div></div>
      <div class="col-lg-5"><div class="card p-3 mb-3"><h2 class="h6 fw-bold">Ventas por día</h2>${tablaBarras(d.por_dia, 'Día')}</div>
        <div class="card p-3 mb-3"><h2 class="h6 fw-bold">Compras por rol</h2>${tablaBarras(d.por_tipo.map((r) => ({ ...r, nombre: TIPOS[r.tipo] })), 'Rol', (f) => ` <small class="text-secondary">${f.personas} personas</small>`)}</div>
        <div class="card p-3"><h2 class="h6 fw-bold">Ventas por curso del emprendimiento</h2>${tablaBarras(d.por_curso_emprendimiento, 'Curso')}</div></div>
      <div class="col-md-6 col-lg-4"><div class="card h-100"><div class="p-3 pb-0"><h2 class="h6 fw-bold text-danger"><i class="bi bi-x-circle"></i> Saldo agotado (${i.agotados})</h2></div>
        <div style="max-height:320px;overflow:auto">${listaPersonas(d.lista_agotados, 'Nadie ha agotado su saldo.')}</div></div></div>
      <div class="col-md-6 col-lg-4"><div class="card h-100"><div class="p-3 pb-0"><h2 class="h6 fw-bold text-warning-emphasis"><i class="bi bi-exclamation-triangle"></i> Saldo bajo (${i.saldo_bajo})</h2></div>
        <div style="max-height:320px;overflow:auto">${listaPersonas(d.lista_saldo_bajo, 'Nadie tiene saldo bajo.')}</div></div></div>
      <div class="col-lg-4"><div class="card h-100"><div class="p-3 pb-0"><h2 class="h6 fw-bold">Últimas compras</h2></div>
        <div class="list-group list-group-flush">${d.recientes.map((t) => `<div class="list-group-item ${t.estado === 'ANULADA' ? 'text-decoration-line-through text-secondary' : ''}">
          <div class="d-flex justify-content-between"><span class="fw-semibold">${esc(t.nombre_completo)}</span><span class="num fw-semibold">${pesos(t.valor)}</span></div>
          <div class="small text-secondary">${hora(t.fecha_hora)} · ${esc(t.emprendimiento)} · queda ${pesos(t.saldo_posterior)}</div></div>`).join('') || '<p class="text-secondary p-3 mb-0">Sin compras todavía.</p>'}</div></div></div>
    </div>`;
  // Tiempo real: se actualiza cada 10 segundos mientras el panel esté abierto
  S.refresco = setInterval(() => {
    const enPanel = ['', '#', '#panel'].includes(location.hash);
    if (enPanel && !document.hidden && !document.body.classList.contains('modal-open')) vistaPanel().catch(() => {});
  }, 10000);
}

// ===================================================================== BUSCADOR GLOBAL
let tBuscar;
qs('#buscarGlobal').addEventListener('input', (e) => {
  clearTimeout(tBuscar);
  const q = e.target.value.trim();
  const caja = qs('#resultadosBuscar');
  if (!q) { caja.classList.remove('show'); return; }
  tBuscar = setTimeout(async () => {
    const r = await api('/api/admin/buscar?q=' + encodeURIComponent(q));
    caja.innerHTML = r.length ? r.map((p) => `<a class="dropdown-item d-flex justify-content-between gap-3" href="#persona/${p.id}">
      <span>${esc(p.nombre_completo)}<br><small class="text-secondary">${esc(p.curso || TIPOS[p.tipo])} · ${esc(p.identificacion)}</small></span>
      <span class="text-end">${badgeSaldo(p.saldo)}${p.estado === 'BLOQUEADA' ? '<br><small class="text-danger">Bloqueada</small>' : ''}</span></a>`).join('')
      : '<span class="dropdown-item-text text-secondary">Sin resultados</span>';
    caja.classList.add('show');
  }, 250);
});
qs('#formBuscar').addEventListener('submit', (e) => { e.preventDefault(); location.hash = 'personas?q=' + encodeURIComponent(qs('#buscarGlobal').value); });
document.addEventListener('click', (e) => { if (!e.target.closest('#formBuscar')) qs('#resultadosBuscar').classList.remove('show'); });
qs('#resultadosBuscar').addEventListener('click', () => { qs('#resultadosBuscar').classList.remove('show'); qs('#buscarGlobal').value = ''; });

// ===================================================================== PERSONAS
async function vistaPersonas() {
  const p = params();
  C.innerHTML = `
    <div class="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
      <h1 class="h3 fw-bold mb-0">Personas y saldos</h1>
      <div class="d-flex flex-wrap gap-2">
        <button class="btn btn-primary" id="btnNueva"><i class="bi bi-person-plus"></i> Nueva persona</button>
        <button class="btn btn-outline-primary" id="btnImportar"><i class="bi bi-upload"></i> Importar Excel/CSV</button>
        <a class="btn btn-outline-secondary" href="/api/admin/reportes/estudiantes?formato=xlsx"><i class="bi bi-file-earmark-excel"></i> Excel</a>
      </div>
    </div>
    <form class="card p-3 mb-3" id="filtros"><div class="row g-2">
      <div class="col-md-4"><input class="form-control" name="q" placeholder="Nombre o identificación" value="${esc(p.get('q') || '')}"></div>
      <div class="col-6 col-md-2"><select class="form-select" name="curso_id">${opcionesCursos(p.get('curso_id'))}</select></div>
      <div class="col-6 col-md-2"><select class="form-select" name="tipo"><option value="">Todos los roles</option>${opcionesTipos(p.get('tipo'))}</select></div>
      <div class="col-6 col-md-2"><select class="form-select" name="estado"><option value="">Activas y bloqueadas</option>
        <option value="ACTIVA" ${p.get('estado') === 'ACTIVA' ? 'selected' : ''}>Activas</option><option value="BLOQUEADA" ${p.get('estado') === 'BLOQUEADA' ? 'selected' : ''}>Bloqueadas</option></select></div>
      <div class="col-6 col-md-2"><select class="form-select" name="saldo"><option value="">Cualquier saldo</option>
        <option value="agotado" ${p.get('saldo') === 'agotado' ? 'selected' : ''}>Saldo agotado</option><option value="bajo" ${p.get('saldo') === 'bajo' ? 'selected' : ''}>Saldo bajo</option></select></div>
    </div></form>
    <div class="card"><div id="tablaPersonas"><div class="p-4 text-center text-secondary"><div class="spinner-border"></div></div></div></div>`;
  qs('#btnNueva').addEventListener('click', () => formPersona());
  qs('#btnImportar').addEventListener('click', importarPersonas);
  const form = qs('#filtros');
  let t;
  const aplicar = () => {
    const q = new URLSearchParams([...new FormData(form).entries()].filter(([, v]) => v));
    history.replaceState(null, '', '#personas' + (q.toString() ? '?' + q : ''));
    cargarPersonas(q);
  };
  form.addEventListener('input', () => { clearTimeout(t); t = setTimeout(aplicar, 300); });
  form.addEventListener('submit', (e) => { e.preventDefault(); aplicar(); });
  aplicar();
}

async function cargarPersonas(q) {
  const r = await api('/api/admin/personas?' + q);
  if (!qs('#tablaPersonas')) return; // el usuario ya cambió de pantalla
  S.cfg.saldo_bajo = r.saldo_bajo;
  const filas = r.personas;
  const total = filas.reduce((a, f) => a + f.saldo, 0);
  qs('#tablaPersonas').innerHTML = filas.length ? `
    <div class="px-3 pt-3 small text-secondary">${filas.length} personas · saldo disponible total ${pesos(total)}</div>
    <div class="table-responsive"><table class="table table-hover align-middle mb-0">
      <thead><tr><th>Curso</th><th>Nombre</th><th class="d-none d-md-table-cell">Tipo</th><th class="d-none d-lg-table-cell">Identificación</th>
      <th class="num d-none d-lg-table-cell">Cargado</th><th class="num d-none d-lg-table-cell">Gastado</th><th class="num d-none d-md-table-cell">Día 1</th><th class="num d-none d-md-table-cell">Día 2</th><th class="num">Saldo</th><th>Estado</th><th class="text-end">Acciones</th></tr></thead>
      <tbody>${filas.map((f) => `<tr>
        <td>${esc(f.curso || '-')}</td>
        <td><a href="#persona/${f.id}" class="fw-semibold text-decoration-none">${esc(f.nombre_completo)}</a></td>
        <td class="d-none d-md-table-cell">${TIPOS[f.tipo]}</td><td class="d-none d-lg-table-cell">${esc(f.identificacion)}</td>
        <td class="num d-none d-lg-table-cell">${pesos(f.total_cargado)}</td><td class="num d-none d-lg-table-cell">${pesos(f.total_gastado)}</td>
        <td class="num d-none d-md-table-cell">${pesos(f.saldo_dia1)}</td><td class="num d-none d-md-table-cell">${pesos(f.saldo_dia2)}</td>
        <td class="num">${badgeSaldo(f.saldo)}</td><td>${badgeEstado(f.estado)}</td>
        <td class="text-end text-nowrap">
          <a class="btn btn-sm btn-outline-primary" href="#persona/${f.id}" title="Ver historial y QR"><i class="bi bi-eye"></i></a>
          <button class="btn btn-sm btn-outline-secondary" data-editar="${f.id}" title="Editar"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-outline-success" data-recargar="${f.id}" title="Recargar saldo"><i class="bi bi-plus-circle"></i></button>
        </td></tr>`).join('')}</tbody></table></div>`
    : '<p class="p-4 text-secondary mb-0">No hay personas con esos filtros.</p>';
  qs('#tablaPersonas').querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', async () => {
    const d = await api('/api/admin/personas/' + b.dataset.editar);
    formPersona(d.persona);
  }));
  qs('#tablaPersonas').querySelectorAll('[data-recargar]').forEach((b) => b.addEventListener('click', async () => {
    const d = await api('/api/admin/personas/' + b.dataset.recargar);
    formSaldo(d.persona, 'RECARGA');
  }));
}

function formPersona(p) {
  const nuevo = !p;
  p = p || { tipo: 'ESTUDIANTE', estado: 'ACTIVA' };
  const cuerpo = modal({
    titulo: nuevo ? 'Registrar persona' : 'Editar persona',
    cuerpo: `<form novalidate>
      <div class="mb-3"><label class="form-label">Rol</label><select class="form-select" name="tipo">${opcionesTipos(p.tipo)}</select></div>
      <div class="mb-3"><label class="form-label">Nombre completo *</label><input class="form-control" name="nombre_completo" value="${esc(p.nombre_completo || '')}" required></div>
      <div class="mb-3"><label class="form-label">Curso/grado <span class="text-secondary small" id="cursoAyuda">(obligatorio para estudiantes)</span></label>
        <select class="form-select" name="curso_id">${opcionesCursos(p.curso_id, 'Sin curso')}</select>
        <div class="form-text">¿No aparece el curso? Créelo en <a href="#config" data-bs-dismiss="modal">Configuración</a>.</div></div>
      <div class="mb-3"><label class="form-label">Número de identificación o código interno *</label><input class="form-control" name="identificacion" value="${esc(p.identificacion || '')}" required></div>
      ${nuevo ? `<div class="row g-2"><div class="col-7"><label class="form-label">Saldo inicial asignado</label>
        <div class="input-group"><span class="input-group-text">$</span><input class="form-control" name="saldo_inicial" inputmode="numeric" placeholder="25.000"></div></div>
        <div class="col-5"><label class="form-label">Estado</label><select class="form-select" name="estado"><option value="ACTIVA">Activa</option><option value="BLOQUEADA">Bloqueada</option></select></div></div>
        <p class="small text-secondary mt-2 mb-0"><i class="bi bi-pie-chart"></i> El saldo inicial se divide: ${S.cfg.porcentaje_dia1}% para el día 1 y el resto reservado para el día 2.<br>
        <i class="bi bi-qr-code"></i> El código QR único se genera automáticamente al guardar.</p>`
    : `<p class="small text-secondary mb-0">El saldo se modifica con <strong>Recargar</strong> o <strong>Ajustar</strong> en el detalle de la persona, para que quede registro.</p>`}
    </form>`,
    botones: [{ texto: 'Cancelar', clase: 'btn-outline-secondary' }, {
      texto: '<i class="bi bi-check-lg"></i> Guardar', clase: 'btn-primary',
      accion: async (c) => {
        const d = datosForm(c);
        if (nuevo) {
          const r = await api('/api/admin/personas', { method: 'POST', body: d });
          aviso('Persona registrada y QR generado.');
          location.hash = 'persona/' + r.id;
        } else {
          await api('/api/admin/personas/' + p.id, { method: 'PUT', body: d });
          aviso('Cambios guardados.');
          navegar();
        }
      },
    }],
  });
  const saldo = qs('[name=saldo_inicial]', cuerpo);
  if (saldo) formatearDinero(saldo);
}

function formSaldo(p, tipo) {
  const esAjuste = tipo === 'AJUSTE';
  const primera = Number(p.total_cargado) === 0;
  const pct = S.cfg.porcentaje_dia1;
  const cuerpo = modal({
    titulo: esAjuste ? 'Ajustar saldo' : 'Recargar saldo',
    cuerpo: `<form novalidate>
      <p class="mb-1"><strong>${esc(p.nombre_completo)}</strong> ${p.curso ? '· ' + esc(p.curso) : ''}</p>
      <p>Saldo actual: <strong class="fs-5">${pesos(p.saldo)}</strong>
        <span class="text-secondary small">(día 1: ${pesos(p.saldo_dia1)} · día 2: ${pesos(p.saldo_dia2)})</span></p>
      ${esAjuste ? `<div class="mb-2"><div class="btn-group w-100" role="group">
        <input type="radio" class="btn-check" name="signo" id="sMas" value="1" checked><label class="btn btn-outline-success" for="sMas">Sumar</label>
        <input type="radio" class="btn-check" name="signo" id="sMenos" value="-1"><label class="btn btn-outline-danger" for="sMenos">Restar</label></div></div>` : ''}
      <div class="mb-3"><label class="form-label">Valor *</label><div class="input-group input-group-lg"><span class="input-group-text">$</span>
        <input class="form-control" name="valor" inputmode="numeric" required></div></div>
      ${primera ? `<div class="alert alert-info small py-2">Es la primera carga de esta persona: se divide automáticamente, ${pct}% para el día 1 y el resto reservado para el día 2.</div>
        <input type="hidden" name="dia" value="AMBOS">`
    : `<div class="mb-3"><label class="form-label">¿Para qué día es este saldo? *</label>
        <div class="btn-group w-100 flex-wrap" role="group">
          <input type="radio" class="btn-check" name="dia" id="dAmbos" value="AMBOS" ${esAjuste ? '' : 'checked'}><label class="btn btn-outline-primary" for="dAmbos">Dividir entre los dos días</label>
          <input type="radio" class="btn-check" name="dia" id="dUno" value="DIA1" ${esAjuste ? 'checked' : ''}><label class="btn btn-outline-primary" for="dUno">Día 1</label>
          <input type="radio" class="btn-check" name="dia" id="dDos" value="DIA2"><label class="btn btn-outline-primary" for="dDos">Día 2</label>
        </div><div class="form-text">Pregunte al comprador en qué día quiere usar este dinero.</div></div>`}
      <div class="mb-2"><label class="form-label">Observación ${esAjuste ? '*' : ''}</label><input class="form-control" name="observacion" maxlength="255"
        placeholder="${esAjuste ? 'Motivo del ajuste' : 'Ej.: aporte adicional de la familia'}"></div>
      <div class="alert alert-light border small mb-0" id="previa"></div>
    </form>`,
    botones: [{ texto: 'Cancelar', clase: 'btn-outline-secondary' }, {
      texto: '<i class="bi bi-check-lg"></i> Registrar', clase: esAjuste ? 'btn-warning' : 'btn-success',
      accion: async (c) => {
        const d = datosForm(c);
        let valor = aEntero(d.valor);
        if (!valor) throw new Error('Ingrese un valor válido.');
        if (esAjuste && !d.observacion.trim()) throw new Error('Escriba el motivo del ajuste.');
        if (d.signo === '-1') valor = -valor;
        if (valor < 0 && d.dia === 'AMBOS') throw new Error('Para restar, elija de qué día se descuenta (día 1 o día 2).');
        const r = await api(`/api/admin/personas/${p.id}/saldo`, { method: 'POST', body: { tipo, valor, dia: d.dia, observacion: d.observacion } });
        aviso(`Saldo actualizado: ${pesos(r.saldo_anterior)} → ${pesos(r.saldo_nuevo)} (día 1 ${r.valor_dia1 >= 0 ? '+' : ''}${pesos(r.valor_dia1)}, día 2 ${r.valor_dia2 >= 0 ? '+' : ''}${pesos(r.valor_dia2)})`);
        navegar();
      },
    }],
  });
  const form = qs('form', cuerpo);
  const inp = qs('[name=valor]', cuerpo);
  formatearDinero(inp);
  const previa = () => {
    const v = (aEntero(inp.value) || 0) * (qs('#sMenos', cuerpo)?.checked ? -1 : 1);
    const dia = new FormData(form).get('dia');
    const d1 = dia === 'DIA1' ? v : dia === 'DIA2' ? 0 : Math.round((v * pct) / 100);
    const d2 = v - d1;
    const malo = p.saldo_dia1 + d1 < 0 || p.saldo_dia2 + d2 < 0;
    qs('#previa', cuerpo).innerHTML = malo ? '<strong class="text-danger">No permitido: el saldo quedaría negativo.</strong>'
      : `Nuevo saldo: <strong>${pesos(p.saldo + v)}</strong> · día 1: ${pesos(p.saldo_dia1 + d1)} · día 2: ${pesos(p.saldo_dia2 + d2)}`;
  };
  form.addEventListener('input', previa); // el formulario se reemplaza en cada modal
  previa();
}

// ---------- importación CSV
function leerCSV(texto) {
  texto = texto.replace(/^﻿/, '');
  const sep = (texto.split('\n')[0].match(/;/g) || []).length >= (texto.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const filas = [];
  let fila = []; let celda = ''; let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (comillas) {
      if (ch === '"' && texto[i + 1] === '"') { celda += '"'; i++; } else if (ch === '"') comillas = false; else celda += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === sep) { fila.push(celda); celda = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && texto[i + 1] === '\n') i++; fila.push(celda); filas.push(fila); fila = []; celda = ''; }
    else celda += ch;
  }
  if (celda || fila.length) { fila.push(celda); filas.push(fila); }
  return filas.filter((f) => f.some((c) => c.trim()));
}
const normal = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');

function importarPersonas() {
  const plantilla = '\ufeffnombre;tipo;curso;identificacion;saldo\nJuan Pérez;ESTUDIANTE;10A;1001;25000\nMarta Herrera;DOCENTE;;CC52000111;40000\n';
  const url = URL.createObjectURL(new Blob([plantilla], { type: 'text/csv;charset=utf-8' }));
  let filas = [];
  const cuerpo = modal({
    titulo: 'Importar personas desde Excel o CSV', tamano: 'modal-lg',
    cuerpo: `<form>
      <p>Suba un archivo de <strong>Excel (.xlsx)</strong> o <strong>CSV</strong> con estas columnas en la primera fila:
      <code>nombre, tipo, curso, identificacion, saldo</code>. El tipo puede quedar vacío (se toma como estudiante).
      Los cursos que no existan se crean automáticamente. El saldo inicial se reparte entre día 1 y día 2 según la configuración.</p>
      <p class="d-flex flex-wrap gap-3"><a href="/api/admin/plantilla-personas.xlsx"><i class="bi bi-file-earmark-excel"></i> Plantilla Excel</a>
        <a href="${url}" download="plantilla-personas.csv"><i class="bi bi-filetype-csv"></i> Plantilla CSV</a></p>
      <input type="file" class="form-control" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" id="archivoCSV">
      <div id="previaCSV" class="mt-3"></div></form>`,
    botones: [{ texto: 'Cancelar', clase: 'btn-outline-secondary' }, {
      texto: '<i class="bi bi-upload"></i> Importar', clase: 'btn-primary',
      accion: async (c) => {
        if (!filas.length) throw new Error('Seleccione un archivo con datos.');
        qs('#previaCSV', c).innerHTML = `<div class="alert alert-info"><span class="spinner-border spinner-border-sm"></span> Importando ${filas.length} personas…</div>`;
        const r = await api('/api/admin/personas/importar', { method: 'POST', body: { filas }, timeout: 300000 });
        qs('#previaCSV', c).innerHTML = `<div class="alert alert-${r.errores.length ? 'warning' : 'success'}">Se registraron <strong>${r.creadas}</strong> personas.
          ${r.errores.length ? `<br>${r.errores.length} filas con errores:<ul class="mb-0">${r.errores.slice(0, 50).map((e) => `<li>Fila ${e.fila}: ${esc(e.error)}</li>`).join('')}</ul>` : ''}</div>`;
        filas = [];
        if (r.creadas) cargarPersonas(new URLSearchParams());
        return false; // dejar abierto para ver el resultado
      },
    }],
  });
  const previa = qs('#previaCSV', cuerpo);
  qs('#archivoCSV', cuerpo).addEventListener('change', async (e) => {
    const f = e.target.files[0];
    filas = [];
    if (!f) return;
    let datos;
    try {
      if (/\.xlsx$/i.test(f.name)) {
        previa.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Leyendo Excel…';
        const b64 = await new Promise((ok, mal) => {
          const lector = new FileReader();
          lector.onload = () => ok(lector.result);
          lector.onerror = () => mal(new Error('No se pudo leer el archivo.'));
          lector.readAsDataURL(f);
        });
        datos = (await api('/api/admin/personas/leer-excel', { method: 'POST', body: { archivo: b64 }, timeout: 60000 })).filas;
      } else if (/\.xls$/i.test(f.name)) {
        throw new Error('El formato .xls antiguo no se admite. En Excel use "Guardar como" › Libro de Excel (.xlsx).');
      } else {
        datos = leerCSV(await f.text());
      }
    } catch (err) {
      previa.innerHTML = `<div class="alert alert-danger">${esc(err.message)}</div>`;
      return;
    }
    if (!datos.length) { previa.innerHTML = '<div class="alert alert-danger">El archivo está vacío.</div>'; return; }
    const enc = datos.shift().map((h) => normal(String(h)));
    const col = (...nombres) => enc.findIndex((h) => nombres.some((n) => h.startsWith(n)));
    const iN = col('nombre'); const iT = col('tipo', 'rol'); const iC = col('curso', 'grado'); const iI = col('identificacion', 'documento', 'codigo', 'id');
    const iS = col('saldo', 'valor');
    if (iN < 0 || iI < 0) { previa.innerHTML = '<div class="alert alert-danger">La primera fila debe tener columnas "nombre" e "identificacion".</div>'; return; }
    const v = (r, i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
    filas = datos.map((r) => ({
      nombre_completo: v(r, iN), tipo: v(r, iT).toUpperCase() || 'ESTUDIANTE',
      curso: v(r, iC), identificacion: v(r, iI), saldo_inicial: v(r, iS).replace(/[.,]\d{1,2}$/, '').replace(/[^\d]/g, '') || '0',
    })).filter((x) => x.nombre_completo || x.identificacion);
    if (filas.length > 5000) { previa.innerHTML = '<div class="alert alert-danger">Máximo 5.000 personas por archivo. Divida la lista.</div>'; filas = []; return; }
    previa.innerHTML = `<p class="fw-semibold">${filas.length} filas listas para importar. Primeras filas:</p>
      <div class="table-responsive"><table class="table table-sm"><thead><tr><th>Nombre</th><th>Tipo</th><th>Curso</th><th>Identificación</th><th class="num">Saldo</th></tr></thead>
      <tbody>${filas.slice(0, 8).map((x) => `<tr><td>${esc(x.nombre_completo)}</td><td>${esc(x.tipo)}</td><td>${esc(x.curso)}</td><td>${esc(x.identificacion)}</td><td class="num">${pesos(x.saldo_inicial)}</td></tr>`).join('')}</tbody></table></div>`;
  });
}

// ===================================================================== DETALLE DE PERSONA
async function vistaPersona(id) {
  const d = await api('/api/admin/personas/' + id);
  const p = d.persona;
  const codigo = p.qr_token.match(/.{4}/g).join(' ');
  const gastado = d.compras.filter((t) => t.estado === 'CONFIRMADA').reduce((a, t) => a + t.valor, 0);
  C.innerHTML = `
    <a href="#personas" class="text-decoration-none"><i class="bi bi-arrow-left"></i> Personas</a>
    <div class="d-flex flex-wrap justify-content-between align-items-center my-2 gap-2">
      <div><h1 class="h3 fw-bold mb-0">${esc(p.nombre_completo)}</h1>
        <div class="text-secondary">${TIPOS[p.tipo]}${p.curso ? ' · Curso ' + esc(p.curso) : ''} · ID ${esc(p.identificacion)} · ${badgeEstado(p.estado)}</div></div>
      <div class="d-flex flex-wrap gap-2">
        <button class="btn btn-outline-secondary" id="bEditar"><i class="bi bi-pencil"></i> Editar</button>
        <button class="btn ${p.estado === 'ACTIVA' ? 'btn-outline-danger' : 'btn-success'}" id="bEstado">
          <i class="bi ${p.estado === 'ACTIVA' ? 'bi-lock' : 'bi-unlock'}"></i> ${p.estado === 'ACTIVA' ? 'Bloquear cuenta' : 'Activar cuenta'}</button>
      </div>
    </div>
    ${p.estado === 'BLOQUEADA' ? '<div class="alert alert-danger"><i class="bi bi-lock-fill"></i> Esta cuenta está bloqueada: los vendedores no pueden cobrarle.</div>' : ''}
    <div class="row g-3 mb-3">
      <div class="col-md-7"><div class="card p-3 h-100">
        <div class="row text-center g-2">
          <div class="col-4"><div class="text-secondary small">Saldo inicial</div><div class="fs-5 fw-semibold">${pesos(p.saldo_inicial)}</div></div>
          <div class="col-4"><div class="text-secondary small">Total cargado</div><div class="fs-5 fw-semibold">${pesos(p.total_cargado)}</div></div>
          <div class="col-4"><div class="text-secondary small">Gastado</div><div class="fs-5 fw-semibold">${pesos(gastado)}</div></div>
        </div><hr>
        <div class="text-center"><div class="text-secondary">Saldo total</div>
          <div class="saldo-grande ${p.saldo === 0 ? 'text-danger' : p.saldo < S.cfg.saldo_bajo ? 'text-warning' : 'text-success'}">${pesos(p.saldo)}</div>
          ${p.saldo === 0 ? '<div class="text-danger fw-semibold">Saldo agotado</div>' : p.saldo < S.cfg.saldo_bajo ? '<div class="text-warning-emphasis fw-semibold">Saldo bajo</div>' : ''}
          <div class="row g-2 mt-1 justify-content-center">
            <div class="col-6 col-lg-4"><div class="border rounded-3 p-2"><div class="small text-secondary">Saldo día 1</div><div class="fw-bold">${pesos(p.saldo_dia1)}</div></div></div>
            <div class="col-6 col-lg-4"><div class="border rounded-3 p-2"><div class="small text-secondary">Saldo día 2</div><div class="fw-bold">${pesos(p.saldo_dia2)}</div></div></div>
            <div class="col-12 col-lg-4"><div class="border rounded-3 p-2 border-primary"><div class="small text-secondary">Puede gastar hoy</div><div class="fw-bold text-primary">${pesos(p.disponible_hoy)}</div></div></div>
          </div>
          <div class="d-flex justify-content-center gap-2 mt-3">
            <button class="btn btn-success" id="bRecargar"><i class="bi bi-plus-circle"></i> Recargar saldo</button>
            <button class="btn btn-outline-warning" id="bAjustar"><i class="bi bi-sliders"></i> Ajustar</button>
          </div></div>
      </div></div>
      <div class="col-md-5"><div class="card p-3 h-100 text-center">
        <img src="/api/admin/personas/${p.id}/qr.png?v=${p.qr_token.slice(0, 6)}" alt="Código QR" class="mx-auto" style="width:190px;height:190px">
        <div class="font-monospace small text-secondary mb-2">${codigo}</div>
        <div class="d-flex flex-wrap justify-content-center gap-2">
          <a class="btn btn-sm btn-primary" href="/api/admin/personas/${p.id}/qr.png?descargar=1"><i class="bi bi-download"></i> Descargar</a>
          <a class="btn btn-sm btn-outline-primary" href="/admin/imprimir.html?ids=${p.id}" target="_blank"><i class="bi bi-printer"></i> Imprimir</a>
          <a class="btn btn-sm btn-outline-primary" href="/api/admin/qr/pdf?ids=${p.id}"><i class="bi bi-filetype-pdf"></i> PDF</a>
          <button class="btn btn-sm btn-outline-danger" id="bRegenerar" title="Si el QR se perdió o fue copiado"><i class="bi bi-arrow-repeat"></i> QR nuevo</button>
        </div></div></div>
    </div>
    <div class="card mb-3"><div class="p-3 pb-0 d-flex justify-content-between"><h2 class="h5 fw-bold">Historial de compras</h2>
      <a class="btn btn-sm btn-outline-secondary" href="/api/admin/reportes/transacciones?formato=xlsx&estudiante_id=${p.id}"><i class="bi bi-file-earmark-excel"></i> Excel</a></div>
      <div class="table-responsive"><table class="table align-middle mb-0">
        <thead><tr><th>Fecha</th><th>Hora</th><th>Emprendimiento</th><th class="num">Compra</th><th class="num">Saldo restante</th><th>Estado</th><th></th></tr></thead>
        <tbody>${d.compras.map((t) => `<tr class="${t.estado === 'ANULADA' ? 'text-secondary' : ''}">
          <td>${fecha(t.fecha_hora)}</td><td>${hora(t.fecha_hora)}</td><td>${esc(t.emprendimiento)}<div class="small text-secondary">${esc(t.vendedor)}</div></td>
          <td class="num fw-semibold ${t.estado === 'ANULADA' ? 'text-decoration-line-through' : ''}">${pesos(t.valor)}</td><td class="num">${pesos(t.saldo_posterior)}</td>
          <td>${t.estado === 'ANULADA' ? `<span class="badge text-bg-secondary" title="${esc(t.motivo_anulacion)}">Anulada</span><div class="small">${esc(t.anulada_por)} · ${fechaHora(t.anulada_en)}<br>${esc(t.motivo_anulacion)}</div>` : '<span class="badge text-bg-success">Confirmada</span>'}</td>
          <td class="text-end">${t.estado === 'CONFIRMADA' ? `<button class="btn btn-sm btn-outline-danger" data-anular="${t.id}" data-valor="${t.valor}"><i class="bi bi-arrow-counterclockwise"></i> Anular</button>` : ''}</td></tr>`).join('')
          || '<tr><td colspan="7" class="text-secondary">Sin compras todavía.</td></tr>'}</tbody></table></div></div>
    <div class="card"><div class="p-3 pb-0"><h2 class="h5 fw-bold">Cargas y modificaciones de saldo</h2></div>
      <div class="table-responsive"><table class="table align-middle mb-0">
        <thead><tr><th>Fecha y hora</th><th>Tipo</th><th>Asignado a</th><th class="num">Valor</th><th class="num">Saldo anterior</th><th class="num">Nuevo saldo</th><th>Administrador</th><th>Observación</th></tr></thead>
        <tbody>${d.recargas.map((r) => `<tr><td>${fechaHora(r.fecha_hora)}</td><td>${r.tipo === 'INICIAL' ? 'Saldo inicial' : r.tipo === 'RECARGA' ? 'Recarga' : 'Ajuste'}</td>
          <td>${r.dia === 'DIA1' ? 'Día 1' : r.dia === 'DIA2' ? 'Día 2' : 'Ambos días'}<div class="small text-secondary">${pesos(r.valor_dia1)} / ${pesos(r.valor_dia2)}</div></td>
          <td class="num ${r.valor < 0 ? 'text-danger' : 'text-success'}">${r.valor < 0 ? '-' : '+'}${pesos(Math.abs(r.valor))}</td><td class="num">${pesos(r.saldo_anterior)}</td>
          <td class="num">${pesos(r.saldo_nuevo)}</td><td>${esc(r.administrador)}</td><td>${esc(r.observacion || '')}</td></tr>`).join('')
          || '<tr><td colspan="8" class="text-secondary">Sin cargas de saldo.</td></tr>'}</tbody></table></div></div>`;
  qs('#bEditar').addEventListener('click', () => formPersona(p));
  qs('#bRecargar').addEventListener('click', () => formSaldo(p, 'RECARGA'));
  qs('#bAjustar').addEventListener('click', () => formSaldo(p, 'AJUSTE'));
  qs('#bEstado').addEventListener('click', () => {
    const bloquear = p.estado === 'ACTIVA';
    modal({
      titulo: bloquear ? 'Bloquear cuenta' : 'Activar cuenta',
      cuerpo: `<form><p>${bloquear ? 'Mientras esté bloqueada, ningún vendedor podrá cobrarle a' : 'La cuenta volverá a poder comprar:'} <strong>${esc(p.nombre_completo)}</strong>.</p>
        <label class="form-label">Motivo (opcional)</label><input class="form-control" name="motivo" maxlength="200"></form>`,
      botones: [{ texto: 'Cancelar', clase: 'btn-outline-secondary' }, {
        texto: bloquear ? 'Bloquear' : 'Activar', clase: bloquear ? 'btn-danger' : 'btn-success',
        accion: async (c) => {
          await api(`/api/admin/personas/${p.id}/estado`, { method: 'PUT', body: { estado: bloquear ? 'BLOQUEADA' : 'ACTIVA', motivo: datosForm(c).motivo } });
          aviso(bloquear ? 'Cuenta bloqueada.' : 'Cuenta activada.');
          navegar();
        },
      }],
    });
  });
  qs('#bRegenerar').addEventListener('click', () => modal({
    titulo: 'Generar un QR nuevo',
    cuerpo: '<p>El QR actual <strong>dejará de funcionar</strong> y habrá que imprimir y entregar el nuevo. Úselo si el QR se perdió o alguien lo copió.</p>',
    botones: [{ texto: 'Cancelar', clase: 'btn-outline-secondary' }, {
      texto: 'Generar QR nuevo', clase: 'btn-danger',
      accion: async () => { await api(`/api/admin/personas/${p.id}/regenerar-qr`, { method: 'POST' }); aviso('QR nuevo generado.'); navegar(); },
    }],
  }));
  C.querySelectorAll('[data-anular]').forEach((b) => b.addEventListener('click', () => anular(b.dataset.anular, Number(b.dataset.valor), p.nombre_completo)));
}

function anular(id, valor, nombre) {
  modal({
    titulo: 'Anular compra',
    cuerpo: `<form><p>Se devolverán <strong>${pesos(valor)}</strong> al saldo de <strong>${esc(nombre)}</strong>. La compra quedará marcada como anulada (no se borra) con su nombre, fecha y motivo.</p>
      <label class="form-label">Motivo de la anulación *</label><input class="form-control" name="motivo" maxlength="255" required placeholder="Ej.: el vendedor digitó mal el valor"></form>`,
    botones: [{ texto: 'Cancelar', clase: 'btn-outline-secondary' }, {
      texto: '<i class="bi bi-arrow-counterclockwise"></i> Anular compra', clase: 'btn-danger',
      accion: async (c) => {
        const r = await api(`/api/admin/transacciones/${id}/anular`, { method: 'POST', body: datosForm(c) });
        aviso(`Compra anulada. Nuevo saldo: ${pesos(r.saldo_nuevo)}`);
        navegar();
      },
    }],
  });
}

// ===================================================================== CÓDIGOS QR
async function vistaQR() {
  C.innerHTML = `
    <h1 class="h3 fw-bold mb-1">Códigos QR</h1>
    <p class="text-secondary">Cada persona recibe automáticamente un QR único al registrarse. El QR contiene un identificador secreto, el nombre y el curso o rol; nunca el saldo.</p>
    <div class="row g-3">
      <div class="col-lg-5"><div class="card p-3">
        <h2 class="h6 fw-bold">Generar todos los QR</h2>
        <div class="row g-2 mb-3"><div class="col-6"><label class="form-label small">Curso</label>
          <select class="form-select" id="qrCurso">${opcionesCursos('', 'Todos los cursos')}</select></div>
          <div class="col-6"><label class="form-label small">Rol</label>
          <select class="form-select" id="qrTipo"><option value="">Todos los roles</option>${opcionesTipos('')}</select></div></div>
        <div class="d-grid gap-2">
          <button class="btn btn-primary" id="qrPdf"><i class="bi bi-filetype-pdf"></i> Descargar PDF (12 QR por página)</button>
          <button class="btn btn-outline-primary" id="qrImprimir"><i class="bi bi-printer"></i> Ver e imprimir tarjetas QR</button>
          <button class="btn btn-outline-primary" id="qrZip"><i class="bi bi-file-zip"></i> Descargar todos (ZIP de imágenes)</button>
        </div>
        <p class="small text-secondary mt-3 mb-0">El PDF es tamaño carta, con 4 filas de 3 tarjetas por página, listas para recortar.</p>
      </div></div>
      <div class="col-lg-7"><div class="card p-3">
        <h2 class="h6 fw-bold">Buscar una persona y ver su QR</h2>
        <input class="form-control mb-2" id="qrBuscar" placeholder="Nombre, curso, rol o identificación" autocomplete="off">
        <div class="list-group" id="qrLista"></div>
        <div id="qrVista" class="text-center mt-3"></div>
      </div></div>
    </div>`;
  const filtroQR = () => `curso_id=${qs('#qrCurso').value}&tipo=${qs('#qrTipo').value}`;
  qs('#qrPdf').addEventListener('click', () => { location.href = '/api/admin/qr/pdf?' + filtroQR(); });
  qs('#qrImprimir').addEventListener('click', () => window.open('/admin/imprimir.html?' + filtroQR(), '_blank'));
  qs('#qrZip').addEventListener('click', () => { location.href = '/api/admin/qr/zip?' + filtroQR(); });
  let t;
  qs('#qrBuscar').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = e.target.value.trim();
      if (!q) { qs('#qrLista').innerHTML = ''; return; }
      const r = await api('/api/admin/buscar?q=' + encodeURIComponent(q));
      qs('#qrLista').innerHTML = r.map((p) => `<button class="list-group-item list-group-item-action" data-id="${p.id}" data-nombre="${esc(p.nombre_completo)}">
        ${esc(p.nombre_completo)} <small class="text-secondary">${esc(p.curso || TIPOS[p.tipo])}</small></button>`).join('') || '<div class="text-secondary small">Sin resultados</div>';
    }, 250);
  });
  qs('#qrLista').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    const id = b.dataset.id;
    qs('#qrVista').innerHTML = `<h3 class="h5">${esc(b.dataset.nombre)}</h3>
      <img src="/api/admin/personas/${id}/qr.png" alt="QR" style="width:220px;height:220px"><div class="d-flex justify-content-center gap-2 mt-2">
      <a class="btn btn-primary" href="/api/admin/personas/${id}/qr.png?descargar=1"><i class="bi bi-download"></i> Descargar</a>
      <a class="btn btn-outline-primary" href="/admin/imprimir.html?ids=${id}" target="_blank"><i class="bi bi-printer"></i> Imprimir</a>
      <a class="btn btn-outline-primary" href="/api/admin/qr/pdf?ids=${id}"><i class="bi bi-filetype-pdf"></i> PDF</a>
      <a class="btn btn-outline-secondary" href="#persona/${id}">Ver cuenta</a></div>`;
  });
}

// ===================================================================== EMPRENDIMIENTOS
async function vistaEmprendimientos() {
  const lista = await api('/api/admin/emprendimientos');
  S.emprendimientos = lista;
  C.innerHTML = `
    <div class="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
      <h1 class="h3 fw-bold mb-0">Emprendimientos</h1>
      <div class="d-flex gap-2"><button class="btn btn-primary" id="btnNuevoEmp"><i class="bi bi-plus-lg"></i> Nuevo emprendimiento</button>
      <a class="btn btn-outline-secondary" href="/api/admin/reportes/emprendimientos?formato=xlsx"><i class="bi bi-file-earmark-excel"></i> Excel</a></div>
    </div>
    <div class="card"><div class="table-responsive"><table class="table table-hover align-middle mb-0">
      <thead><tr><th>Emprendimiento</th><th>Curso o rol</th><th class="d-none d-md-table-cell">Responsables</th><th class="d-none d-lg-table-cell">Categoría / productos</th>
      <th>Usuario vendedor</th><th class="num">Ventas</th><th class="num">Total</th><th></th></tr></thead>
      <tbody>${lista.map((e) => `<tr class="${e.activo ? '' : 'text-secondary'}">
        <td class="fw-semibold">${esc(e.nombre)} ${e.activo ? '' : '<span class="badge text-bg-secondary">Inactivo</span>'}</td>
        <td>${esc(e.curso || TIPOS[e.rol] || '-')}</td>
        <td class="d-none d-md-table-cell small">${e.responsables_lista.map((r) => `<a href="#persona/${r.id}" class="text-decoration-none">${esc(r.nombre_completo)}</a>`).join(', ') || esc(e.responsables)}</td>
        <td class="d-none d-lg-table-cell small">${esc(e.categoria || '')}<div class="text-secondary">${esc(e.productos || '')}</div></td>
        <td><code>${esc(e.usuario || '-')}</code><div class="small text-secondary">${e.ultimo_acceso ? 'Último ingreso ' + fechaHora(e.ultimo_acceso) : 'Nunca ha ingresado'}</div></td>
        <td class="num">${e.ventas}</td><td class="num fw-semibold">${pesos(e.total)}</td>
        <td class="text-end text-nowrap"><a class="btn btn-sm btn-outline-primary" href="#transacciones?emprendimiento_id=${e.id}" title="Ver ventas"><i class="bi bi-receipt"></i></a>
          <button class="btn btn-sm btn-outline-secondary" data-editar="${e.id}" title="Editar"><i class="bi bi-pencil"></i></button></td></tr>`).join('')
        || '<tr><td colspan="8" class="text-secondary p-3">Todavía no hay emprendimientos registrados.</td></tr>'}</tbody></table></div></div>`;
  qs('#btnNuevoEmp').addEventListener('click', () => formEmprendimiento());
  C.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => formEmprendimiento(lista.find((e) => String(e.id) === b.dataset.editar))));
}

function formEmprendimiento(e) {
  const nuevo = !e;
  e = e || { activo: 1, responsables_lista: [] };
  const elegidos = new Map(e.responsables_lista.map((r) => [r.id, r]));
  const valorCursoRol = e.curso_id ? String(e.curso_id) : e.rol ? 'rol:' + e.rol : '';
  const opcionesCursoRol = `<option value="">Sin curso ni rol</option>
    <optgroup label="Cursos">${S.cursos.map((c) => `<option value="${c.id}" ${valorCursoRol === String(c.id) ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</optgroup>
    <optgroup label="Roles">${Object.entries(TIPOS).filter(([k]) => k !== 'ESTUDIANTE').map(([k, v]) => `<option value="rol:${k}" ${valorCursoRol === 'rol:' + k ? 'selected' : ''}>${v}</option>`).join('')}</optgroup>`;
  const cuerpo = modal({
    titulo: nuevo ? 'Nuevo emprendimiento' : 'Editar emprendimiento', tamano: 'modal-lg',
    cuerpo: `<form novalidate><div class="row g-3">
      <div class="col-md-7"><label class="form-label">Nombre del emprendimiento *</label><input class="form-control" name="nombre" value="${esc(e.nombre || '')}"></div>
      <div class="col-md-5"><label class="form-label">Curso o rol</label><select class="form-select" name="curso_rol">${opcionesCursoRol}</select></div>
      <div class="col-12"><label class="form-label">Responsables * <span class="small text-secondary">(se eligen entre las personas registradas)</span></label>
        <div id="chips" class="d-flex flex-wrap gap-2 mb-2"></div>
        <div class="position-relative"><input class="form-control" id="buscaResp" placeholder="Escriba un nombre, curso o identificación para agregar" autocomplete="off">
        <div id="sugResp" class="dropdown-menu w-100 shadow" style="max-height:240px;overflow:auto"></div></div></div>
      <div class="col-md-5"><label class="form-label">Categoría</label><input class="form-control" name="categoria" value="${esc(e.categoria || '')}" placeholder="Comidas, dulces, artesanías..." list="categorias">
        <datalist id="categorias"><option>Comidas</option><option>Dulces</option><option>Bebidas</option><option>Artesanías</option><option>Entretenimiento</option><option>Servicios</option></datalist></div>
      <div class="col-md-7"><label class="form-label">Productos</label><input class="form-control" name="productos" value="${esc(e.productos || '')}"></div>
      <div class="col-12"><hr class="my-1"><h3 class="h6 fw-bold mt-2"><i class="bi bi-phone"></i> Acceso del vendedor</h3>
        <p class="small text-secondary mb-0">Con este usuario el emprendimiento solo puede cobrar con QR y ver sus propias ventas. Puede usarse en varios celulares a la vez.</p></div>
      <div class="col-md-6"><label class="form-label">Usuario *</label><input class="form-control" name="usuario" autocapitalize="none" value="${esc(e.usuario || '')}" placeholder="ej.: dulces10a"></div>
      <div class="col-md-6"><label class="form-label">${nuevo ? 'Contraseña *' : 'Nueva contraseña'}</label>
        <div class="input-group"><input class="form-control" name="password" type="password" autocomplete="new-password" placeholder="${nuevo ? 'Mínimo 4 caracteres' : 'Déjela vacía para no cambiarla'}">
        <button class="btn btn-outline-secondary" type="button" id="verClave" title="Mostrar"><i class="bi bi-eye"></i></button></div></div>
      <div class="col-12"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="activo" value="1" id="empActivo" ${e.activo ? 'checked' : ''}>
        <label class="form-check-label" for="empActivo">Activo (puede iniciar sesión y vender)</label></div></div>
    </div></form>`,
    botones: [{ texto: 'Cancelar', clase: 'btn-outline-secondary' }, {
      texto: '<i class="bi bi-check-lg"></i> Guardar', clase: 'btn-primary',
      accion: async (c) => {
        const d = datosForm(c);
        d.activo = d.activo === '1';
        d.responsables_ids = [...elegidos.keys()];
        if (d.curso_rol.startsWith('rol:')) { d.rol = d.curso_rol.slice(4); d.curso_id = ''; } else { d.curso_id = d.curso_rol; d.rol = ''; }
        await api(nuevo ? '/api/admin/emprendimientos' : '/api/admin/emprendimientos/' + e.id, { method: nuevo ? 'POST' : 'PUT', body: d });
        aviso(nuevo ? 'Emprendimiento registrado.' : 'Cambios guardados.');
        navegar();
      },
    }],
  });
  const chips = qs('#chips', cuerpo);
  const pintarChips = () => {
    chips.innerHTML = [...elegidos.values()].map((r) => `<span class="badge rounded-pill text-bg-primary fs-6 fw-normal d-flex align-items-center gap-1">
      ${esc(r.nombre_completo)} <small class="opacity-75">${esc(r.curso || TIPOS[r.tipo] || '')}</small>
      <button type="button" class="btn-close btn-close-white" style="font-size:.6rem" data-quitar="${r.id}" aria-label="Quitar"></button></span>`).join('')
      || '<span class="text-secondary small">Ningún responsable seleccionado todavía.</span>';
  };
  chips.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-quitar]');
    if (b) { elegidos.delete(Number(b.dataset.quitar)); pintarChips(); }
  });
  pintarChips();
  const busca = qs('#buscaResp', cuerpo);
  const sug = qs('#sugResp', cuerpo);
  let t;
  busca.addEventListener('input', () => {
    clearTimeout(t);
    const q = busca.value.trim();
    if (!q) { sug.classList.remove('show'); return; }
    t = setTimeout(async () => {
      const r = await api('/api/admin/buscar?q=' + encodeURIComponent(q));
      sug.innerHTML = r.map((p) => `<button type="button" class="dropdown-item" data-id="${p.id}">${esc(p.nombre_completo)}
        <small class="text-secondary">${esc(p.curso || TIPOS[p.tipo])} · ${esc(p.identificacion)}</small>${elegidos.has(p.id) ? ' <i class="bi bi-check text-success"></i>' : ''}</button>`).join('')
        || '<span class="dropdown-item-text text-secondary">Sin resultados</span>';
      sug.classList.add('show');
      sug.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => {
        const p = r.find((x) => String(x.id) === b.dataset.id);
        elegidos.set(p.id, p);
        pintarChips();
        busca.value = '';
        sug.classList.remove('show');
        // Sugerir el curso del primer responsable si aún no hay curso
        const sel = qs('[name=curso_rol]', cuerpo);
        if (!sel.value) sel.value = p.curso_id ? String(p.curso_id) : (S.cursos.find((c) => c.nombre === p.curso)?.id ?? (p.tipo !== 'ESTUDIANTE' ? 'rol:' + p.tipo : ''));
        busca.focus();
      }));
    }, 200);
  });
  qs('#verClave', cuerpo).addEventListener('click', () => {
    const i = qs('[name=password]', cuerpo);
    i.type = i.type === 'password' ? 'text' : 'password';
  });
}

// ===================================================================== TRANSACCIONES
async function vistaTransacciones() {
  if (!S.emprendimientos.length) S.emprendimientos = await api('/api/admin/emprendimientos');
  const p = params();
  const opEmp = '<option value="">Todos los emprendimientos</option>' + S.emprendimientos.map((e) => `<option value="${e.id}" ${p.get('emprendimiento_id') === String(e.id) ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('');
  C.innerHTML = `
    <div class="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
      <h1 class="h3 fw-bold mb-0">Transacciones</h1>
      <div class="d-flex gap-2"><button class="btn btn-outline-secondary" data-exportar="xlsx"><i class="bi bi-file-earmark-excel"></i> Excel</button>
      <button class="btn btn-outline-secondary" data-exportar="csv"><i class="bi bi-filetype-csv"></i> CSV</button></div>
    </div>
    <form class="card p-3 mb-3" id="filtrosT"><div class="row g-2">
      <div class="col-md-4 col-xl-2"><input class="form-control" name="q" placeholder="Comprador" value="${esc(p.get('q') || '')}"></div>
      <div class="col-md-4 col-xl-3"><select class="form-select" name="emprendimiento_id">${opEmp}</select></div>
      <div class="col-6 col-md-4 col-xl-2"><select class="form-select" name="curso_id">${opcionesCursos(p.get('curso_id'), 'Curso del comprador')}</select></div>
      <div class="col-6 col-md-4 col-xl-2"><select class="form-select" name="tipo"><option value="">Todos los roles</option>${opcionesTipos(p.get('tipo'))}</select></div>
      <div class="col-6 col-md-4 col-xl-2"><select class="form-select" name="estado"><option value="">Confirmadas y anuladas</option><option value="CONFIRMADA">Confirmadas</option><option value="ANULADA">Anuladas</option></select></div>
      <div class="col-6 col-md-4 col-xl-2"><input class="form-control px-2" type="date" name="desde" title="Desde" value="${esc(p.get('desde') || '')}"></div>
      <div class="col-6 col-md-4 col-xl-2"><input class="form-control px-2" type="date" name="hasta" title="Hasta" value="${esc(p.get('hasta') || '')}"></div>
    </div></form>
    <div class="card"><div id="tablaT"></div></div>`;
  const form = qs('#filtrosT');
  const filtros = () => new URLSearchParams([...new FormData(form).entries()].filter(([, v]) => v));
  const cargar = async () => {
    history.replaceState(null, '', '#transacciones' + (filtros().toString() ? '?' + filtros() : ''));
    const r = await api('/api/admin/transacciones?' + filtros());
    if (!qs('#tablaT')) return;
    qs('#tablaT').innerHTML = `<div class="px-3 pt-3 small text-secondary">${r.resumen.cantidad} transacciones · total confirmado <strong>${pesos(r.resumen.total)}</strong>${r.transacciones.length < r.resumen.cantidad ? ` · mostrando las ${r.transacciones.length} más recientes` : ''}</div>
      <div class="table-responsive"><table class="table table-hover align-middle mb-0 small">
      <thead><tr><th>N.º</th><th>Fecha</th><th>Hora</th><th>Comprador / rol</th><th>Emprendimiento</th><th class="d-none d-lg-table-cell">Vendedor</th>
      <th class="num">Valor</th><th class="num d-none d-md-table-cell">Saldo anterior</th><th class="num">Saldo posterior</th><th>Estado</th><th></th></tr></thead>
      <tbody>${r.transacciones.map((t) => `<tr class="${t.estado === 'ANULADA' ? 'text-secondary' : ''}">
        <td>${t.id}</td><td>${fecha(t.fecha_hora)}</td><td>${hora(t.fecha_hora)}</td>
        <td><a href="#persona/${t.estudiante_id}" class="text-decoration-none">${esc(t.estudiante)}</a><div class="text-secondary">${esc(TIPOS[t.rol])}${t.curso ? ' · ' + esc(t.curso) : ''}</div></td>
        <td>${esc(t.emprendimiento)}</td><td class="d-none d-lg-table-cell">${esc(t.usuario_vendedor)}</td>
        <td class="num fw-semibold ${t.estado === 'ANULADA' ? 'text-decoration-line-through' : ''}">${pesos(t.valor)}</td>
        <td class="num d-none d-md-table-cell">${pesos(t.saldo_anterior)}</td><td class="num">${pesos(t.saldo_posterior)}</td>
        <td>${t.estado === 'ANULADA' ? `<span class="badge text-bg-secondary" title="${esc(t.anulada_por)}: ${esc(t.motivo_anulacion)}">Anulada</span>` : '<span class="badge text-bg-success">Confirmada</span>'}</td>
        <td class="text-end">${t.estado === 'CONFIRMADA' ? `<button class="btn btn-sm btn-outline-danger" data-anular="${t.id}" data-valor="${t.valor}" data-nombre="${esc(t.estudiante)}" title="Anular"><i class="bi bi-arrow-counterclockwise"></i></button>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="11" class="text-secondary p-3">No hay transacciones con esos filtros.</td></tr>'}</tbody></table></div>`;
    qs('#tablaT').querySelectorAll('[data-anular]').forEach((b) => b.addEventListener('click', () => anular(b.dataset.anular, Number(b.dataset.valor), b.dataset.nombre)));
  };
  let t;
  form.addEventListener('input', () => { clearTimeout(t); t = setTimeout(cargar, 300); });
  form.addEventListener('submit', (e) => { e.preventDefault(); cargar(); });
  C.querySelectorAll('[data-exportar]').forEach((b) => b.addEventListener('click', () => {
    location.href = `/api/admin/reportes/transacciones?formato=${b.dataset.exportar}&${filtros()}`;
  }));
  await cargar();
}

// ===================================================================== REPORTES
const REPORTES = [
  ['resumen', 'Resumen general de la feria', 'bi-clipboard-data'],
  ['estudiantes', 'Listado de personas y saldo', 'bi-people'],
  ['transacciones', 'Historial de transacciones', 'bi-receipt'],
  ['emprendimientos', 'Ventas por emprendimiento', 'bi-shop'],
  ['ventas-estudiante', 'Compras por persona', 'bi-person-lines-fill'],
  ['ventas-curso', 'Ventas por curso', 'bi-mortarboard'],
  ['ventas-rol', 'Ventas por rol', 'bi-person-badge'],
  ['recargas', 'Cargas y recargas de saldo', 'bi-wallet2'],
];
async function vistaReportes() {
  C.innerHTML = `
    <h1 class="h3 fw-bold mb-3">Reportes</h1>
    <div class="card p-3 mb-3"><div class="row g-2 align-items-end">
      <div class="col-6 col-md-3"><label class="form-label small">Desde</label><input type="date" class="form-control" id="rDesde"></div>
      <div class="col-6 col-md-3"><label class="form-label small">Hasta</label><input type="date" class="form-control" id="rHasta"></div>
      <div class="col-md-6 small text-secondary">Las fechas filtran las ventas y recargas. Déjelas vacías para ver toda la feria.</div>
    </div></div>
    <div class="row g-3 mb-3">${REPORTES.map(([id, titulo, icono]) => `<div class="col-md-6 col-xl-4"><div class="card p-3 h-100">
      <div class="fw-semibold mb-2"><i class="bi ${icono} text-primary"></i> ${titulo}</div>
      <div class="d-flex gap-2 mt-auto"><button class="btn btn-sm btn-primary" data-ver="${id}"><i class="bi bi-eye"></i> Ver</button>
      <button class="btn btn-sm btn-outline-success" data-bajar="${id}" data-formato="xlsx"><i class="bi bi-file-earmark-excel"></i> Excel</button>
      <button class="btn btn-sm btn-outline-secondary" data-bajar="${id}" data-formato="csv"><i class="bi bi-filetype-csv"></i> CSV</button></div></div></div>`).join('')}</div>
    <div class="card p-3 mb-3 d-flex flex-row flex-wrap align-items-center gap-2"><div class="fw-semibold me-auto"><i class="bi bi-qr-code text-primary"></i> PDF con todos los QR generados (12 por página)</div>
      <a class="btn btn-sm btn-primary" href="/api/admin/qr/pdf"><i class="bi bi-filetype-pdf"></i> Descargar PDF</a></div>
    <div id="rVista"></div>`;
  const rango = () => new URLSearchParams([['desde', qs('#rDesde').value], ['hasta', qs('#rHasta').value]].filter(([, v]) => v));
  C.querySelectorAll('[data-bajar]').forEach((b) => b.addEventListener('click', () => { location.href = `/api/admin/reportes/${b.dataset.bajar}?formato=${b.dataset.formato}&${rango()}`; }));
  C.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', async () => {
    const r = await api(`/api/admin/reportes/${b.dataset.ver}?${rango()}`);
    qs('#rVista').innerHTML = `<div class="card"><div class="p-3 pb-0"><h2 class="h5 fw-bold">${esc(r.titulo)} <small class="text-secondary fw-normal">(${r.filas.length} filas)</small></h2></div>
      <div class="table-responsive" style="max-height:70vh"><table class="table table-sm table-striped mb-0 small">
      <thead class="sticky-top bg-white"><tr>${r.columnas.map((c) => `<th class="${c.tipo === 'dinero' ? 'num' : ''}">${esc(c.titulo)}</th>`).join('')}</tr></thead>
      <tbody>${r.filas.map((f) => `<tr>${r.columnas.map((c) => `<td class="${c.tipo === 'dinero' ? 'num' : ''}">${c.tipo === 'dinero' ? pesos(f[c.clave]) : esc(f[c.clave])}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div></div>`;
    qs('#rVista').scrollIntoView({ behavior: 'smooth' });
  }));
}

// ===================================================================== CONFIGURACIÓN
async function vistaConfig() {
  const [cfg, admins, auditoria] = await Promise.all([api('/api/admin/config'), api('/api/admin/administradores'), api('/api/admin/auditoria')]);
  S.cfg = cfg;
  S.cursos = await api('/api/admin/cursos');
  C.innerHTML = `
    <h1 class="h3 fw-bold mb-3">Configuración</h1>
    <div class="row g-3">
      <div class="col-lg-6"><div class="card p-3 h-100"><h2 class="h5 fw-bold">Reglas de la feria</h2>
        <form id="formCfg">
          <div class="mb-3"><label class="form-label">Nombre de la feria</label><input class="form-control" name="nombre_feria" value="${esc(cfg.nombre_feria)}"></div>
          <div class="mb-3"><label class="form-label">Alerta de saldo bajo cuando sea menor que</label>
            <div class="input-group"><span class="input-group-text">$</span><input class="form-control" name="saldo_bajo" inputmode="numeric" value="${cfg.saldo_bajo.toLocaleString('es-CO')}"></div></div>
          <div class="row g-2 mb-3"><div class="col-6"><label class="form-label">Día 1 de la feria</label><input type="date" class="form-control" name="fecha_dia1" value="${esc(cfg.fecha_dia1)}"></div>
            <div class="col-6"><label class="form-label">Día 2 (último día)</label><input type="date" class="form-control" name="fecha_dia2" value="${esc(cfg.fecha_dia2)}"></div></div>
          <div class="form-check form-switch mb-2"><input class="form-check-input" type="checkbox" id="cfgLim" name="limite_diario_activo" value="1" ${cfg.limite_diario_activo ? 'checked' : ''}>
            <label class="form-check-label" for="cfgLim">Separar el saldo por día (el saldo del día 2 no se puede gastar antes del día 2)</label></div>
          <div class="input-group mb-1" style="max-width:340px"><span class="input-group-text">Primera carga: día 1</span><input class="form-control" name="porcentaje_dia1" type="number" min="1" max="100" value="${cfg.porcentaje_dia1}"><span class="input-group-text">%</span></div>
          <div class="form-text mb-3">Con 50 %, una primera carga de $25.000 queda en $12.500 para el día 1 y $12.500 reservados para el día 2.
            Desde la segunda recarga se elige el día (o dividir). El día 2 se puede gastar todo, incluido lo que sobró del día 1.</div>
          <div class="form-check form-switch mb-3"><input class="form-check-input" type="checkbox" id="cfgSolo" name="solo_dias_feria" value="1" ${cfg.solo_dias_feria ? 'checked' : ''}>
            <label class="form-check-label" for="cfgSolo">Permitir compras solo en los dos días de feria (desactívelo para hacer pruebas)</label></div>
          <p class="small text-secondary">Fecha de hoy en el servidor: ${fecha(cfg.hoy + ' 00:00:00')}</p>
          <button class="btn btn-primary"><i class="bi bi-check-lg"></i> Guardar configuración</button>
        </form></div></div>
      <div class="col-lg-6"><div class="card p-3 h-100"><h2 class="h5 fw-bold">Cursos / grados</h2>
        <form class="input-group mb-3" id="formCurso"><input class="form-control" name="nombre" placeholder="Ej.: 10A" maxlength="30"><button class="btn btn-primary"><i class="bi bi-plus-lg"></i> Agregar</button></form>
        <div style="max-height:360px;overflow:auto"><table class="table table-sm align-middle mb-0"><thead><tr><th>Curso</th><th class="num">Personas</th><th class="num">Emprend.</th><th></th></tr></thead>
        <tbody>${S.cursos.map((c) => `<tr><td class="fw-semibold">${esc(c.nombre)}</td><td class="num">${c.personas}</td><td class="num">${c.emprendimientos}</td>
          <td class="text-end"><button class="btn btn-sm btn-outline-secondary" data-renombrar="${c.id}" data-nombre="${esc(c.nombre)}"><i class="bi bi-pencil"></i></button>
          ${c.personas === 0 ? `<button class="btn btn-sm btn-outline-danger" data-borrar="${c.id}"><i class="bi bi-trash"></i></button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      </div></div>
      <div class="col-lg-6"><div class="card p-3"><div class="d-flex justify-content-between align-items-center mb-2"><h2 class="h5 fw-bold mb-0">Administradores</h2>
        <button class="btn btn-sm btn-primary" id="btnNuevoAdmin"><i class="bi bi-person-plus"></i> Nuevo</button></div>
        <table class="table table-sm align-middle mb-0"><thead><tr><th>Nombre</th><th>Usuario</th><th>Último ingreso</th><th></th></tr></thead>
        <tbody>${admins.map((a) => `<tr class="${a.activo ? '' : 'text-secondary'}"><td>${esc(a.nombre)}</td><td><code>${esc(a.usuario)}</code></td><td class="small">${fechaHora(a.ultimo_acceso) || '-'}</td>
          <td class="text-end text-nowrap"><button class="btn btn-sm btn-outline-secondary" data-clave="${a.id}" title="Cambiar contraseña"><i class="bi bi-key"></i></button>
          ${a.id !== S.yo.id ? `<button class="btn btn-sm ${a.activo ? 'btn-outline-danger' : 'btn-outline-success'}" data-activo="${a.id}" data-valor="${a.activo ? 0 : 1}">${a.activo ? 'Desactivar' : 'Activar'}</button>` : ''}</td></tr>`).join('')}</tbody></table>
      </div></div>
      <div class="col-lg-6"><div class="card p-3"><h2 class="h5 fw-bold">Registro de operaciones administrativas</h2>
        <div style="max-height:360px;overflow:auto"><table class="table table-sm small mb-0"><thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Operación</th><th>Detalle</th></tr></thead>
        <tbody>${auditoria.map((a) => `<tr><td class="text-nowrap">${fechaHora(a.fecha_hora)}</td><td>${esc(a.usuario || '')}</td><td>${esc(ACCIONES[a.accion] || a.accion)}</td>
          <td class="text-break">${esc((a.detalle || '').slice(0, 160))}</td></tr>`).join('') || '<tr><td colspan="4" class="text-secondary">Sin operaciones.</td></tr>'}</tbody></table></div>
      </div></div>
    </div>`;
  formatearDinero(qs('[name=saldo_bajo]'));
  qs('#formCfg').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target).entries());
    d.limite_diario_activo = !!d.limite_diario_activo;
    d.solo_dias_feria = !!d.solo_dias_feria;
    try { S.cfg = await api('/api/admin/config', { method: 'PUT', body: d }); qs('#nombreFeria').textContent = S.cfg.nombre_feria; aviso('Configuración guardada.'); } catch (ex) { aviso(ex.message, 'danger'); }
  });
  qs('#formCurso').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/admin/cursos', { method: 'POST', body: { nombre: e.target.nombre.value } }); aviso('Curso agregado.'); navegar(); } catch (ex) { aviso(ex.message, 'danger'); }
  });
  C.querySelectorAll('[data-renombrar]').forEach((b) => b.addEventListener('click', () => modal({
    titulo: 'Renombrar curso', cuerpo: `<form><input class="form-control" name="nombre" value="${b.dataset.nombre}"></form>`,
    botones: [{ texto: 'Cancelar', clase: 'btn-outline-secondary' }, { texto: 'Guardar', clase: 'btn-primary',
      accion: async (c) => { await api('/api/admin/cursos/' + b.dataset.renombrar, { method: 'PUT', body: datosForm(c) }); navegar(); } }],
  })));
  C.querySelectorAll('[data-borrar]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('¿Eliminar este curso?')) return;
    try { await api('/api/admin/cursos/' + b.dataset.borrar, { method: 'DELETE' }); navegar(); } catch (ex) { aviso(ex.message, 'danger'); }
  }));
  qs('#btnNuevoAdmin').addEventListener('click', () => modal({
    titulo: 'Nuevo administrador',
    cuerpo: `<form><div class="mb-2"><label class="form-label">Nombre</label><input class="form-control" name="nombre"></div>
      <div class="mb-2"><label class="form-label">Usuario</label><input class="form-control" name="usuario" autocapitalize="none"></div>
      <div class="mb-2"><label class="form-label">Contraseña (mínimo 6 caracteres)</label><input class="form-control" name="password" type="password" autocomplete="new-password"></div></form>`,
    botones: [{ texto: 'Cancelar', clase: 'btn-outline-secondary' }, { texto: 'Crear', clase: 'btn-primary',
      accion: async (c) => { await api('/api/admin/administradores', { method: 'POST', body: datosForm(c) }); aviso('Administrador creado.'); navegar(); } }],
  }));
  C.querySelectorAll('[data-clave]').forEach((b) => b.addEventListener('click', () => modal({
    titulo: 'Asignar contraseña', cuerpo: '<form><label class="form-label">Nueva contraseña (mínimo 6 caracteres)</label><input class="form-control" name="password" type="password" autocomplete="new-password"></form>',
    botones: [{ texto: 'Cancelar', clase: 'btn-outline-secondary' }, { texto: 'Guardar', clase: 'btn-primary',
      accion: async (c) => { await api('/api/admin/administradores/' + b.dataset.clave, { method: 'PUT', body: datosForm(c) }); aviso('Contraseña actualizada.'); } }],
  })));
  C.querySelectorAll('[data-activo]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('/api/admin/administradores/' + b.dataset.activo, { method: 'PUT', body: { activo: b.dataset.valor === '1' } }); navegar(); } catch (ex) { aviso(ex.message, 'danger'); }
  }));
}

qs('#btnCambiarClave').addEventListener('click', (e) => {
  e.preventDefault();
  modal({
    titulo: 'Cambiar mi contraseña',
    cuerpo: `<form><div class="mb-2"><label class="form-label">Contraseña actual</label><input class="form-control" type="password" name="actual" autocomplete="current-password"></div>
      <div class="mb-2"><label class="form-label">Nueva contraseña (mínimo 6 caracteres)</label><input class="form-control" type="password" name="nueva" autocomplete="new-password"></div></form>`,
    botones: [{ texto: 'Cancelar', clase: 'btn-outline-secondary' }, { texto: 'Cambiar', clase: 'btn-primary',
      accion: async (c) => { await api('/api/auth/cambiar-password', { method: 'POST', body: datosForm(c) }); aviso('Contraseña cambiada.'); } }],
  });
});

// ===================================================================== INICIO
(async () => {
  try {
    S.yo = await api('/api/auth/yo');
    qs('#nombreUsuario').textContent = S.yo.nombre;
    qs('#nombreFeria').textContent = S.yo.feria;
    qs('#nombreFeria').title = S.yo.feria;
    await cargarCatalogos();
    navegar();
  } catch (e) { errorPantalla(e); }
})();
