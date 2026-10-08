# Publicar Feria QR en internet

Con la app publicada en internet, administradores, vendedores y compradores entran desde cualquier celular o
computador con una dirección como `https://feria-colegio.up.railway.app`, y todas las compras quedan guardadas al
instante en una sola base de datos MySQL en la nube. No hace falta un computador servidor en el colegio.

> Requisito el día de la feria: los celulares de los vendedores necesitan **internet** (datos móviles o el Wi‑Fi
> del colegio). Si la señal se cae, la app avisa "Sin conexión" y reintenta la compra pendiente sin cobrar dos veces.
> Si en el lugar de la feria no hay buena señal, use la instalación en red local (README, sección 2).

Hay varias formas. Para una **prueba piloto casi gratis**, use la **opción Render + Aiven** (abajo).
La opción A (Railway) es la más sencilla si no importa pagar desde el inicio.

---

## Opción piloto (casi gratis): Render + Aiven

Render no ofrece MySQL, así que la app va en **Render** y la base MySQL en **Aiven** (plan gratuito, sin tarjeta y sin
fecha de vencimiento: 1 GB de disco, de sobra para miles de personas y compras).

| Etapa | Render (app) | Aiven (MySQL) | Costo |
|---|---|---|---|
| Preparación y pruebas | Instancia **Free** | **Free** | US$0 |
| Semana de la feria | Instancia de **US$7/mes** (512 MB) | **Free** | hasta US$7 |
| Después de la feria | Volver a **Free** o suspender | **Free** (descargue los reportes) | US$0 |

Por qué subir a US$7 en la feria: en el plan Free la app **se duerme tras 15 minutos sin uso** y la siguiente persona
espera cerca de **1 minuto**; además Render puede reiniciarla en cualquier momento. Para cobrar en fila eso estorba.
La instancia de US$7 no se duerme y alcanza de sobra para una feria escolar (la base guarda todo, no la app).

### Paso 1: la base MySQL en Aiven (gratis)
1. Cree una cuenta en **aiven.io** → **Create service → MySQL → plan Free**.
2. Cuando esté en verde, en **Overview** copie la **Service URI** (`mysql://avnadmin:…@….aivencloud.com:12345/defaultdb?ssl-mode=REQUIRED`)
   y descargue el **CA certificate** (`ca.pem`).
3. Aiven puede apagar una base gratuita si no se usa por un tiempo (avisa por correo). Antes de la feria entre a Aiven y
   verifique que esté encendida (**Power on** si hace falta).

### Paso 2: la app en Render
1. Suba la carpeta `feria-qr` a un repositorio de GitHub (Render despliega desde GitHub o GitLab).
2. En **render.com** → **New → Blueprint** y elija el repositorio. Render lee el archivo `render.yaml` incluido y crea
   el servicio con casi todo configurado. (O bien **New → Web Service**, con Build `npm ci --omit=dev` y
   Start `npm run start:nube`.)
3. Complete las variables que pide:
   - `DATABASE_URL`: la Service URI de Aiven.
   - `DB_SSL_CA`: abra `ca.pem` con el Bloc de notas y pegue todo el texto.
   - `ADMIN_PASSWORD`: la contraseña inicial del administrador.
4. Al terminar, Render le da la dirección `https://feria-qr.onrender.com` (con HTTPS: la cámara funciona).
   Entre como administrador y cambie la contraseña.

### Si no puede entrar como administrador
En Render → el servicio → **Environment**: escriba en `ADMIN_PASSWORD` la contraseña que quiera (sin espacios al
inicio o al final) y agregue la variable `ADMIN_RESTABLECER` con valor `1`. Guarde: Render reinicia la app y deja al
usuario `admin` con esa contraseña. Cuando haya entrado, **borre** la variable `ADMIN_RESTABLECER`.
Los vendedores se crean después, dentro de la app, en **Emprendimientos** (usuario y contraseña de cada puesto).

### Paso 3: la semana de la feria
- En Render → el servicio → **Settings → Instance Type** → elija la de **US$7**. Después de la feria vuelva a **Free**.
  Render cobra en proporción al tiempo usado; revise el valor exacto en su panel de facturación.
