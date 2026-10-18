/* Funciones compartidas por todas las páginas */
'use strict';

/** Escapa texto para insertarlo en HTML de forma segura. */
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** $25.000 */
function pesos(n) {
  return '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');
}

/** '2026-11-09 08:15:00' → '09/11/2026' y '8:15' */
function fecha(f) { if (!f) return ''; const [d] = f.split(' '); const [a, m, dd] = d.split('-'); return `${dd}/${m}/${a}`; }
function hora(f) { if (!f) return ''; const t = f.split(' ')[1] || ''; const [h, mi] = t.split(':'); return `${parseInt(h, 10)}:${mi}`; }
function fechaHora(f) { return f ? `${fecha(f)} ${hora(f)}` : ''; }

/** Convierte "25.000" o "$25000" en 25000. */
function aEntero(v) {
  const s = String(v ?? '').replace(/[$\s.]/g, '');
  return /^\d+$/.test(s) ? parseInt(s, 10) : NaN;
}

class ErrorRed extends Error {}
/** La pantalla que pidió los datos ya se cerró (el usuario cambió de pestaña): se ignora. */
class ErrorNavegacion extends Error {}
window.addEventListener('unhandledrejection', (e) => { if (e.reason instanceof ErrorNavegacion) e.preventDefault(); });

/**
 * Llama a la API. Lanza ErrorRed si no hubo conexión (la operación no se sabe si llegó),
 * o Error con el mensaje del servidor (y .datos con la respuesta completa).
 */
async function api(url, opciones = {}) {
  const o = { method: 'GET', headers: {}, credentials: 'same-origin', ...opciones };
  if (o.body && typeof o.body !== 'string') { o.body = JSON.stringify(o.body); o.headers['Content-Type'] = 'application/json'; }
  let res;
  const ctrl = new AbortController();
  const esConsulta = o.method === 'GET';
  // Las consultas esperan más: en hostings gratuitos el servidor puede tardar en "despertar"
  const t = setTimeout(() => ctrl.abort(), opciones.timeout || (esConsulta ? 75000 : 15000));
  // Las consultas de una pantalla se cancelan si el usuario se va a otra pestaña
  const nav = esConsulta ? window.senalNavegacion : null;
  const cancelar = () => ctrl.abort();
  if (nav) { if (nav.aborted) throw new ErrorNavegacion('Pantalla cerrada'); nav.addEventListener('abort', cancelar); }
  try {
    res = await fetch(url, { ...o, signal: ctrl.signal });
  } catch (e) {
    if (nav && nav.aborted) throw new ErrorNavegacion('Pantalla cerrada');
    throw new ErrorRed('Sin conexión con el servidor.');
  } finally {
    clearTimeout(t);
    if (nav) nav.removeEventListener('abort', cancelar);
  }
  let datos = null;
  try { datos = await res.json(); } catch (_) { /* sin cuerpo */ }
  // 401 en la pantalla de inicio = usuario o contraseña incorrectos; en otra pantalla = la sesión venció
  if (res.status === 401 && !location.pathname.startsWith('/login')) {
    location.href = '/login.html';
    throw new Error('Su sesión terminó.');
  }
  if (!res.ok) {
    const err = new Error((datos && datos.error) || `Error ${res.status}`);
    err.status = res.status;
    err.datos = datos || {};
    throw err;
  }
  return datos;
}

/** Mensaje flotante breve. tipo: success | danger | warning | info */
function aviso(mensaje, tipo = 'success') {
  if (mensaje === 'Pantalla cerrada') return; // consulta cancelada al cambiar de pestaña
  let cont = document.getElementById('avisos');
  if (!cont) {
    cont = document.createElement('div');
    cont.id = 'avisos';
    cont.className = 'toast-container position-fixed bottom-0 end-0 p-3';
    cont.style.zIndex = 2000;
    document.body.appendChild(cont);
  }
  const el = document.createElement('div');
  el.className = `toast align-items-center text-bg-${tipo} border-0`;
  el.setAttribute('role', 'alert');
  el.innerHTML = `<div class="d-flex"><div class="toast-body fw-semibold">${esc(mensaje)}</div>
    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
  cont.appendChild(el);
  const t = new bootstrap.Toast(el, { delay: tipo === 'danger' ? 6000 : 3500 });
  t.show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}

/** Identificador único para cada intento de compra (funciona también sin HTTPS). */
function nuevoCodigoOperacion() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

async function cerrarSesion() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) { /* nada */ }
  location.href = '/login.html';
}

/** Formatea un input de dinero mientras se escribe: 25000 → 25.000 */
function formatearDinero(input) {
  input.addEventListener('input', () => {
    const n = aEntero(input.value);
    input.value = Number.isNaN(n) ? input.value.replace(/[^\d]/g, '') : n.toLocaleString('es-CO');
  });
}
