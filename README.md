# Feria QR · Pagos con código QR para la Feria de Emprendimiento escolar

Aplicación web para que la comunidad educativa compre en los emprendimientos de la feria **sin dinero en efectivo**:
cada persona tiene un **saldo virtual** (separado en saldo del día 1 y saldo del día 2) y un **código QR único**;
el vendedor escanea el QR con el celular, escribe el valor y confirma. El saldo vive en la base de datos MySQL,
nunca en el celular. Hay tres módulos: **administración**, **vendedores** (emprendimientos) y **compradores**
(cada persona consulta su saldo e historial).

```
Administrador carga saldo → genera QR → estudiante recibe QR → vendedor escanea QR → sistema consulta saldo
→ vendedor registra compra → sistema valida → descuenta → registra transacción → muestra nuevo saldo
```

> **¿Quiere usarla desde internet** (sin servidor en el colegio, con varios administradores registrando a la vez)?
> Vea la guía [docs/PUBLICAR-EN-INTERNET.md](docs/PUBLICAR-EN-INTERNET.md). Esta página explica la instalación en red local.

---

## 1. Requisitos

| Programa | Versión | Para qué |
|---|---|---|
| [Node.js](https://nodejs.org) | 20 o superior (LTS) | Ejecuta el servidor |
| [MySQL](https://dev.mysql.com/downloads/) | 8.0.16 o superior (también sirve MariaDB 10.4+) | Base de datos |
| Navegador | Chrome, Edge, Safari o Firefox recientes | Administración y ventas |

Un solo computador hace de **servidor**. Los celulares, tabletas y computadores de los puestos se conectan a él por
la **red Wi‑Fi del colegio**. No se necesita Internet durante la feria: todas las librerías (Bootstrap, lector de QR)
se sirven desde el propio servidor.

---

## 2. Instalación paso a paso

### 2.1 Descomprimir e instalar dependencias

```bash
cd feria-qr
npm install
```

### 2.2 Crear el usuario de MySQL

Abra MySQL como administrador (`mysql -u root -p`, MySQL Workbench o phpMyAdmin) y ejecute:

```sql
CREATE DATABASE feria_qr CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'feria'@'localhost' IDENTIFIED BY 'una-clave-segura';
GRANT ALL PRIVILEGES ON feria_qr.* TO 'feria'@'localhost';
-- Solo si va a ejecutar las pruebas automáticas (npm test):
GRANT ALL PRIVILEGES ON feria_qr_prueba.* TO 'feria'@'localhost';
FLUSH PRIVILEGES;
```

### 2.3 Configurar el archivo `.env`

```bash
cp .env.example .env        # en Windows: copy .env.example .env
```

Edite `.env` y ponga la contraseña de MySQL (`DB_PASSWORD`), una frase secreta propia en `SESSION_SECRET`
y la contraseña del administrador inicial (`ADMIN_PASSWORD`).

### 2.4 Crear las tablas y el administrador

```bash
npm run db:init
```

Crea todas las tablas (archivo `database/schema.sql`) y el usuario administrador indicado en `.env`.
Puede ejecutarse de nuevo sin borrar datos.

*(Opcional)* Para practicar con datos de ejemplo (43 personas, 8 cursos y 5 emprendimientos):

```bash
npm run db:demo
```

Los vendedores de ejemplo son `dulces10a`, `comidas11b`, `jugos9a`, `artesanias8a` y `juegos7a`, todos con contraseña `1234`.
**No cargue los datos de ejemplo en la base real de la feria.**

### 2.5 Iniciar el servidor

```bash
npm start
```

En la consola aparecerán las direcciones, por ejemplo:

```
✔ Feria QR funcionando en http://localhost:3000
  En la red local: http://192.168.1.50:3000
```

Abra `http://localhost:3000` en el computador servidor e inicie sesión con el administrador.

### 2.6 Activar HTTPS para usar la cámara desde los celulares (importante)

Los navegadores **solo permiten usar la cámara** en páginas `https://` (o en `localhost`).
Para que los celulares de los puestos puedan escanear con la cámara:

```bash
npm run cert          # genera un certificado para la IP del computador
```

En `.env` ponga `HTTPS=1` y reinicie con `npm start`. Aparecerá una dirección como `https://192.168.1.50:3443`.

En cada celular abra esa dirección. La primera vez el navegador mostrará un aviso porque el certificado es del
propio colegio: toque **"Configuración avanzada" → "Continuar a 192.168.1.50 (no seguro)"**. Después pedirá permiso
para la cámara: toque **Permitir**.

> Si un celular no puede usar la cámara, el vendedor igual puede cobrar con **"Foto del QR"** (abre la cámara del
> teléfono para tomar una foto) o escribiendo el **código** impreso debajo del QR.

> Si la IP del computador cambia, ejecute `npm run cert` otra vez. Conviene pedir a sistemas una IP fija para el servidor.

### 2.7 Verificar la instalación (opcional)

```bash
npm test
```

Crea una base de datos temporal `feria_qr_prueba` y prueba todo el flujo (22 pruebas): compras del ejemplo
($25.000 → $20.000 → $12.000 → $0), mensajes de saldo insuficiente y agotado, compra duplicada, 30 compras
simultáneas desde dos vendedores, cuenta bloqueada, QR inexistente, anulación, saldo por día (primera carga dividida,
recargas por día, día 1 y día 2), responsables de emprendimiento, consulta del comprador, reportes en Excel/CSV,
PDF de QR y cuadre contable. No toca la base real.

---

## 3. Cómo se usa

### Antes de la feria (administrador)

1. **Configuración** → escriba las fechas del **día 1** y **día 2**, el valor de **saldo bajo** (p. ej. $5.000),
   deje activo **"Separar el saldo por día"** y el porcentaje de la primera carga para el día 1 (50 %).
   Cree los **cursos** (6A, 10A, 11B...).
2. **Personas** → **Nueva persona** (o **Importar Excel/CSV**: sube directamente el archivo `.xlsx` de Excel o un `.csv` con columnas
   `nombre, tipo, curso, identificacion, saldo`; hay plantillas para descargar). El rol puede ser estudiante, docente, directivo, administrativo,
   familia u otro. El saldo inicial se divide solo: mitad para el día 1 y mitad reservada para el día 2.
   Al guardar se genera automáticamente el QR único.
3. **Recargas** → en la ficha de la persona, **Recargar saldo**: desde la segunda carga se elige si el dinero es
   para el **día 1**, el **día 2** o **dividido entre los dos días**, según lo que quiera el comprador.
4. **Emprendimientos** → registre cada puesto: nombre, **responsables elegidos entre las personas registradas**
   (buscador), **curso o rol**, categoría, productos, y el **usuario y contraseña** del vendedor (la contraseña se puede
   cambiar cuando quiera).
5. **Códigos QR** → **Descargar PDF (12 QR por página)**: tamaño carta, 4 filas × 3 columnas, con nombre, curso o rol y
   código de respaldo, listo para imprimir y recortar. También: ver e imprimir tarjetas, descargar todos en ZIP,
   o buscar una persona y ver/descargar su QR. Se puede filtrar por curso o rol.

### Durante la feria (vendedor, en el celular)

1. Inicie sesión con el usuario del emprendimiento.
2. **ESCANEAR QR** → apunte al QR del comprador.
3. Verá **nombre, curso y saldo** (nada más).
4. Escriba el valor (o use los botones +$1.000, +$5.000...) → **CONTINUAR**.
5. Revise **Compra / Saldo anterior / Saldo restante** → **CONFIRMAR COMPRA**.
6. Entregue el producto solo cuando vea **"Compra registrada"**. Toque **NUEVA VENTA** para el siguiente.

En **Mis ventas** el vendedor ve únicamente las ventas de su emprendimiento: número de ventas y valor total
(hoy y de toda la feria) y el historial con fecha, hora, comprador y valor.

### Compradores: consultar mi saldo

En la página de inicio, **"Soy comprador: consultar mi saldo"** (o la dirección `/consulta/`). Cada persona escanea su
propio QR, toma una foto de él o escribe el código impreso debajo, y ve: cuánto puede gastar hoy, su saldo del
día 1, del día 2 y total, el historial de compras (fecha, hora, emprendimiento, compra, saldo restante) y sus
cargas de saldo. No necesita usuario ni contraseña: el código del QR es secreto y no se puede adivinar.

### Alertas que muestra el sistema

| Situación | Mensaje |
|---|---|
| Saldo en $0 | "Saldo agotado. Esta persona no puede realizar más compras." |
| Saldo menor al valor configurado | "Saldo bajo" (amarillo) |
| Compra mayor al saldo | "Saldo insuficiente. Saldo disponible: $7.000." (si hay saldo reservado, lo indica) |
| Día 1 y ya gastó su saldo del día 1 | "Saldo del día 1 agotado. Tiene $X reservados para el día 2." |
| QR que no es de la feria o no existe | "QR no registrado. No existe ninguna cuenta asociada a este código." |
| Cuenta bloqueada | "La cuenta de … está BLOQUEADA. No puede realizar compras." |
| Sin conexión | Franja roja "SIN CONEXIÓN" y "La compra NO se pudo confirmar. No entregue el producto todavía." |

### Correcciones (solo administrador)

- **Anular una compra**: en **Transacciones** o en el detalle de la persona → **Anular**, escribiendo el motivo.
  El valor vuelve al saldo; la compra no se borra, queda marcada "Anulada" con quién, cuándo y por qué.
- **Recargar saldo**: detalle de la persona → **Recargar saldo**. **Ajustar** permite sumar o restar con motivo
  (nunca deja el saldo negativo). Cada movimiento guarda valor, saldo anterior, nuevo saldo, fecha, hora y administrador.
- **Bloquear / activar** una cuenta, y **QR nuevo** si una tarjeta se perdió (el QR anterior deja de funcionar).

### Reportes (Excel y CSV)

En **Reportes**, con filtro opcional de fechas: resumen general de la feria, listado de personas y saldo (por día),
historial de transacciones (con el rol del comprador), ventas por emprendimiento, compras por persona, ventas por
curso, ventas por rol, cargas/recargas (con el día asignado) y el **PDF con todos los QR**.
Cada uno se puede **ver** en pantalla o **descargar** en Excel (.xlsx) o CSV (separado por `;`, se abre directo en Excel).

---

## 4. La regla de los dos días (saldo por día)

"Del monto total, deben gastar la mitad el primer día y la otra mitad el último día."

Cada persona tiene dos saldos: **saldo del día 1** y **saldo del día 2**.

- **Primera carga** (el saldo inicial): se divide automáticamente, 50 % para el día 1 y 50 % reservado para el día 2.
  Ejemplo: $25.000 → $12.500 día 1 y $12.500 día 2. El porcentaje se puede cambiar en Configuración.
- **Desde la segunda recarga** el administrador elige, según lo que pida el comprador: **día 1**, **día 2** o
  **dividir entre los dos días**. Cada recarga queda registrada con el día al que se asignó.
- **Antes y durante el día 1** solo se puede gastar el saldo del día 1. El del día 2 aparece como "reservado".
- **Desde el día 2** se puede gastar todo: lo que sobró del día 1 más el saldo del día 2.
- Cada compra descuenta primero del saldo del día 1. Si se anula una compra, el dinero vuelve exactamente al día
  de donde salió.
- El vendedor ve en grande **"Disponible hoy"** y, debajo, lo reservado para el día 2.
- La separación por día se puede desactivar en Configuración (entonces todo se puede gastar cualquier día).
- Opcional: **"Permitir compras solo en los dos días de feria"** bloquea las compras en otras fechas
  (déjelo apagado mientras hacen pruebas).

## 5. Seguridad y control

- **El QR no contiene el saldo**: contiene `FERIAQR:<identificador>|<nombre>|<curso o rol>`. El identificador es
  aleatorio de 128 bits (32 caracteres), único (restricción `UNIQUE` en la base) e imposible de adivinar; es lo único
  que sirve para cobrar. El nombre y el curso o rol son informativos (si se edita el nombre de alguien, su QR impreso
  sigue funcionando).
- **Contraseñas** guardadas con bcrypt. Sesiones guardadas en MySQL, con cookie `HttpOnly`.
  Tras 10 intentos fallidos de inicio de sesión se bloquea la IP por 10 minutos.
- **Roles**: el vendedor solo puede consultar saldo (nombre, curso y saldo), registrar compras y ver sus propias ventas.
  El comprador solo ve su propia cuenta, con el código de su QR.
  Todo lo demás exige rol administrador, verificado en el servidor en cada petición. Si se desactiva un
  emprendimiento o un usuario, pierde el acceso de inmediato.
- **Compras simultáneas**: cada compra se hace dentro de una transacción de base de datos que **bloquea la fila
  del comprador** (`SELECT … FOR UPDATE`). Si dos vendedores cobran al mismo tiempo a la misma persona, el segundo
  espera y ve el saldo ya descontado. Probado con 30 compras simultáneas.
- **Nunca saldo negativo**: se valida en el servidor y además la base de datos lo impide con restricciones `CHECK`
  (`saldo >= 0`, `saldo_anterior - valor = saldo_posterior`).
- **Sin compras duplicadas**: cada intento de compra lleva un código de operación único generado en el celular
  (columna `UNIQUE`). Un doble toque o un reintento después de perder la conexión devuelve la compra ya registrada
  en vez de cobrar otra vez. El botón se desactiva mientras se envía.
- **Sin conexión**: si se cae la red, la compra no se confirma y el vendedor lo ve claramente; al volver la conexión
  toca **Reintentar** con el mismo código, así que nunca se cobra dos veces.
- **Inmutabilidad**: no existe ninguna función para editar una compra; solo anularla (administrador), con registro.
  La bitácora **Registro de operaciones administrativas** (Configuración) guarda bloqueos, anulaciones, ediciones,
  cambios de configuración, etc.

---

## 6. Estructura del proyecto

```
feria-qr/
├── database/
│   └── schema.sql              Tablas, relaciones, restricciones y configuración inicial
├── scripts/
│   ├── init-db.js              npm run db:init  → crea tablas y administrador
│   ├── seed-demo.js            npm run db:demo  → datos de ejemplo
│   ├── generar-certificado.js  npm run cert     → certificado HTTPS para la red local
│   └── prueba-flujo.js         npm test         → prueba automática completa
├── src/
│   ├── server.js               Servidor Express, sesiones, rutas, HTTPS
│   ├── config.js               Lee el archivo .env
│   ├── db.js                   Conexión MySQL y transacciones
│   ├── utils.js                Fechas, dinero, tokens QR
│   ├── middleware/auth.js      Sesión y control de roles
│   ├── services/
│   │   ├── saldos.js           Compras, anulaciones, recargas, saldo por día (lógica de dinero)
│   │   ├── configuracion.js    Parámetros de la feria
│   │   └── auditoria.js        Bitácora
│   └── routes/
│       ├── auth.js             Login, logout, cambio de contraseña
│       ├── ventas.js           API del vendedor
│       ├── admin.js            API del administrador (personas, QR y PDF, emprendimientos, transacciones…)
│       ├── publico.js          Consulta de saldo del comprador
│       └── reportes.js         Reportes y exportación Excel/CSV
├── public/
│   ├── login.html
│   ├── vendedor/index.html     Pantalla de ventas (celular)
│   ├── admin/index.html        Panel del administrador
│   ├── admin/imprimir.html     Hoja de tarjetas QR
│   ├── consulta/index.html     Consulta de saldo e historial del comprador
│   ├── js/ (comun.js, vendedor.js, admin.js, consulta.js)
│   └── css/app.css
├── .env.example
└── package.json
```

### Base de datos

| Tabla | Contenido |
|---|---|
| `cursos` | Cursos/grados (10A, 11B…) |
| `estudiantes` | Personas con saldo (estudiantes, docentes, etc.): nombre, rol, curso, identificación, saldo inicial, saldo total, saldo del día 1, saldo del día 2, estado, `qr_token` único |
| `emprendimientos` | Nombre, curso o rol, categoría, productos, activo |
| `emprendimiento_responsables` | Personas registradas responsables de cada emprendimiento |
| `usuarios` | Administradores y vendedores (un vendedor pertenece a un emprendimiento) |
| `transacciones` | Cada compra: comprador (con su rol), emprendimiento, vendedor, valor (y cuánto salió de cada día), fecha y hora, saldo anterior y posterior, estado, datos de anulación |
| `recargas` | Saldo inicial, recargas y ajustes: valor, día al que se asignó, saldo anterior, nuevo saldo, fecha y hora, administrador |
| `auditoria` | Bitácora de operaciones administrativas |
| `configuracion` | Nombre de la feria, saldo bajo, fechas, % de la primera carga para el día 1 |
| `sessions` | Sesiones de inicio (la crea el servidor automáticamente) |

Cuadres que siempre se cumplen: **total cargado − total vendido = saldo pendiente de todas las personas**, y para cada
persona **saldo total = saldo día 1 + saldo día 2** (lo garantiza una restricción `CHECK` de la base de datos).

---

## 7. Recomendaciones para el día de la feria

- Haga un **simulacro** uno o dos días antes con 2 o 3 puestos y algunas tarjetas reales.
- Deje el computador servidor **conectado a la corriente**, con la suspensión desactivada y cerca del router.
- Haga una **copia de seguridad** al final de cada día:
  `mysqldump -u feria -p feria_qr > respaldo-dia1.sql`
- Tenga a mano un administrador con su usuario abierto para recargas, bloqueos y anulaciones.
- Cambie la contraseña del administrador inicial (menú del usuario → **Cambiar contraseña**).

## 8. Problemas frecuentes

| Problema | Solución |
|---|---|
| `No se pudo conectar a MySQL` al iniciar | Revise que MySQL esté encendido y los datos `DB_*` de `.env`. Ejecute `npm run db:init`. |
| Los celulares no abren la página | Deben estar en la misma red Wi‑Fi que el servidor. Revise el firewall de Windows: permita Node.js en redes privadas (puertos 3000 y 3443). |
| La cámara no abre | Use la dirección `https://…:3443` (ver 2.6) y permita la cámara. Mientras tanto use "Foto del QR". |
| "QR no registrado" con un QR correcto | Es posible que se haya generado un QR nuevo para esa persona: imprima el actual desde su ficha. |
| El día 1 no deja comprar más | Ya gastó su saldo del día 1; el del día 2 está reservado. Si el comprador quiere, recárguele saldo asignado al día 1. |

## 9. Si ya había instalado la versión anterior

Esta versión cambia la estructura de la base de datos (saldo por día, responsables de emprendimientos).
Si ya había creado la base con la versión anterior y todavía no tiene datos reales, bórrela y créela de nuevo:

```sql
DROP DATABASE feria_qr;
CREATE DATABASE feria_qr CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

y luego `npm run db:init`.

## 10. Publicar en internet

La guía completa está en [docs/PUBLICAR-EN-INTERNET.md](docs/PUBLICAR-EN-INTERNET.md): Render + Aiven (prueba piloto casi gratis), Railway (la más sencilla, HTTPS
automático), servidor propio con nginx y Let's Encrypt, o Docker. También explica cómo crear varias cuentas de
administrador para registrar personas al mismo tiempo y cómo cargar todos los usuarios desde Excel o CSV.