- Al terminar cada día descargue los reportes en Excel como respaldo.

Nota: Render no tiene "15 días gratis"; el plan Free no vence (750 horas al mes, suficientes para una app encendida
todo el mes). La base Postgres gratuita de Render sí vence a los 30 días, pero esta app no la usa.

---

## Opción A (recomendada): Railway

Railway aloja la app y la base MySQL en el mismo lugar y da HTTPS automático (la cámara funciona sin hacer nada más).
Tiene un plan de pago bajo por uso; revise los precios actuales en railway.com antes de empezar.
Los nombres de los menús pueden variar un poco con el tiempo.

1. Cree una cuenta en **railway.com** e instale Node.js en su computador (si no lo tiene).
2. En Railway: **New Project → Database → MySQL**. Espere a que quede en verde.
3. En su computador, abra una terminal en la carpeta `feria-qr` y suba la app:
   ```bash
   npm install -g @railway/cli
   railway login
   railway link          # elija el proyecto creado en el paso 2
   railway up            # sube la carpeta y crea el servicio de la app
   ```
   (Si usa GitHub, también puede subir el código a un repositorio y elegir **New → GitHub Repo**.)
4. En el servicio de la app → **Variables**, agregue:

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | `${{MySQL.MYSQL_URL}}` (referencia a la base creada en el paso 2) |
   | `SESSION_SECRET` | una frase larga e inventada, p. ej. `feria-colegio-2026-tortuga-verde-azul-9x` |
   | `TRUST_PROXY` | `1` |
   | `TZ` | `America/Bogota` |
   | `ADMIN_USUARIO` | `admin` |
   | `ADMIN_PASSWORD` | una contraseña segura (cámbiela después de entrar) |

5. En **Settings** del servicio de la app:
   - **Start Command**: `npm run start:nube` (crea las tablas y el administrador la primera vez, y luego inicia).
   - **Networking → Generate Domain**: le da la dirección pública `https://….up.railway.app`.
6. Abra esa dirección, entre con el administrador y **cambie la contraseña**.
7. (Opcional) Datos de demostración para practicar: `railway run npm run db:demo`. No lo haga con datos reales.

## Opción B: un servidor propio (VPS con Ubuntu)

Para quien prefiere un servidor alquilado (DigitalOcean, Contabo, Hostinger VPS, etc.) y un dominio propio.
Si no tiene dominio, puede usar uno gratuito como `micolegio.duckdns.org`.

```bash
# 1. Programas
sudo apt update && sudo apt install -y mysql-server nginx certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs

# 2. Base de datos (cambie la contraseña)
sudo mysql -e "CREATE DATABASE feria_qr CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE USER 'feria'@'localhost' IDENTIFIED BY 'UnaClaveSegura!';
  GRANT ALL PRIVILEGES ON feria_qr.* TO 'feria'@'localhost';"

# 3. La app (copie la carpeta feria-qr a /opt/feria-qr, por ejemplo con scp)
cd /opt/feria-qr && npm ci --omit=dev
cp .env.example .env && nano .env      # DB_PASSWORD, SESSION_SECRET, ADMIN_PASSWORD; deje HTTPS=0
npm run db:init
```

Servicio para que arranque solo y se reinicie si falla, en `/etc/systemd/system/feria-qr.service`:

```ini
[Unit]
Description=Feria QR
After=network.target mysql.service

[Service]
WorkingDirectory=/opt/feria-qr
ExecStart=/usr/bin/node src/server.js
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now feria-qr
```

nginx como puerta de entrada, en `/etc/nginx/sites-available/feria-qr` (cambie el dominio):

```nginx
server {
  server_name feria.micolegio.edu.co;
  client_max_body_size 10m;          # para importar listas de Excel grandes
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;          # importaciones de miles de personas
  }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/feria-qr /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d feria.micolegio.edu.co     # certificado HTTPS gratuito (Let's Encrypt)
```

Como nginx está en la misma máquina, no hace falta configurar `TRUST_PROXY`.

## Opción C: Docker

El proyecto incluye un `Dockerfile`. Sirve para Render, Fly.io, un VPS con Docker, etc.
Al arrancar ejecuta `npm run start:nube` (crea las tablas si no existen y luego inicia).

