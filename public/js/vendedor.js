/* Módulo de ventas: ESCANEAR QR → VER SALDO → INGRESAR VALOR → CONFIRMAR COMPRA */
'use strict';

const $ = (id) => document.getElementById(id);
const VISTAS = ['vEscanear', 'vSaldo', 'vConfirmar', 'vResultado', 'vVentas'];
const estado = { qr: null, info: null, valor: 0, codigo: null, enviando: false, pendiente: false, enLinea: navigator.onLine };
let camara = null;

function mostrar(vista, paso) {
  VISTAS.forEach((v) => $(v).classList.toggle('d-none', v !== vista));
  $('pasos').classList.toggle('d-none', vista === 'vVentas');
  document.querySelectorAll('#pasos span').forEach((s) => s.classList.toggle('activo', Number(s.dataset.paso) <= (paso || 0)));
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- conexión
function actualizarRed(enLinea) {
  estado.enLinea = enLinea;
  $('bannerRed').classList.toggle('d-none', enLinea);
  $('btnConfirmar').disabled = !enLinea || estado.enviando;
}
window.addEventListener('online', () => verificarRed());
window.addEventListener('offline', () => actualizarRed(false));
async function verificarRed() {
  try { await api('/api/ping', { timeout: 5000 }); actualizarRed(true); } catch (e) { actualizarRed(!(e instanceof ErrorRed)); }
}
setInterval(verificarRed, 10000);

// ---------------------------------------------------------------- paso 1: escanear
function camaraDisponible() {
  return window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
}

async function abrirCamara() {
  if (!camaraDisponible()) {
    $('avisoHttps').innerHTML = '<i class="bi bi-exclamation-triangle"></i> El navegador solo permite la cámara en direcciones <strong>https://</strong>. '
      + 'Pida al administrador la dirección segura, o use <strong>Foto del QR</strong>.';
    $('avisoHttps').classList.remove('d-none');
    return;
  }
  $('btnEscanear').classList.add('d-none');
  $('zonaCamara').classList.remove('d-none');
  try {
    camara = camara || new Html5Qrcode('lector', { verbose: false });
    await camara.start({ facingMode: 'environment' }, { fps: 12, qrbox: (w, h) => { const m = Math.floor(Math.min(w, h) * 0.75); return { width: m, height: m }; } },
      (texto) => { cerrarCamara().then(() => consultar(texto)); }, () => {});
  } catch (e) {
    await cerrarCamara();
    $('avisoHttps').textContent = 'No se pudo abrir la cámara. Revise que el navegador tenga permiso para usarla, o use "Foto del QR".';
    $('avisoHttps').classList.remove('d-none');
  }
}

async function cerrarCamara() {
  if (camara && camara.isScanning) { try { await camara.stop(); } catch (_) { /* nada */ } }
  $('zonaCamara').classList.add('d-none');
  $('btnEscanear').classList.remove('d-none');
}

$('btnEscanear').addEventListener('click', abrirCamara);
$('btnCancelarCamara').addEventListener('click', cerrarCamara);
$('btnManual').addEventListener('click', () => { $('formManual').classList.toggle('d-none'); $('codigoManual').focus(); });
$('formManual').addEventListener('submit', (e) => { e.preventDefault(); consultar($('codigoManual').value); });
$('fotoQR').addEventListener('change', async (e) => {
  const archivo = e.target.files[0];
  e.target.value = '';
  if (!archivo) return;
  try {
    const lector = new Html5Qrcode('lectorArchivo', { verbose: false });
    const texto = await lector.scanFile(archivo, false);
    consultar(texto);
  } catch (_) {
    aviso('No se encontró un código QR en la foto. Intente de nuevo, más cerca y con buena luz.', 'warning');
  }
});

// ---------------------------------------------------------------- paso 2: ver saldo
async function consultar(textoQR) {
  if (!estado.enLinea) { aviso('Sin conexión: no se puede consultar el saldo.', 'danger'); return; }
  try {
    const info = await api('/api/ventas/consultar', { method: 'POST', body: { qr: textoQR } });
    estado.qr = textoQR;
    estado.info = info;
    estado.codigo = nuevoCodigoOperacion();
    estado.pendiente = false;
    pintarSaldo();
  } catch (e) {
    if (e instanceof ErrorRed) { actualizarRed(false); aviso('Sin conexión: no se puede consultar el saldo.', 'danger'); return; }
    const bloqueada = e.datos && e.datos.alerta === 'BLOQUEADA';
    resultado(bloqueada ? 'bi-lock-fill text-danger' : 'bi-x-octagon-fill text-danger',
      bloqueada ? 'Cuenta bloqueada' : 'QR no válido', e.message, 'danger');
  }
}

function pintarSaldo() {
  const i = estado.info;
  $('cNombre').textContent = i.nombre;
  $('cCurso').textContent = i.curso ? `Curso ${i.curso}` : (i.tipo || '').toLowerCase().replace(/^./, (c) => c.toUpperCase());
  // Lo que importa al vendedor es lo que se puede gastar HOY
  $('cSaldo').textContent = pesos(i.disponible_hoy);
  $('cSaldo').className = 'saldo-grande ' + (i.disponible_hoy === 0 ? 'text-danger' : i.disponible_hoy < i.saldo_bajo ? 'text-warning' : 'text-success');
  $('cEtiqueta').textContent = i.reservado_dia2 > 0 ? 'DISPONIBLE HOY' : 'SALDO DISPONIBLE';
  let alerta = '';
  if (i.reservado_dia2 > 0) alerta += `<div class="text-secondary mt-1"><i class="bi bi-lock"></i> Reservado para el día 2: <strong>${pesos(i.reservado_dia2)}</strong></div>`;
  if (i.mensaje) {
    alerta += `<div class="alert alert-danger fw-bold fs-5 mt-2 mb-0"><i class="bi bi-exclamation-octagon"></i> ${esc(i.mensaje)}</div>`;
  } else if (i.disponible_hoy < i.saldo_bajo) {
    alerta += '<div class="alert alert-warning fw-semibold mt-2 mb-0 py-2"><i class="bi bi-exclamation-triangle"></i> Saldo bajo</div>';
  }
  $('cAlerta').innerHTML = alerta;
  const sinSaldo = i.disponible_hoy <= 0;
  $('formValor').querySelectorAll('input, #montosRapidos button, #btnContinuar').forEach((el) => { el.disabled = sinSaldo; });
  $('valor').value = '';
  $('errorValor').classList.add('d-none');
  mostrar('vSaldo', 3);
  if (!sinSaldo) setTimeout(() => $('valor').focus(), 100);
}

// ---------------------------------------------------------------- paso 3: ingresar valor
formatearDinero($('valor'));
[500, 1000, 2000, 5000, 10000].forEach((m) => {
  const col = document.createElement('div');
  col.className = 'col-4';
  col.innerHTML = `<button type="button" class="btn btn-outline-primary monto-rapido w-100">+${pesos(m).replace('$', '')}</button>`;
  col.firstChild.addEventListener('click', () => {
    const actual = aEntero($('valor').value) || 0;
    $('valor').value = (actual + m).toLocaleString('es-CO');
  });
  $('montosRapidos').appendChild(col);
});
const colBorrar = document.createElement('div');
colBorrar.className = 'col-4';
colBorrar.innerHTML = '<button type="button" class="btn btn-outline-secondary monto-rapido w-100" title="Borrar"><i class="bi bi-backspace"></i> Borrar</button>';
colBorrar.firstChild.addEventListener('click', () => { $('valor').value = ''; $('valor').focus(); });
$('montosRapidos').appendChild(colBorrar);

function errorValor(msg) {
  $('errorValor').textContent = msg;
  $('errorValor').classList.remove('d-none');
}

$('formValor').addEventListener('submit', async (e) => {
  e.preventDefault();
  const valor = aEntero($('valor').value);
  if (!valor || valor <= 0) return errorValor('Ingrese el valor de la compra.');
  const i = estado.info;
  // Verificación inmediata con el saldo consultado...
  if (valor > i.disponible_hoy) {
    return errorValor(`Saldo insuficiente. Saldo disponible: ${pesos(i.disponible_hoy)}.${i.reservado_dia2 > 0 ? ` (${pesos(i.reservado_dia2)} más están reservados para el día 2)` : ''}`);
  }
  $('btnContinuar').disabled = true;
  try {
    // ...y verificación con el servidor (saldo actualizado al instante)
    const v = await api('/api/ventas/validar', { method: 'POST', body: { qr: estado.qr, valor } });
    estado.valor = valor;
    Object.assign(estado.info, { saldo: v.saldo, disponible_hoy: v.disponible_hoy, reservado_dia2: v.reservado_dia2 });
    $('kNombre').textContent = v.nombre;
    $('kValor').textContent = pesos(valor);
    $('kAnterior').textContent = pesos(v.saldo_anterior);
    $('kRestante').textContent = pesos(v.saldo_restante);
    $('kReservado').innerHTML = v.reservado_dia2 > 0
      ? `Hoy le quedarán <strong>${pesos(v.disponible_restante)}</strong> para gastar; ${pesos(v.reservado_dia2)} siguen reservados para el día 2.` : '';
    $('errorConfirmar').classList.add('d-none');
    $('btnConfirmar').innerHTML = '<i class="bi bi-check-circle"></i> CONFIRMAR COMPRA';
    actualizarRed(estado.enLinea);
    mostrar('vConfirmar', 4);
  } catch (ex) {
    if (ex instanceof ErrorRed) { actualizarRed(false); errorValor('Sin conexión. No se puede verificar el saldo ahora.'); } else errorValor(ex.message);
  } finally {
    $('btnContinuar').disabled = false;
  }
});

// ---------------------------------------------------------------- paso 4: confirmar
$('btnVolver').addEventListener('click', () => {
  if (estado.pendiente && !confirm('La última confirmación no tuvo respuesta. ¿Seguro que desea cambiar el valor? Primero intente "Reintentar".')) return;
  if (estado.pendiente) { estado.codigo = nuevoCodigoOperacion(); estado.pendiente = false; }
  mostrar('vSaldo', 3);
});

$('btnConfirmar').addEventListener('click', async () => {
  if (estado.enviando) return; // evita doble toque
  estado.enviando = true;
  $('btnConfirmar').disabled = true;
  $('btnConfirmar').innerHTML = '<span class="spinner-border spinner-border-sm"></span> Registrando...';
  try {
    const r = await api('/api/ventas/compras', {
      method: 'POST', timeout: 20000,
      body: { qr: estado.qr, valor: estado.valor, codigo_operacion: estado.codigo },
    });
    estado.pendiente = false;
    if (navigator.vibrate) navigator.vibrate(120);
    const saldoFinal = r.saldo_actual ?? r.saldo_posterior;
    let detalle = `<div class="fs-5">${esc(estado.info.nombre)}</div>
      <div class="confirmacion mt-3 text-start">
        <div class="linea"><span>Compra:</span><strong>${pesos(r.valor)}</strong></div>
        <div class="linea"><span>Saldo anterior:</span><strong>${pesos(r.saldo_anterior)}</strong></div>
        <div class="linea"><span>Nuevo saldo:</span><strong class="text-success">${pesos(saldoFinal)}</strong></div>
      </div>`;
    if (r.duplicada) detalle += '<div class="alert alert-info mt-3 mb-0">Esta compra ya había quedado registrada. <strong>No se cobró dos veces.</strong></div>';
    if (saldoFinal === 0) detalle += '<div class="alert alert-danger fw-bold mt-3 mb-0">Saldo agotado. Esta persona no puede realizar más compras.</div>';
    else if (r.reservado_dia2 > 0 && r.disponible_hoy === 0) detalle += `<div class="alert alert-warning fw-semibold mt-3 mb-0">Saldo del día 1 agotado. Tiene ${pesos(r.reservado_dia2)} reservados para el día 2.</div>`;
    else if (r.reservado_dia2 > 0) detalle += `<div class="alert alert-info mt-3 mb-0">Puede gastar hoy ${pesos(r.disponible_hoy)} más · reservado día 2: ${pesos(r.reservado_dia2)}</div>`;
    else if (typeof r.disponible_hoy === 'number' && r.disponible_hoy < estado.info.saldo_bajo) detalle += `<div class="alert alert-warning fw-semibold mt-3 mb-0">Saldo bajo: le quedan ${pesos(r.disponible_hoy)}.</div>`;
    resultado('bi-check-circle-fill text-success', 'Compra registrada', detalle, 'success', true);
  } catch (e) {
    if (e instanceof ErrorRed || e.status >= 500) {
      // No sabemos si la compra llegó al servidor: conservar el mismo código para reintentar sin duplicar.
      estado.pendiente = true;
      if (e instanceof ErrorRed) actualizarRed(false);
      $('errorConfirmar').innerHTML = `<i class="bi bi-wifi-off"></i> <strong>La compra NO se pudo confirmar.</strong> No entregue el producto todavía.<br>
        <span class="fw-normal">${e instanceof ErrorRed ? 'Se perdió la conexión.' : esc(e.message)} Cuando vuelva la conexión toque <strong>Reintentar</strong>:
        si la compra ya había quedado registrada, el sistema lo detecta y no la cobra dos veces.</span>`;
      $('errorConfirmar').classList.remove('d-none');
      $('btnConfirmar').innerHTML = '<i class="bi bi-arrow-repeat"></i> REINTENTAR';
    } else {
      // Rechazo del servidor (saldo insuficiente, cuenta bloqueada, límite del día...)
      estado.pendiente = false;
      estado.codigo = nuevoCodigoOperacion();
      if (e.datos && typeof e.datos.disponible_hoy === 'number') {
        Object.assign(estado.info, { saldo: e.datos.saldo, disponible_hoy: e.datos.disponible_hoy });
        if (['AGOTADO', 'DIA_AGOTADO'].includes(e.datos.alerta)) estado.info.mensaje = e.message;
        pintarSaldo();
      } else mostrar('vSaldo', 3);
      errorValor(e.message);
    }
  } finally {
    estado.enviando = false;
    $('btnConfirmar').disabled = !estado.enLinea;
    if (!estado.pendiente) $('btnConfirmar').innerHTML = '<i class="bi bi-check-circle"></i> CONFIRMAR COMPRA';
  }
});

// ---------------------------------------------------------------- resultado y reinicio
function resultado(icono, titulo, html, tipo, esHtml) {
  $('rTarjeta').className = `card p-4 mb-3 text-center border border-2 border-${tipo}`;
  $('rTarjeta').innerHTML = `<i class="bi ${icono} resultado-icono"></i><h2 class="fw-bold mt-2">${esc(titulo)}</h2>
    ${esHtml ? html : `<p class="fs-5 mb-0">${esc(html)}</p>`}`;
  mostrar('vResultado', esHtml ? 4 : 1);
}

function reiniciar(abrir) {
  if (estado.pendiente && !confirm('La última compra no se pudo confirmar. Si sale ahora, NO quedará registrada. ¿Salir de todos modos?')) return;
  Object.assign(estado, { qr: null, info: null, valor: 0, codigo: null, pendiente: false });
  $('formManual').classList.add('d-none');
  $('codigoManual').value = '';
  $('avisoHttps').classList.add('d-none');
  mostrar('vEscanear', 1);
  if (abrir && camaraDisponible()) abrirCamara();
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-accion="reiniciar"]');
  if (b) reiniciar(b.closest('#vResultado') !== null);
});

