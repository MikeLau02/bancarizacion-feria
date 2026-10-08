-- =====================================================================
--  Feria QR · Esquema de base de datos (MySQL 8.0.16+ / MariaDB 10.4+)
--  Sistema de pagos con códigos QR para la Feria de Emprendimiento escolar
-- =====================================================================
--  Los valores de dinero se guardan en pesos enteros (INT), sin decimales.
--  Las restricciones CHECK impiden saldos negativos incluso si alguien
--  intentara modificar la base de datos directamente.
-- =====================================================================

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- Cursos / grados (10A, 11B, ...)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cursos (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  nombre      VARCHAR(30)  NOT NULL,
  activo      TINYINT(1)   NOT NULL DEFAULT 1,
  creado_en   DATETIME     NOT NULL,
  UNIQUE KEY uq_cursos_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Emprendimientos participantes
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS emprendimientos (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  nombre        VARCHAR(120) NOT NULL,
  responsables  VARCHAR(500) NOT NULL,      -- nombres (copia de emprendimiento_responsables para reportes)
  curso_id      INT NULL,
  rol           VARCHAR(30)  NULL,          -- si no es de un curso: DOCENTE, FAMILIA, ...
  categoria     VARCHAR(80)  NULL,
  productos     VARCHAR(500) NULL,
  activo        TINYINT(1)   NOT NULL DEFAULT 1,
  creado_en     DATETIME     NOT NULL,
  UNIQUE KEY uq_emprendimientos_nombre (nombre),
  CONSTRAINT fk_emprendimientos_curso FOREIGN KEY (curso_id) REFERENCES cursos(id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Usuarios del sistema (administradores y vendedores)
-- Un vendedor siempre pertenece a un emprendimiento.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  usuario            VARCHAR(60)  NOT NULL,
  password_hash      VARCHAR(100) NOT NULL,
  nombre             VARCHAR(120) NOT NULL,
  rol                ENUM('ADMIN','VENDEDOR') NOT NULL,
  emprendimiento_id  INT NULL,
  activo             TINYINT(1)   NOT NULL DEFAULT 1,
  ultimo_acceso      DATETIME     NULL,
  creado_en          DATETIME     NOT NULL,
  UNIQUE KEY uq_usuarios_usuario (usuario),
  CONSTRAINT fk_usuarios_emprendimiento FOREIGN KEY (emprendimiento_id) REFERENCES emprendimientos(id),
  CONSTRAINT chk_usuarios_vendedor CHECK (rol = 'ADMIN' OR emprendimiento_id IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Personas de la comunidad educativa con saldo (estudiantes, docentes...)
-- La tabla se llama "estudiantes" como pide la especificación.
-- qr_token: identificador aleatorio y secreto que va dentro del QR.
--           El QR NUNCA contiene el saldo ni datos personales.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS estudiantes (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  tipo            ENUM('ESTUDIANTE','DOCENTE','DIRECTIVO','ADMINISTRATIVO','FAMILIA','OTRO') NOT NULL DEFAULT 'ESTUDIANTE',
  nombre_completo VARCHAR(150) NOT NULL,
  curso_id        INT NULL,
  identificacion  VARCHAR(40)  NOT NULL,
  saldo_inicial   INT          NOT NULL DEFAULT 0,
  saldo           INT          NOT NULL DEFAULT 0,   -- saldo total = saldo_dia1 + saldo_dia2
  saldo_dia1      INT          NOT NULL DEFAULT 0,   -- se puede gastar desde el día 1
  saldo_dia2      INT          NOT NULL DEFAULT 0,   -- reservado: solo se puede gastar desde el día 2
  estado          ENUM('ACTIVA','BLOQUEADA') NOT NULL DEFAULT 'ACTIVA',
  qr_token        CHAR(32)     NOT NULL,
  creado_en       DATETIME     NOT NULL,
  actualizado_en  DATETIME     NOT NULL,
  UNIQUE KEY uq_estudiantes_identificacion (identificacion),
  UNIQUE KEY uq_estudiantes_qr (qr_token),
  KEY idx_estudiantes_nombre (nombre_completo),
  CONSTRAINT fk_estudiantes_curso FOREIGN KEY (curso_id) REFERENCES cursos(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_estudiantes_saldo CHECK (saldo >= 0 AND saldo_dia1 >= 0 AND saldo_dia2 >= 0 AND saldo = saldo_dia1 + saldo_dia2),
  CONSTRAINT chk_estudiantes_saldo_inicial CHECK (saldo_inicial >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Compras. Una compra confirmada no se modifica: solo se puede ANULAR
-- (por un administrador), lo que devuelve el valor al saldo y deja
-- registro de quién, cuándo y por qué.
-- codigo_operacion: clave única que genera el dispositivo del vendedor
-- para cada intento de compra; impide que una compra se registre dos veces
-- (doble clic, reintento tras perder la conexión, etc.).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transacciones (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  codigo_operacion   VARCHAR(64)  NOT NULL,
  estudiante_id      INT NOT NULL,
  emprendimiento_id  INT NOT NULL,
  vendedor_id        INT NOT NULL,
  valor              INT NOT NULL,
  valor_dia1         INT NOT NULL DEFAULT 0,   -- parte descontada del saldo del día 1
  valor_dia2         INT NOT NULL DEFAULT 0,   -- parte descontada del saldo del día 2
  saldo_anterior     INT NOT NULL,
  saldo_posterior    INT NOT NULL,
  fecha_hora         DATETIME NOT NULL,
  estado             ENUM('CONFIRMADA','ANULADA') NOT NULL DEFAULT 'CONFIRMADA',
  anulada_por        INT NULL,
  anulada_en         DATETIME NULL,
  motivo_anulacion   VARCHAR(255) NULL,
  UNIQUE KEY uq_transacciones_operacion (codigo_operacion),
  KEY idx_transacciones_fecha (fecha_hora),
  KEY idx_transacciones_estudiante (estudiante_id, fecha_hora),
  KEY idx_transacciones_emprendimiento (emprendimiento_id, fecha_hora),
  CONSTRAINT fk_transacciones_estudiante FOREIGN KEY (estudiante_id) REFERENCES estudiantes(id),
  CONSTRAINT fk_transacciones_emprendimiento FOREIGN KEY (emprendimiento_id) REFERENCES emprendimientos(id),
  CONSTRAINT fk_transacciones_vendedor FOREIGN KEY (vendedor_id) REFERENCES usuarios(id),
  CONSTRAINT fk_transacciones_anulador FOREIGN KEY (anulada_por) REFERENCES usuarios(id),
  CONSTRAINT chk_transacciones_valor CHECK (valor > 0),
  CONSTRAINT chk_transacciones_saldos CHECK (saldo_posterior >= 0 AND saldo_anterior - valor = saldo_posterior),
  CONSTRAINT chk_transacciones_dias CHECK (valor_dia1 >= 0 AND valor_dia2 >= 0 AND valor_dia1 + valor_dia2 = valor)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Cargas de saldo: carga inicial, recargas y ajustes (todas auditadas)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recargas (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  estudiante_id  INT NOT NULL,
  admin_id       INT NOT NULL,
  tipo           ENUM('INICIAL','RECARGA','AJUSTE') NOT NULL,
  dia            ENUM('DIA1','DIA2','AMBOS') NOT NULL,   -- a qué día se asignó el saldo
  valor          INT NOT NULL,
  valor_dia1     INT NOT NULL,
  valor_dia2     INT NOT NULL,
  saldo_anterior INT NOT NULL,
  saldo_nuevo    INT NOT NULL,
  observacion    VARCHAR(255) NULL,
  fecha_hora     DATETIME NOT NULL,
  KEY idx_recargas_estudiante (estudiante_id, fecha_hora),
  CONSTRAINT fk_recargas_estudiante FOREIGN KEY (estudiante_id) REFERENCES estudiantes(id),
  CONSTRAINT fk_recargas_admin FOREIGN KEY (admin_id) REFERENCES usuarios(id),
  CONSTRAINT chk_recargas_saldos CHECK (saldo_nuevo >= 0 AND saldo_anterior + valor = saldo_nuevo AND valor_dia1 + valor_dia2 = valor)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Estudiantes responsables de cada emprendimiento (se eligen entre las personas registradas)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS emprendimiento_responsables (
  emprendimiento_id  INT NOT NULL,
  estudiante_id      INT NOT NULL,
  PRIMARY KEY (emprendimiento_id, estudiante_id),
  CONSTRAINT fk_resp_emprendimiento FOREIGN KEY (emprendimiento_id) REFERENCES emprendimientos(id) ON DELETE CASCADE,
  CONSTRAINT fk_resp_estudiante FOREIGN KEY (estudiante_id) REFERENCES estudiantes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Bitácora de operaciones administrativas (bloqueos, anulaciones, etc.)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auditoria (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id  INT NULL,
  accion      VARCHAR(60)  NOT NULL,
  entidad     VARCHAR(40)  NOT NULL,
  entidad_id  INT NULL,
  detalle     TEXT NULL,
  fecha_hora  DATETIME NOT NULL,
  KEY idx_auditoria_fecha (fecha_hora),
  CONSTRAINT fk_auditoria_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Parámetros configurables desde el panel
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS configuracion (
  clave  VARCHAR(60) PRIMARY KEY,
  valor  VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO configuracion (clave, valor) VALUES
  ('nombre_feria',          'Feria de Emprendimiento Escolar'),
  ('saldo_bajo',            '5000'),
  ('limite_diario_activo',  '1'),
  ('fecha_dia1',            '2026-11-09'),
  ('fecha_dia2',            '2026-11-10'),
  ('porcentaje_dia1',       '50'),
  ('solo_dias_feria',       '0');
