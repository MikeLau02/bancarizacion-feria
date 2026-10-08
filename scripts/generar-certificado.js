'use strict';
/**
 * Genera un certificado HTTPS autofirmado para la red local.
 * Los navegadores solo permiten usar la cámara en páginas HTTPS (o en localhost),
 * así que los celulares de los vendedores necesitan entrar por https://IP:3443
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const selfsigned = require('selfsigned');

(async () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4').map((i) => i.address);
  const altNames = [{ type: 2, value: 'localhost' }, ...ips.map((ip) => ({ type: 7, ip }))];
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'feria-qr.local' }], {
    keySize: 2048, days: 825, algorithm: 'sha256', extensions: [{ name: 'subjectAltName', altNames }],
  });
  const dir = path.join(__dirname, '..', 'certs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'clave.pem'), pems.private);
  fs.writeFileSync(path.join(dir, 'certificado.pem'), pems.cert);
  console.log('✔ Certificado creado en la carpeta certs/ para:', ['localhost', ...ips].join(', '));
  console.log('  Ahora ponga HTTPS=1 en el archivo .env y reinicie con "npm start".');
  console.log('  Si cambia la IP del computador, vuelva a ejecutar "npm run cert".');
})().catch((e) => { console.error('✖', e.message); process.exit(1); });