```bash
docker build -t feria-qr .
docker run -d -p 3000:3000 \
  -e DATABASE_URL="mysql://feria:clave@servidor-mysql:3306/feria_qr" \
  -e SESSION_SECRET="frase-larga-secreta" -e TRUST_PROXY=1 -e ADMIN_PASSWORD="ClaveSegura!" \
  feria-qr
```

Si la base MySQL está en otro proveedor (Aiven, PlanetScale, Azure, etc.), casi siempre exige conexión cifrada:
agregue `DB_SSL=1`.

---

## Variables de entorno para internet

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Datos de MySQL en una sola línea `mysql://usuario:clave@servidor:puerto/base`. Reemplaza a `DB_HOST`…`DB_NAME`. |
| `DB_SSL_CA` | Certificado del proveedor de la base (texto de `ca.pem` o ruta al archivo). Activa la conexión cifrada verificada. |
| `DB_SSL` | `1` para cifrar la conexión con la base (bases en la nube). `sin-verificar` si el proveedor usa un certificado propio. |
| `TRUST_PROXY` | `1` cuando hay un proxy delante (Railway, Render, Fly.io). Necesario para que la sesión segura (HTTPS) funcione. |
| `SESSION_SECRET` | Frase larga y secreta. Sin ella cualquiera podría falsificar sesiones. |
| `PORT` | Puerto interno; los hostings lo ponen solos. |
| `ADMIN_RESTABLECER` | `1` solo para recuperar el acceso: al arrancar deja al administrador con la contraseña de `ADMIN_PASSWORD`. Quítela después. |
| `HTTPS` | Déjelo en `0`: en internet el HTTPS lo da el hosting o nginx. |

## Varios administradores al mismo tiempo

La app ya admite varias cuentas de administrador trabajando a la vez:

1. Entre como administrador → **Configuración → Administradores → Nuevo administrador**.
2. Cree una cuenta por persona (no compartan la misma), por ejemplo `coord.primaria`, `coord.bachillerato`.
3. Cada uno entra desde su propio computador o celular y puede registrar personas, importar listas, recargar saldo
   y ver el panel en vivo al mismo tiempo que los demás. La auditoría guarda qué administrador hizo cada cambio.

Dos administradores no pueden crear por error la misma persona: la identificación es única, y si dos la registran
a la vez, el segundo recibe el aviso "Ya existe una persona con la identificación…".

## Cargar todos los usuarios desde Excel o CSV

**Personas → Importar Excel/CSV**. Acepta archivos `.xlsx` (Excel) y `.csv`. La primera fila debe tener los
títulos; se reconocen estos nombres (sin importar mayúsculas ni tildes):

| Columna | Títulos aceptados | Obligatoria |
|---|---|---|
| Nombre | `nombre`, `nombre completo` | Sí |
| Identificación | `identificacion`, `documento`, `codigo`, `id` | Sí |
| Tipo o rol | `tipo`, `rol` (ESTUDIANTE, DOCENTE, DIRECTIVO, ADMINISTRATIVO, FAMILIA, OTRO) | No (vacío = estudiante) |
| Curso | `curso`, `grado` | No (se crea si no existe) |
| Saldo inicial | `saldo`, `valor` | No (se divide entre día 1 y día 2) |

Antes de importar se muestra una vista previa. Al terminar dice cuántas personas se registraron y qué filas
tuvieron errores (por ejemplo, identificación repetida), para corregirlas y subir solo esas.
Hasta 5.000 personas por archivo; en la ventana de importación hay plantillas de Excel y CSV listas para llenar.
Los archivos `.xls` antiguos deben guardarse primero como `.xlsx` ("Guardar como" en Excel).

## Antes de la feria

- Haga un **simulacro** con la dirección de internet desde los celulares reales de los vendedores (cámara incluida).
- **Copias de seguridad** al final de cada día: `mysqldump` contra la base de la nube, o descargue los reportes en
  Excel (personas, transacciones y recargas) desde **Reportes**.
- Desactive las cuentas de administrador que no se usen y cambie todas las contraseñas de prueba.
