'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// La zona horaria debe fijarse antes de crear cualquier fecha.
process.env.TZ = process.env.TZ || 'America/Bogota';

// En hostings como Railway o Render la base llega como una URL: mysql://usuario:clave@host:puerto/base
const urlBD = process.env.DATABASE_URL || process.env.MYSQL_URL || '';
let desdeUrl = {};
if (urlBD) {
  const u = new URL(urlBD);
  desdeUrl = {
    host: u.hostname, port: u.port || 3306, user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password), database: decodeURIComponent(u.pathname.replace(/^\//, '')),
  };
}
// DB_SSL=1 cifra la conexión con MySQL (lo exigen la mayoría de bases en la nube).
// DB_SSL=sin-verificar cifra sin validar el certificado del proveedor.
// DB_SSL_CA: certificado del proveedor (Aiven lo entrega como ca.pem), pegado como texto o ruta a un archivo.
const fs = require('fs');
const caTexto = process.env.DB_SSL_CA || '';
const ca = !caTexto ? undefined : caTexto.includes('BEGIN CERTIFICATE') ? caTexto.replace(/\\n/g, '\n')
  : fs.readFileSync(path.resolve(__dirname, '..', caTexto), 'utf8');
const ssl = process.env.DB_SSL === '1' || ca ? { rejectUnauthorized: true, ...(ca ? { ca } : {}) }
  : process.env.DB_SSL === 'sin-verificar' ? { rejectUnauthorized: false } : undefined;

// TRUST_PROXY indica cuántos proxys hay delante del servidor (nginx, Render, Railway...).
// Por defecto solo se confía en un proxy en la misma máquina.
const proxy = process.env.TRUST_PROXY;
const trustProxy = !proxy ? 'loopback' : /^\d+$/.test(proxy) ? Number(proxy) : proxy === 'true' ? true : proxy;

module.exports = {
  port: Number(process.env.PORT || 3000),
  https: process.env.HTTPS === '1',
  httpsPort: Number(process.env.HTTPS_PORT || 3443),
  sslKey: path.resolve(__dirname, '..', process.env.SSL_KEY || 'certs/clave.pem'),
  sslCert: path.resolve(__dirname, '..', process.env.SSL_CERT || 'certs/certificado.pem'),
  trustProxy,
  sessionSecret: process.env.SESSION_SECRET || 'cambie-esta-frase-secreta',
  db: {
    host: desdeUrl.host || process.env.DB_HOST || 'localhost',
    port: Number(desdeUrl.port || process.env.DB_PORT || 3306),
    user: desdeUrl.user || process.env.DB_USER || 'root',
    password: urlBD ? desdeUrl.password : (process.env.DB_PASSWORD || ''),
    database: desdeUrl.database || process.env.DB_NAME || 'feria_qr',
    ...(ssl ? { ssl } : {}),
  },
  admin: {
    usuario: process.env.ADMIN_USUARIO || 'admin',
    password: process.env.ADMIN_PASSWORD || 'Admin2026!',
    nombre: process.env.ADMIN_NOMBRE || 'Administrador',
  },
};