// ---------------------------------------------------------------- mis ventas
async function cargarVentas() {
  if (estado.pendiente) { aviso('Primero resuelva la compra pendiente.', 'warning'); return; }
  await cerrarCamara();
  mostrar('vVentas');
  $('listaVentas').innerHTML = '<div class="p-3 text-secondary">Cargando...</div>';
  try {
    const r = await api('/api/ventas/mis-ventas');
    $('vHoy').textContent = pesos(r.resumen.total_hoy);
    $('vHoyN').textContent = `${r.resumen.cantidad_hoy} ventas`;
    $('vTotal').textContent = pesos(r.resumen.total);
    $('vTotalN').textContent = `${r.resumen.cantidad} ventas`;
    $('listaVentas').innerHTML = r.ventas.length ? r.ventas.map((v) => `
      <div class="list-group-item d-flex justify-content-between align-items-center ${v.estado === 'ANULADA' ? 'text-decoration-line-through text-secondary' : ''}">
        <div><div class="fw-semibold">${esc(v.comprador)}</div>
          <div class="small text-secondary">${fechaHora(v.fecha_hora)} · ${esc(v.curso || (v.rol || '').charAt(0) + (v.rol || '').slice(1).toLowerCase())}${v.estado === 'ANULADA' ? ' · ANULADA' : ''}</div></div>
        <div class="fw-bold fs-5 num">${pesos(v.valor)}</div>
      </div>`).join('') : '<div class="p-3 text-secondary">Todavía no hay ventas.</div>';
  } catch (e) {
    $('listaVentas').innerHTML = `<div class="p-3 text-danger">${e instanceof ErrorRed ? 'Sin conexión.' : esc(e.message)}</div>`;
  }
}
$('btnTabVentas').addEventListener('click', cargarVentas);

// ---------------------------------------------------------------- inicio
(async () => {
  try {
    const yo = await api('/api/auth/yo');
    $('nombreEmp').textContent = yo.emprendimiento || 'Ventas';
    document.title = `${yo.emprendimiento} · Ventas`;
  } catch (_) { /* api() ya redirige al login si hace falta */ }
  verificarRed();
  mostrar('vEscanear', 1);
})();
window.addEventListener('beforeunload', (e) => { if (estado.pendiente) { e.preventDefault(); e.returnValue = ''; } });
