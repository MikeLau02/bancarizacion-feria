'use strict';
const config = require('./config');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const { pool } = require('./db');
const { cargarUsuario, requiereRol, paginaPara } = require('./middleware/auth');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

// Cabeceras básicas de seguridad
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
  next();
});

app.use(express.json({ limit: '5mb' }));

// Sesiones guardadas en MySQL: sobreviven a reinicios del servidor
const store = new MySQLStore({ createDatabaseTable: true, clearExpired: true, checkExpirationInterval: 15 * 60 * 1000 }, pool);
app.use(session({
  name: 'feria.sid',
  secret: config.sessionSecret,
  store,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 14 * 60 * 60 * 1000 },
}));
app.use(cargarUsuario);

// Las API nunca se guardan en caché: el saldo siempre viene del servidor
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Comprobación de conexión (la usa el vendedor para saber si hay red)
app.get('/api/ping', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, hora: Date.now() }); } catch (e) { res.status(503).json({ ok: false }); }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/publico', require('./routes/publico'));
app.use('/api/ventas', requiereRol('VENDEDOR'), require('./routes/ventas'));
app.use('/api/admin/reportes', requiereRol('ADMIN'), require('./routes/reportes'));
app.use('/api/admin', requiereRol('ADMIN'), require('./routes/admin'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// Librerías del navegador servidas localmente: la feria funciona aunque no haya Internet, solo red local
const nm = (p) => path.join(__dirname, '..', 'node_modules', p);
app.use('/vendor/bootstrap', express.static(nm('bootstrap/dist')));
app.use('/vendor/bootstrap-icons', express.static(nm('bootstrap-icons/font')));
app.use('/vendor/html5-qrcode', express.static(nm('html5-qrcode')));

// Páginas protegidas por rol
const publico = path.join(__dirname, '..', 'public');
app.use('/admin', paginaPara('ADMIN'), express.static(path.join(publico, 'admin')));
app.use('/vendedor', paginaPara('VENDEDOR'), express.static(path.join(publico, 'vendedor')));
app.use('/consulta', express.static(path.join(publico, 'consulta'))); // consulta de saldo para compradores (pública)
app.get('/', (req, res) => {
  if (!req.usuario) return res.redirect('/login.html');
  res.redirect(req.usuario.rol === 'ADMIN' ? '/admin/' : '/vendedor/');
});
app.use(express.static(publico, { index: false }));

// Manejo de errores: mensajes claros para el usuario, detalles solo en la consola
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.status && err.status < 500) {
    return res.status(err.status).json({ error: err.message, ...err.extra });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Datos mal formados.' });
  console.error(new Date().toISOString(), req.method, req.originalUrl, err);
  const sinBD = ['ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR'].includes(err.code);
  res.status(sinBD ? 503 : 500).json({
    error: sinBD ? 'No hay conexión con la base de datos. La operación NO se realizó.' : 'Error interno. La operación NO se realizó.',
  });
});

function direccionesLocales() {
  const os = require('os');
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}

async function iniciar() {
  try {
    await pool.query('SELECT 1 FROM configuracion LIMIT 1');
  } catch (err) {
    console.error('\n✖ No se pudo conectar a MySQL o la base de datos no está creada.');
    console.error('  Revise el archivo .env y ejecute "npm run db:init".\n  Detalle:', err.message, '\n');
    process.exit(1);
  }
  http.createServer(app).listen(config.port, () => {
    console.log(`\n✔ Feria QR funcionando en http://localhost:${config.port}`);
    for (const ip of direccionesLocales()) console.log(`  En la red local: http://${ip}:${config.port}`);
  });
  if (config.https) {
    if (!fs.existsSync(config.sslKey) || !fs.existsSync(config.sslCert)) {
      console.error('✖ HTTPS=1 pero no se encontró el certificado. Ejecute "npm run cert".');
    } else {
      https.createServer({ key: fs.readFileSync(config.sslKey), cert: fs.readFileSync(config.sslCert) }, app).listen(config.httpsPort, () => {
        console.log(`✔ HTTPS (cámara en celulares) en https://localhost:${config.httpsPort}`);
        for (const ip of direccionesLocales()) console.log(`  Celulares y tabletas: https://${ip}:${config.httpsPort}`);
      });
    }
  }
}

if (require.main === module) iniciar();
module.exports = app;
