'use strict';
/**
 * Crea la base de datos, las tablas y el usuario administrador inicial.
 * Se puede ejecutar varias veces sin borrar datos.
 */
const config = require('../src/config');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { ahora } = require('../src/utils');

(async () => {
  const { database, ...conexion } = config.db;
  let conn;
  try {
    conn = await mysql.createConnection({ ...conexion, multipleStatements: true });
  } catch (err) {
    console.error('✖ No se pudo conectar a MySQL con los datos del archivo .env:', err.message);
    process.exit(1);
  }
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } catch (err) {
    console.log(`ℹ No se pudo crear la base "${database}" (${err.code}). Se usará si ya existe.`);
  }
  await conn.query(`USE \`${database}\``);
  const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
  await conn.query(sql);
  console.log(`✔ Tablas creadas/verificadas en la base "${database}".`);

  const restablecer = process.env.ADMIN_RESTABLECER === '1' || process.argv.includes('--restablecer-admin');
  const [admins] = await conn.query("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'ADMIN'");
  if (restablecer) {
    // Recupera el acceso: deja el usuario ADMIN_USUARIO activo y con la contraseña ADMIN_PASSWORD
    const usuario = config.admin.usuario.toLowerCase();
    const hash = await bcrypt.hash(config.admin.password, 10);
    const [r] = await conn.query("UPDATE usuarios SET password_hash = ?, activo = 1 WHERE usuario = ? AND rol = 'ADMIN'", [hash, usuario]);
    if (!r.affectedRows) {
      await conn.query(
        "INSERT INTO usuarios (usuario, password_hash, nombre, rol, creado_en) VALUES (?,?,?,'ADMIN',?)",
        [usuario, hash, config.admin.nombre, ahora()]);
    }
    console.log(`✔ Administrador restablecido → usuario: ${usuario}  (contraseña: la de ADMIN_PASSWORD)`);
    if (process.env.ADMIN_RESTABLECER === '1') console.log('  Quite la variable ADMIN_RESTABLECER cuando haya entrado.');
  } else if (admins[0].n === 0) {
    await conn.query(
      "INSERT INTO usuarios (usuario, password_hash, nombre, rol, creado_en) VALUES (?,?,?,'ADMIN',?)",
      [config.admin.usuario.toLowerCase(), await bcrypt.hash(config.admin.password, 10), config.admin.nombre, ahora()]);
    console.log(`✔ Administrador creado → usuario: ${config.admin.usuario}  contraseña: ${config.admin.password}`);
    console.log('  Cámbiela después de iniciar sesión (menú de usuario → Cambiar contraseña).');
  } else {
    console.log('ℹ Ya existe al menos un administrador; no se creó otro.');
  }
  await conn.end();
})().catch((err) => {
  console.error('✖ Error al preparar la base de datos:', err.message);
  process.exit(1);
});
