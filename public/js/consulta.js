/* Consulta de saldo e historial para compradores (sin usuario ni contraseña) */
'use strict';
const $ = (id) => document.getElementById(id);
let camara = null;
let codigoActual = null;
const fechaCorta = (f) => (f ? fecha(f + ' 00:00:00') : '');

async function consultar(texto) {
  try {
    const r = await api('/api/publico/consulta', { method: 'POST', body: { qr: texto } });
    codigoActual = texto;
    pintar(r);
  } catch (e) {
    aviso(e instanceof ErrorRed ? 'Sin conexión con el servidor de la feria.' : e.message, 'danger');
  }
}

function pintar(r) {
  $('nombre').textContent = r.nombre;
  $('curso').textContent = r.curso ? `Curso ${r.curso}` : r.tipo.charAt(0) + r.tipo.slice(1).toLowerCase();
  $('bloqueada').innerHTML = r.estado === 'BLOQUEADA' ? '<div class="alert alert-danger py-2 mt-2 mb-0"><i class="bi bi-lock-fill"></i> Cuenta bloqueada. Acérquese a la administración.</div>' : '';
  // Feria de un solo día: todo el saldo se puede gastar hoy; lo que no se gaste queda en la cuenta.
  $('hoy').textContent = pesos(r.saldo);
  $('hoy').className = 'saldo-grande ' + (r.saldo === 0 ? 'text-danger' : 'text-success');
  $('queda').textContent = r.saldo === 0 ? 'Ya gastaste todo tu saldo.'
    : r.disponible_hoy === 0 ? '' : `Puedes gastarlo todo el día de la feria. Si no lo gastas, te quedan ${pesos(r.saldo)} en tu cuenta.`;
  $('cargado').textContent = pesos(r.total_cargado);
  $('gastado').textContent = pesos(r.total_gastado);
  $('regla').textContent = r.regla || (r.fecha_feria ? `Día de la feria: ${fechaCorta(r.fecha_feria)}` : '');
  $('compras').innerHTML = r.compras.map((c) => `<tr class="${c.estado === 'ANULADA' ? 'text-secondary text-decoration-line-through' : ''}">
    <td class="ps-3 small">${fecha(c.fecha_hora)}<br>${hora(c.fecha_hora)}</td><td>${esc(c.emprendimiento)}${c.estado === 'ANULADA' ? ' (anulada)' : ''}</td>
    <td class="num fw-semibold">${pesos(c.valor)}</td><td class="num pe-3">${pesos(c.saldo_posterior)}</td></tr>`).join('')
    || '<tr><td colspan="4" class="text-secondary ps-3">Todavía no tiene compras.</td></tr>';
  $('recargas').innerHTML = r.recargas.map((x) => `<div class="list-group-item d-flex justify-content-between">
    <div><div class="fw-semibold">${x.tipo === 'INICIAL' ? 'Saldo inicial' : x.tipo === 'RECARGA' ? 'Recarga' : 'Ajuste'}</div>
    <div class="small text-secondary">${fechaHora(x.fecha_hora)} · saldo después: ${pesos(x.saldo_nuevo)}</div></div>
    <div class="fw-bold num ${x.valor < 0 ? 'text-danger' : 'text-success'}">${x.valor < 0 ? '-' : '+'}${pesos(Math.abs(x.valor))}</div></div>`).join('')
    || '<div class="list-group-item text-secondary">Sin cargas.</div>';
  $('vBuscar').classList.add('d-none');
  $('vCuenta').classList.remove('d-none');
  window.scrollTo(0, 0);
}

async function abrirCamara() {
  if (!(window.isSecureContext && navigator.mediaDevices)) {
    $('aviso').textContent = 'La cámara solo funciona en direcciones https://. Use "Tomar foto de mi QR" o escriba el código.';
    $('aviso').classList.remove('d-none');
    return;
  }
  $('btnEscanear').classList.add('d-none');
  $('zonaCamara').classList.remove('d-none');
  try {
    camara = camara || new Html5Qrcode('lector', { verbose: false });
    await camara.start({ facingMode: 'environment' }, { fps: 12, qrbox: 230 }, (t) => { cerrarCamara().then(() => consultar(t)); }, () => {});
  } catch (_) {
    await cerrarCamara();
    $('aviso').textContent = 'No se pudo abrir la cámara. Use "Tomar foto de mi QR" o escriba el código.';
    $('aviso').classList.remove('d-none');
  }
}
async function cerrarCamara() {
  if (camara && camara.isScanning) { try { await camara.stop(); } catch (_) { /* nada */ } }
  $('zonaCamara').classList.add('d-none');
  $('btnEscanear').classList.remove('d-none');
}

$('btnEscanear').addEventListener('click', abrirCamara);
$('btnCerrar').addEventListener('click', cerrarCamara);
$('formCodigo').addEventListener('submit', (e) => { e.preventDefault(); consultar($('codigo').value); });
$('fotoQR').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try { consultar(await new Html5Qrcode('lectorArchivo', { verbose: false }).scanFile(f, false)); } catch (_) { aviso('No se encontró un QR en la foto.', 'warning'); }
});
$('btnActualizar').addEventListener('click', () => consultar(codigoActual));
$('btnOtra').addEventListener('click', () => {
  codigoActual = null;
  $('codigo').value = '';
  $('vCuenta').classList.add('d-none');
  $('vBuscar').classList.remove('d-none');
});
