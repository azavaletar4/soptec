# Réplica completa: TR-069 / GenieACS / Docker — fosmikro

Documento de referencia para replicar **todo el stack TR-069** de fosmikro en una nueva PC o servidor.

> **⚠️ Correccion (validado contra Docker real, 2026-09-11):** la imagen `genieacs/genieacs:1.2`
> que aparece en los bloques `docker-compose` de este documento (secciones 3.1 y 3.2) **no existe**
> en Docker Hub (`pull access denied`, confirmado al intentar levantar el stack). Para SmartRayco
> se uso en su lugar `drumsergio/genieacs:1.2.16.0` (proyecto
> [GeiserX/genieacs-container](https://github.com/GeiserX/genieacs-container)), una imagen
> "todo en uno" que corre los 4 procesos de GenieACS (cwmp/nbi/fs/ui) en un solo contenedor —
> a diferencia del esquema de 4 contenedores que asume este documento — con la UI en el puerto
> 3000 interno (no 3001) y Mongo con `?authSource=admin` en la URL de conexion. Los archivos
> reales y ya validados de SmartRayco son `docker-compose.yml` (dev, incluye un perfil `testing`
> con `drumsergio/genieacs-sim-container` para probar el flujo TR-069 completo sin una ONT real)
> y `docker-compose.onprem.yml` (produccion) en la raiz del repo — usar esos, no los bloques de
> abajo, como fuente de verdad.

---

## Tabla de contenidos

1. [Arquitectura general](#1-arquitectura-general)
2. [Requisitos previos](#2-requisitos-previos)
3. [Stack Docker — GenieACS + MongoDB](#3-stack-docker--genieacs--mongodb)
4. [Variables de entorno](#4-variables-de-entorno)
5. [Dockerfiles](#5-dockerfiles)
6. [Configuración nginx y Caddy](#6-configuración-nginx-y-caddy)
7. [Base de datos — Migraciones Supabase](#7-base-de-datos--migraciones-supabase)
8. [Backend Node/Hono — Rutas TR-069](#8-backend-nodehono--rutas-tr-069)
9. [Servicio de métricas](#9-servicio-de-métricas)
10. [Post-arranque: sembrar GenieACS](#10-post-arranque-sembrar-genieacs)
11. [Flujos de datos clave](#11-flujos-de-datos-clave)
12. [Comandos OLT Huawei MA5800](#12-comandos-olt-huawei-ma5800)
13. [Actualizar en producción](#13-actualizar-en-producción)
14. [Checklist de réplica](#14-checklist-de-réplica)

---

## 1. Arquitectura general

```
┌─────────────────────────────────────────────────────┐
│  OLT Huawei MA5800 (SSH)                            │
│  Configura ONUs con: ont tr069-server-config        │
└──────────────────────┬──────────────────────────────┘
                       │ OMCI → ONU recibe ACS URL
                       ▼
┌─────────────────────────────────────────────────────┐
│  ONT/CPE (EchoLife HG8145X6, etc.)                  │
│  Inform periódico CWMP → :7547                      │
└──────────────────────┬──────────────────────────────┘
                       │ TR-069 (HTTP/CWMP)
                       ▼
┌─────────────────────────────────────────────────────┐
│  GenieACS Stack (Docker)                            │
│  ├─ genieacs-cwmp  :7547  ← Inform de ONTs          │
│  ├─ genieacs-nbi   :7557  ← API REST interna        │
│  ├─ genieacs-fs    :7567  ← Servidor de archivos    │
│  ├─ genieacs-ui    :3001  ← Panel web               │
│  └─ mongodb        :27017 ← BD de GenieACS          │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP REST (NBI)
                       ▼
┌─────────────────────────────────────────────────────┐
│  Backend Hono (Node.js :3002)                       │
│  ├─ /api/genieacs/*       → Proxy NBI               │
│  ├─ /api/tr069-sync       → Sync GenieACS→Supabase  │
│  └─ /api/genieacs-sync/*  → Sync métricas           │
└──────────────────────┬──────────────────────────────┘
                       │ REST API (postgREST)
                       ▼
┌─────────────────────────────────────────────────────┐
│  Supabase (PostgreSQL + RLS)                        │
│  ├─ tr069_devices                                   │
│  ├─ tr069_performance_metrics                       │
│  ├─ olt_tr069_server_profiles                       │
│  └─ tr069_parameter_* (framework)                   │
└─────────────────────────────────────────────────────┘
```

**Regla clave:** la BD de fosmikro vive en **Supabase** (nube). El MongoDB local es **solo de GenieACS**.

---

## 2. Requisitos previos

### Hardware mínimo (on-prem)
- CPU: 2 núcleos (ARM64 o AMD64)
- RAM: 4 GB (GenieACS + Mongo + backend + frontend)
- Disco: 20 GB libres
- Red: IP fija en la LAN del ISP (para que las ONTs alcancen :7547)

### Software
- **Docker Engine** ≥ 24 + **Docker Compose** v2 (`docker compose`, no `docker-compose`)
- **Git**
- **Node.js** ≥ 20 + **npm** (solo para desarrollo local con PM2)
- **PM2** global: `npm install -g pm2` (solo desarrollo local)

### Puertos que deben estar abiertos en el firewall
| Puerto | Protocolo | Destino | Para qué |
|--------|-----------|---------|---------|
| 7547 | TCP | LAN / ONTs | CWMP Inform de ONTs |
| 7557 | TCP | localhost/LAN | GenieACS NBI (API interna) |
| 7567 | TCP | localhost/LAN | GenieACS FS (firmware) |
| 3001 | TCP | localhost | GenieACS UI |
| 3000 | TCP | localhost | Panel fosmikro (Vite dev) |
| 3002 | TCP | localhost | Backend Hono |
| 443/80 | TCP | exterior | HTTPS (si se usa Caddy) |

---

## 3. Stack Docker — GenieACS + MongoDB

### 3.1 Desarrollo local (`docker-compose.yml`)

Usa este archivo para desarrollo: GenieACS con puertos expuestos para acceso directo.

```yaml
version: '3.8'

services:
  mongodb:
    image: mongo:6
    container_name: genieacs-mongo
    restart: unless-stopped
    volumes:
      - mongo_data:/data/db
    ports:
      - "27017:27017"

  genieacs-cwmp:
    image: genieacs/genieacs:1.2
    container_name: genieacs-cwmp
    restart: unless-stopped
    command: genieacs-cwmp
    environment:
      GENIEACS_MONGODB_CONNECTION_URL: mongodb://mongodb/genieacs
      GENIEACS_CWMP_ACCESS_LOG_FILE: /opt/genieacs/var/access.log
      GENIEACS_DEBUG_FILE: /opt/genieacs/var/debug.yaml
      GENIEACS_EXT_DIR: /opt/genieacs/ext
    ports:
      - "7547:7547"
    depends_on:
      - mongodb
    volumes:
      - genieacs_ext:/opt/genieacs/ext
      - genieacs_var:/opt/genieacs/var

  genieacs-nbi:
    image: genieacs/genieacs:1.2
    container_name: genieacs-nbi
    restart: unless-stopped
    command: genieacs-nbi
    environment:
      GENIEACS_MONGODB_CONNECTION_URL: mongodb://mongodb/genieacs
      GENIEACS_EXT_DIR: /opt/genieacs/ext
    ports:
      - "7557:7557"
    depends_on:
      - mongodb
    volumes:
      - genieacs_ext:/opt/genieacs/ext

  genieacs-fs:
    image: genieacs/genieacs:1.2
    container_name: genieacs-fs
    restart: unless-stopped
    command: genieacs-fs
    environment:
      GENIEACS_MONGODB_CONNECTION_URL: mongodb://mongodb/genieacs
      GENIEACS_FS_PORT: "7567"
    ports:
      - "7567:7567"
    depends_on:
      - mongodb

  genieacs-ui:
    image: genieacs/genieacs:1.2
    container_name: genieacs-ui
    restart: unless-stopped
    command: genieacs-ui
    environment:
      GENIEACS_MONGODB_CONNECTION_URL: mongodb://mongodb/genieacs
      GENIEACS_UI_PORT: "3001"
    ports:
      - "3001:3001"
    depends_on:
      - mongodb

  # FreeRADIUS (opcional — solo si radius_mode='docker' en el tenant)
  freeradius:
    image: freeradius/freeradius-server:3.2.3
    container_name: fosmikro-freeradius
    restart: unless-stopped
    ports:
      - "${RADIUS_AUTH_PORT:-1812}:1812/udp"
      - "${RADIUS_ACCT_PORT:-1813}:1813/udp"
      - "${RADIUS_COA_PORT:-3799}:3799/udp"
    volumes:
      - ./radius/raddb:/etc/raddb:ro
      - radius-logs:/var/log/freeradius
    networks:
      - fosmikro_net
    environment:
      TZ: ${TZ:-America/Guayaquil}
    healthcheck:
      test: ["CMD-SHELL", "pgrep freeradius || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  mongo_data:
  genieacs_ext:
  genieacs_var:
  radius-logs:

networks:
  fosmikro_net:
    driver: bridge
```

**Levantar:**
```bash
docker compose up -d
```

### 3.2 Producción on-prem con HTTPS (`docker-compose.onprem.yml`)

Stack completo: Caddy (TLS automático) + frontend (nginx) + backend + GenieACS + MongoDB.

```yaml
# fosmikro — stack ON-PREM con dominio fijo + HTTPS automático via Caddy/Let's Encrypt.
# Base de datos en Supabase (nube). MongoDB aquí es solo de GenieACS.
# Requisito: port-forward 80 y 443 → este equipo. No-IP DUC para fiberops.sytes.net.
#
# Uso: docker compose -f docker-compose.onprem.yml up -d --build
name: fosmikro

services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./deploy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - frontend
    networks: [fosmikro_net]

  frontend:
    build:
      context: .
      dockerfile: deploy/Dockerfile.frontend
      args:
        VITE_SUPABASE_URL: ${VITE_SUPABASE_URL}
        VITE_SUPABASE_ANON_KEY: ${VITE_SUPABASE_ANON_KEY}
    restart: unless-stopped
    depends_on:
      - backend
    networks: [fosmikro_net]

  backend:
    build:
      context: .
      dockerfile: deploy/Dockerfile.backend
    restart: unless-stopped
    env_file: .env
    environment:
      BACKEND_PORT: "3002"
      GENIEACS_NBI: "http://genieacs-nbi:7557"
    depends_on:
      - genieacs-nbi
    networks: [fosmikro_net]

  mongodb:
    image: mongo:6
    restart: unless-stopped
    volumes:
      - mongo_data:/data/db
    networks: [fosmikro_net]

  genieacs-cwmp:
    image: genieacs/genieacs:1.2
    restart: unless-stopped
    command: genieacs-cwmp
    environment:
      GENIEACS_MONGODB_CONNECTION_URL: mongodb://mongodb/genieacs
      GENIEACS_EXT_DIR: /opt/genieacs/ext
    ports:
      - "7547:7547"
    depends_on: [mongodb]
    volumes:
      - genieacs_ext:/opt/genieacs/ext
      - genieacs_var:/opt/genieacs/var
    networks: [fosmikro_net]

  genieacs-nbi:
    image: genieacs/genieacs:1.2
    restart: unless-stopped
    command: genieacs-nbi
    environment:
      GENIEACS_MONGODB_CONNECTION_URL: mongodb://mongodb/genieacs
      GENIEACS_EXT_DIR: /opt/genieacs/ext
    depends_on: [mongodb]
    volumes:
      - genieacs_ext:/opt/genieacs/ext
    networks: [fosmikro_net]

  genieacs-fs:
    image: genieacs/genieacs:1.2
    restart: unless-stopped
    command: genieacs-fs
    environment:
      GENIEACS_MONGODB_CONNECTION_URL: mongodb://mongodb/genieacs
      GENIEACS_FS_PORT: "7567"
    ports:
      - "7567:7567"
    depends_on: [mongodb]
    networks: [fosmikro_net]

  genieacs-ui:
    image: genieacs/genieacs:1.2
    restart: unless-stopped
    command: genieacs-ui
    environment:
      GENIEACS_MONGODB_CONNECTION_URL: mongodb://mongodb/genieacs
      GENIEACS_UI_PORT: "3001"
    ports:
      - "3001:3001"
    depends_on: [mongodb]
    networks: [fosmikro_net]

  freeradius:
    image: freeradius/freeradius-server:3.2.3
    restart: unless-stopped
    ports:
      - "${RADIUS_AUTH_PORT:-1812}:1812/udp"
      - "${RADIUS_ACCT_PORT:-1813}:1813/udp"
      - "${RADIUS_COA_PORT:-3799}:3799/udp"
    volumes:
      - ./radius/raddb:/etc/raddb:ro
      - radius-logs:/var/log/freeradius
    environment:
      TZ: ${TZ:-America/Guayaquil}
    networks: [fosmikro_net]

networks:
  fosmikro_net:
    driver: bridge

volumes:
  mongo_data:
  genieacs_ext:
  genieacs_var:
  radius-logs:
  caddy_data:
  caddy_config:
```

**Levantar:**
```bash
docker compose -f docker-compose.onprem.yml up -d --build
```

---

## 4. Variables de entorno

Crea un archivo `.env` en la raíz del proyecto:

```bash
# .env — copiar como base, rellenar con valores reales
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...  # anon key de Supabase
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...  # service role key (privada, solo backend)

# GenieACS NBI — URL que usa el backend para contactar la API de GenieACS
# En Docker on-prem: http://genieacs-nbi:7557
# En desarrollo local: http://192.168.100.136:7557 (IP de la máquina en la LAN)
GENIEACS_NBI=http://192.168.100.136:7557

# Puerto del backend (Hono)
BACKEND_PORT=3002

# FreeRADIUS (opcional)
RADIUS_AUTH_PORT=1812
RADIUS_ACCT_PORT=1813
RADIUS_COA_PORT=3799
TZ=America/Guayaquil
```

> **Importante:** `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` se hornean en el build del frontend.
> Si cambias estos valores, debes hacer un nuevo `--build`.

---

## 5. Dockerfiles

### `deploy/Dockerfile.backend`

```dockerfile
# Backend fosmikro (Node + Hono, ejecutado con tsx). ARM64/AMD64.
FROM node:20-slim

# Toolchain para módulos nativos (ssh2, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

ENV NODE_ENV=production
EXPOSE 3002

CMD ["npx", "tsx", "server/src/index.ts"]
```

### `deploy/Dockerfile.frontend`

```dockerfile
# Frontend fosmikro: build Vite + nginx. ARM64/AMD64.
# Usa `npx vite build` (no `npm run build`) — vue-tsc puede tener errores de tipo.
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

RUN npx vite build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

---

## 6. Configuración nginx y Caddy

### `deploy/nginx.conf` — SPA + proxy `/api`

```nginx
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  location /api/ {
    proxy_pass http://backend:3002;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 90s;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }

  location /assets/ {
    expires 30d;
    add_header Cache-Control "public, immutable";
  }
}
```

### `deploy/Caddyfile` — HTTPS automático on-prem

```caddyfile
# Cambia el email y el dominio por los tuyos.
{
    email admin@TU-DOMINIO.com
}

TU-DOMINIO.com {
    encode gzip zstd

    # Todo el tráfico al frontend (nginx interno).
    # nginx a su vez proxya /api/* al backend.
    reverse_proxy frontend:80

    reverse_proxy /api/* frontend:80 {
        transport http {
            read_timeout 120s
            write_timeout 120s
        }
    }
}
```

**Requisitos para Let's Encrypt:**
- El dominio debe resolver a tu IP pública (usa No-IP DUC o similar).
- Port-forward 80 y 443 en el router → esta máquina.

---

## 7. Base de datos — Migraciones Supabase

Ejecutar en orden en el SQL Editor de Supabase (o `supabase db push`).

### Migración 029 — Tabla `tr069_devices`

```sql
-- Dispositivos TR-069/CWMP gestionados por GenieACS
CREATE TABLE IF NOT EXISTS tr069_devices (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  genieacs_id         TEXT        NOT NULL UNIQUE, -- formato: "OUI-ProductClass-SerialNumber"
  cpe_oui             TEXT,                        -- ej. "00D09E"
  cpe_product_class   TEXT,                        -- ej. "EchoLife HG8145X6"
  cpe_serial          TEXT        NOT NULL,        -- ej. "48575443A1234567"
  service_contract_id UUID        REFERENCES service_contracts(id) ON DELETE SET NULL,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tr069_devices_contract_unique
  ON tr069_devices (service_contract_id)
  WHERE service_contract_id IS NOT NULL;

ALTER TABLE tr069_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_manage_tr069"
  ON tr069_devices FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION set_tr069_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER tr069_devices_set_updated_at
  BEFORE UPDATE ON tr069_devices
  FOR EACH ROW EXECUTE FUNCTION set_tr069_updated_at();
```

### Migración 030 — Columnas de caché en `tr069_devices`

```sql
-- Permiten mostrar datos aunque GenieACS esté offline
ALTER TABLE tr069_devices
  ADD COLUMN IF NOT EXISTS last_seen_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS model_name        TEXT,
  ADD COLUMN IF NOT EXISTS firmware_version  TEXT,
  ADD COLUMN IF NOT EXISTS wan_ip            TEXT,
  ADD COLUMN IF NOT EXISTS ssid              TEXT;

CREATE INDEX IF NOT EXISTS tr069_devices_wan_ip_idx ON tr069_devices (wan_ip)
  WHERE wan_ip IS NOT NULL;
```

### Migración 068 — Framework de parámetros TR-069

```sql
-- Sistema flexible para definir qué parámetros TR-069 recolectar

CREATE TABLE IF NOT EXISTS tr069_parameter_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parameter_path VARCHAR(500) UNIQUE NOT NULL,
  parameter_name VARCHAR(200) NOT NULL,
  description TEXT,
  data_type VARCHAR(50) NOT NULL,
  readable BOOLEAN DEFAULT TRUE,
  writable BOOLEAN DEFAULT FALSE,
  access_list_template TEXT,
  default_value TEXT,
  min_value VARCHAR(100),
  max_value VARCHAR(100),
  allowed_values TEXT[],
  category VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_param_def_category ON tr069_parameter_definitions(category);
CREATE INDEX idx_param_def_path ON tr069_parameter_definitions(parameter_path);

CREATE TABLE IF NOT EXISTS tr069_monitor_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_name VARCHAR(200) NOT NULL,
  description TEXT,
  enabled BOOLEAN DEFAULT TRUE,
  parameter_ids UUID[] NOT NULL DEFAULT '{}',
  collection_interval_seconds INT DEFAULT 300,
  retry_count INT DEFAULT 3,
  parameter_timeout_seconds INT DEFAULT 30,
  applicable_onu_models UUID[] DEFAULT NULL,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_monitor_profiles_tenant ON tr069_monitor_profiles(tenant_id);
CREATE INDEX idx_monitor_profiles_enabled ON tr069_monitor_profiles(enabled);

CREATE TABLE IF NOT EXISTS onu_monitor_profile_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tr069_device_id UUID NOT NULL REFERENCES tr069_devices(id) ON DELETE CASCADE,
  monitor_profile_id UUID NOT NULL REFERENCES tr069_monitor_profiles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP DEFAULT NOW(),
  assigned_by_user_id UUID REFERENCES auth.users(id),
  active BOOLEAN DEFAULT TRUE,
  last_collection_time TIMESTAMP,
  next_collection_time TIMESTAMP,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE(tr069_device_id, monitor_profile_id)
);

CREATE TABLE IF NOT EXISTS tr069_parameter_values (
  id BIGSERIAL PRIMARY KEY,
  tr069_device_id UUID NOT NULL REFERENCES tr069_devices(id) ON DELETE CASCADE,
  parameter_id UUID NOT NULL REFERENCES tr069_parameter_definitions(id),
  parameter_value TEXT NOT NULL,
  value_type VARCHAR(50),
  collection_timestamp TIMESTAMP NOT NULL,
  collection_status VARCHAR(50) DEFAULT 'success',
  error_message TEXT,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX idx_param_values_device_time ON tr069_parameter_values(tr069_device_id, collection_timestamp DESC);
CREATE INDEX idx_param_values_param_time ON tr069_parameter_values(parameter_id, collection_timestamp DESC);
CREATE INDEX idx_param_values_tenant ON tr069_parameter_values(tenant_id);

ALTER TABLE tr069_monitor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE onu_monitor_profile_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tr069_parameter_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tr069_profiles_tenant_isolation" ON tr069_monitor_profiles
  FOR ALL TO authenticated
  USING (tenant_id = public.get_tenant_id() OR public.is_superadmin())
  WITH CHECK (tenant_id = public.get_tenant_id() OR public.is_superadmin());

CREATE POLICY "onu_profile_assign_tenant_isolation" ON onu_monitor_profile_assignments
  FOR ALL TO authenticated
  USING (tenant_id = public.get_tenant_id() OR public.is_superadmin())
  WITH CHECK (tenant_id = public.get_tenant_id() OR public.is_superadmin());

CREATE POLICY "param_values_tenant_isolation" ON tr069_parameter_values
  FOR ALL TO authenticated
  USING (tenant_id = public.get_tenant_id() OR public.is_superadmin())
  WITH CHECK (tenant_id = public.get_tenant_id() OR public.is_superadmin());

-- Seed de parámetros comunes
INSERT INTO tr069_parameter_definitions (parameter_path, parameter_name, description, data_type, readable, writable, category)
VALUES
  ('Device.DeviceInfo.SerialNumber',   'Serial Number',   'Número de serie',     'string', TRUE, FALSE, 'device_info'),
  ('Device.DeviceInfo.HardwareVersion','Hardware Version','Versión del hardware', 'string', TRUE, FALSE, 'device_info'),
  ('Device.DeviceInfo.SoftwareVersion','Software Version','Versión del firmware', 'string', TRUE, FALSE, 'device_info'),
  ('Device.DeviceInfo.Manufacturer',   'Manufacturer',    'Fabricante',          'string', TRUE, FALSE, 'device_info')
ON CONFLICT (parameter_path) DO NOTHING;
```

### Migración 069 — Métricas de desempeño

```sql
CREATE TABLE IF NOT EXISTS tr069_performance_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tr069_device_id UUID NOT NULL REFERENCES tr069_devices(id) ON DELETE CASCADE,
  rx_power NUMERIC(5,2),           -- dBm
  tx_power NUMERIC(5,2),           -- dBm
  uptime INTEGER,                  -- segundos
  latency INTEGER,                 -- ms
  packet_loss NUMERIC(5,2),        -- %
  bandwidth_usage NUMERIC(5,2),    -- %
  cpu_usage NUMERIC(5,2),          -- %
  memory_usage NUMERIC(5,2),       -- %
  connection_status VARCHAR(50),   -- 'connected', 'disconnected', 'degraded'
  collected_at TIMESTAMP NOT NULL DEFAULT NOW(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_metrics_device ON tr069_performance_metrics(tr069_device_id);
CREATE INDEX idx_metrics_tenant ON tr069_performance_metrics(tenant_id);
CREATE INDEX idx_metrics_collected ON tr069_performance_metrics(collected_at DESC);
CREATE INDEX idx_metrics_device_time ON tr069_performance_metrics(tr069_device_id, collected_at DESC);

ALTER TABLE tr069_performance_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "metrics_tenant_isolation" ON tr069_performance_metrics
  FOR ALL TO authenticated
  USING (tenant_id = public.get_tenant_id() OR public.is_superadmin())
  WITH CHECK (tenant_id = public.get_tenant_id() OR public.is_superadmin());
```

### Migración 073 — Perfiles TR-069 server (OLT)

```sql
CREATE TABLE IF NOT EXISTS olt_tr069_server_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  olt_device_id UUID NOT NULL REFERENCES olt_devices(id) ON DELETE CASCADE,
  profile_id INTEGER NOT NULL,       -- ID en la OLT (1-32)
  profile_name TEXT NOT NULL,        -- ej. "genieacs"
  acs_url TEXT NOT NULL,             -- ej. http://192.168.100.136:7547
  acs_username TEXT,
  acs_password TEXT,
  inform_interval INTEGER DEFAULT 300,
  conn_req_username TEXT,
  conn_req_password TEXT,
  source TEXT DEFAULT 'managed',     -- 'system' o 'managed'
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  scanned_at TIMESTAMP,
  UNIQUE(olt_device_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_olt_tr069_server_profiles_tenant_id  ON olt_tr069_server_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_olt_tr069_server_profiles_device_id  ON olt_tr069_server_profiles(olt_device_id);
CREATE INDEX IF NOT EXISTS idx_olt_tr069_server_profiles_profile_id ON olt_tr069_server_profiles(profile_id);

ALTER TABLE olt_tr069_server_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "olt_tr069_server_profiles_access" ON olt_tr069_server_profiles
  FOR ALL TO authenticated
  USING  (tenant_id IS NULL OR is_superadmin() OR tenant_id = get_tenant_id())
  WITH CHECK (tenant_id IS NULL OR is_superadmin() OR tenant_id = get_tenant_id());

COMMENT ON TABLE olt_tr069_server_profiles IS 'Configuración de servidores ACS para gestión remota TR-069 de ONUs';
COMMENT ON COLUMN olt_tr069_server_profiles.acs_url IS 'URL del servidor ACS (ej: http://192.168.100.50:7547/)';
COMMENT ON COLUMN olt_tr069_server_profiles.inform_interval IS 'Intervalo de reporte en segundos (default: 300)';
```

### Migración 074 — Backfill y columnas `acs_ip` / `is_default`

```sql
-- Agrega columnas + copia perfiles desde extra_params JSON → tabla
ALTER TABLE olt_tr069_server_profiles
  ADD COLUMN IF NOT EXISTS acs_ip     TEXT,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false;

INSERT INTO olt_tr069_server_profiles (
  tenant_id, olt_device_id, profile_id, profile_name,
  acs_url, acs_ip, acs_username, acs_password,
  conn_req_username, conn_req_password, is_default, source
)
SELECT
  d.tenant_id, d.id,
  (p->>'profile_id')::int,
  COALESCE(NULLIF(p->>'profile_name', ''), 'genieacs'),
  COALESCE(p->>'acs_url', ''),
  p->>'acs_ip', p->>'acs_username', p->>'acs_password',
  p->>'cr_username', p->>'cr_password',
  (
    (d.extra_params->>'default_tr069_profile_id') IS NOT NULL
    AND (d.extra_params->>'default_tr069_profile_id') ~ '^\d+$'
    AND (p->>'profile_id')::int = (d.extra_params->>'default_tr069_profile_id')::int
  ),
  'managed'
FROM olt_devices d,
     jsonb_array_elements(d.extra_params->'tr069_profiles') AS p
WHERE d.extra_params IS NOT NULL
  AND d.extra_params ? 'tr069_profiles'
  AND jsonb_typeof(d.extra_params->'tr069_profiles') = 'array'
  AND (p->>'profile_id') ~ '^\d+$'
ON CONFLICT (olt_device_id, profile_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_olt_tr069_server_profiles_default
  ON olt_tr069_server_profiles(olt_device_id)
  WHERE is_default = true;

COMMENT ON COLUMN olt_tr069_server_profiles.acs_ip IS 'IP del ACS que la ONU usa para conectar';
COMMENT ON COLUMN olt_tr069_server_profiles.is_default IS 'Perfil predeterminado en la OLT para nuevas ONUs';
```

---

## 8. Backend Node/Hono — Rutas TR-069

### `server/src/routes/genieacs.ts` — Proxy reverso al NBI

Reenvía cualquier petición autenticada de la UI al NBI de GenieACS. La sesión JWT de Supabase actúa como guardián; GenieACS no requiere auth en la red interna.

```typescript
import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth.js'

const NBI = process.env.GENIEACS_NBI || 'http://192.168.100.136:7557'

const router = new Hono()
router.use('*', authMiddleware)

router.all('*', async c => {
  const rawUrl  = new URL(c.req.url)
  const full    = rawUrl.pathname
  const prefix  = '/api/genieacs'
  const subPath = full.startsWith(prefix) ? full.slice(prefix.length) || '/' : full
  const query   = rawUrl.search

  let body: Buffer | undefined
  if (c.req.method === 'POST' || c.req.method === 'PUT') {
    const ab = await c.req.arrayBuffer()
    body = Buffer.from(ab)
  }

  try {
    const fwdHeaders: Record<string, string> = {}
    for (const [k, v] of c.req.raw.headers.entries()) {
      if (!['host', 'connection', 'transfer-encoding', 'te', 'trailers', 'upgrade'].includes(k.toLowerCase())) {
        fwdHeaders[k] = v
      }
    }
    if (body?.length && !fwdHeaders['content-type']) fwdHeaders['content-type'] = 'application/json'

    const upstream = await fetch(`${NBI}${subPath}${query}`, {
      method:  c.req.method,
      headers: fwdHeaders,
      body:    body?.length ? (body as unknown as BodyInit) : undefined,
      signal:  AbortSignal.timeout(60_000),
    })

    const text        = await upstream.text()
    const contentType = upstream.headers.get('content-type') ?? 'application/json'

    return new Response(text, {
      status:  upstream.status,
      headers: { 'Content-Type': contentType },
    })
  } catch (e: any) {
    return c.json({ error: `GenieACS NBI no disponible: ${e?.message ?? 'Error de conexión'}` }, 502)
  }
})

export default router
```

**Registrar en `server/src/index.ts`:**
```typescript
import genieacsRouter from './routes/genieacs.js'
app.route('/api/genieacs', genieacsRouter)
```

### `server/src/routes/tr069sync.ts` — Sincronización GenieACS → Supabase

Sincroniza la lista de dispositivos de GenieACS a la tabla `tr069_devices`. Llamar manualmente o desde un scheduler.

```typescript
import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth.js'
import type { AppEnv } from '../types.js'

const router = new Hono<AppEnv>()
router.use('*', authMiddleware)

function pick(param: any): string | null {
  return param?._value !== undefined ? String(param._value) : null
}

function wanIp(dev: any): string | null {
  for (const wcd of Object.values(dev?.InternetGatewayDevice?.WANDevice ?? {}) as any[])
    for (const wip of Object.values(wcd?.WANConnectionDevice ?? {}) as any[]) {
      for (const c of Object.values(wip?.WANPPPConnection ?? {}) as any[]) {
        const ip = pick(c?.ExternalIPAddress); if (ip) return ip
      }
      for (const c of Object.values(wip?.WANIPConnection ?? {}) as any[]) {
        const ip = pick(c?.ExternalIPAddress); if (ip) return ip
      }
    }
  return null
}

function ssid(dev: any): string | null {
  for (const lan of Object.values(dev?.InternetGatewayDevice?.LANDevice ?? {}) as any[])
    for (const wlan of Object.values((lan as any)?.WLANConfiguration ?? {}) as any[]) {
      const s = pick((wlan as any)?.SSID); if (s) return s
    }
  return null
}

const svcHdrs = () => ({
  'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  'apikey':        process.env.SUPABASE_SERVICE_ROLE_KEY!,
  'Content-Type':  'application/json',
  'Prefer':        'return=minimal',
})
const supUrl = () => process.env.VITE_SUPABASE_URL!

router.post('/', async c => {
  try {
    const tenantId     = c.get('tenantId') as string | null
    const userRole     = c.get('userRole') as string | null
    const isSuperadmin = userRole === 'superadmin'

    const NBI = process.env.GENIEACS_NBI || 'http://192.168.100.136:7557'
    const genieRes = await fetch(`${NBI}/devices`)
    if (!genieRes.ok) return c.json({ ok: false, error: 'GenieACS NBI no disponible' }, 502)

    const devices: any[] = await genieRes.json()

    const tenantFilter = (!isSuperadmin && tenantId) ? `&tenant_id=eq.${tenantId}` : ''
    const supRes  = await fetch(`${supUrl()}/rest/v1/tr069_devices?select=id,genieacs_id${tenantFilter}`, { headers: svcHdrs() })
    const records: any[] = await supRes.json()
    const recMap  = new Map<string, string>(records.map((r: any) => [r.genieacs_id, r.id]))

    const allRes: any[] = await (await fetch(`${supUrl()}/rest/v1/tr069_devices?select=genieacs_id`, { headers: svcHdrs() })).json()
    const allIds = new Set<string>((allRes ?? []).map((r: any) => r.genieacs_id))

    let synced = 0, created = 0
    const ops: Promise<Response>[] = []
    for (const dev of devices) {
      const info  = dev.InternetGatewayDevice?.DeviceInfo
      const recId = recMap.get(dev._id)
      if (recId) {
        const patchFilter = `id=eq.${recId}${(!isSuperadmin && tenantId) ? `&tenant_id=eq.${tenantId}` : ''}`
        ops.push(fetch(`${supUrl()}/rest/v1/tr069_devices?${patchFilter}`, {
          method: 'PATCH', headers: svcHdrs(),
          body: JSON.stringify({
            last_seen_at:     dev._lastInform ?? null,
            model_name:       pick(info?.ModelName) ?? pick(info?.Manufacturer),
            firmware_version: pick(info?.SoftwareVersion),
            wan_ip:           wanIp(dev),
            ssid:             ssid(dev),
            updated_at:       new Date().toISOString(),
          }),
        }))
        synced++
      } else if (tenantId && !allIds.has(dev._id)) {
        const parts = String(dev._id).split('-')
        ops.push(fetch(`${supUrl()}/rest/v1/tr069_devices`, {
          method: 'POST', headers: svcHdrs(),
          body: JSON.stringify({
            genieacs_id:       dev._id,
            cpe_oui:           parts[0] ?? null,
            cpe_product_class: parts.length > 2 ? parts.slice(1, -1).join('-').replace(/%2D/gi, '-') : null,
            cpe_serial:        pick(info?.SerialNumber) ?? parts[parts.length - 1] ?? dev._id,
            tenant_id:         tenantId,
            last_seen_at:      dev._lastInform ?? null,
            model_name:        pick(info?.ModelName) ?? pick(info?.Manufacturer),
            firmware_version:  pick(info?.SoftwareVersion),
            wan_ip:            wanIp(dev),
            ssid:              ssid(dev),
          }),
        }))
        created++
      }
    }
    await Promise.all(ops)
    return c.json({ ok: true, synced, created, total: devices.length })
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message ?? 'Error al sincronizar' }, 502)
  }
})

export default router
```

**Registrar:**
```typescript
import tr069syncRouter from './routes/tr069sync.js'
app.route('/api/tr069-sync', tr069syncRouter)
```

---

## 9. Servicio de métricas

### `server/src/services/genieacsMetricsService.ts`

Extrae métricas del árbol TR-069 y las persiste en `tr069_performance_metrics`.

**Rutas candidatas por métrica (multi-marca):**

```typescript
const METRIC_CANDIDATES: Record<string, string[]> = {
  rx_power: [
    'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.RXPower',    // Huawei (typo intencional)
    'InternetGatewayDevice.WANDevice.1.X_CMCC_GponInterfaceConfig.RXPower', // ZTE/CMCC
    'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower', // China Telecom
  ],
  tx_power: [
    'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.TXPower',
    'InternetGatewayDevice.WANDevice.1.X_CMCC_GponInterfaceConfig.TXPower',
    'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.TXPower',
  ],
  temperature: [
    'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.TransceiverTemperature',
    'InternetGatewayDevice.WANDevice.1.X_CMCC_GponInterfaceConfig.TransceiverTemperature',
  ],
  uptime: [
    'InternetGatewayDevice.DeviceInfo.UpTime',
    'Device.DeviceInfo.UpTime',
  ],
  connection_status: [
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ConnectionStatus',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ConnectionStatus',
  ],
}
```

> **Truco de normalización:**
> - Huawei: potencia ya en dBm (`|v| ≤ 40`).
> - ZTE/CMCC: potencia en décimas de µW (SFF-8472), convertir con `10 * log10(v / 10000)`.
> - Temperatura Huawei: en °C. ZTE: en 1/256 °C (`v / 256`).

**Endpoint de sincronización manual:**
```
POST /api/genieacs-sync/metrics               → todos los tenants
POST /api/genieacs-sync/metrics/tenant/:id    → un tenant
POST /api/genieacs-sync/metrics/device/:id    → un dispositivo
```

---

## 10. Post-arranque: sembrar GenieACS

Tras el primer `docker compose up`, GenieACS arranca sin configuración. Hay que sembrar:

### 10.1 Provision `refresh` (refrescar árbol completo)

Crear vía NBI o la UI de GenieACS (`http://localhost:3001`):

```javascript
// Provision "refresh" — corre en cada Inform
// Registra todo el árbol de parámetros (nivel por nivel)
declare("InternetGatewayDevice", {path: 1, object: 1});
declare("InternetGatewayDevice.*", {path: 1, object: 1});
declare("InternetGatewayDevice.*.*", {path: 1, value: Date.now(), object: 1});
declare("InternetGatewayDevice.*.*.*", {path: 1, value: Date.now()});
```

**Vía NBI (curl):**
```bash
curl -X PUT http://localhost:7557/provisions/refresh \
  -H "Content-Type: application/json" \
  -d '{"script": "declare(\"InternetGatewayDevice\", {path:1,object:1});\ndeclare(\"InternetGatewayDevice.*\", {path:1,object:1});\ndeclare(\"InternetGatewayDevice.*.*\", {path:1,value:Date.now(),object:1});\ndeclare(\"InternetGatewayDevice.*.*.*\", {path:1,value:Date.now()});"}'
```

### 10.2 Preset `inform-refresh` (aplicar provision en cada Inform)

```bash
curl -X PUT http://localhost:7557/presets/inform-refresh \
  -H "Content-Type: application/json" \
  -d '{
    "weight": 100,
    "precondition": "true",
    "configurations": [
      {"type": "provision", "name": "refresh"}
    ]
  }'
```

### 10.3 Sembrar configuración de UI (si aparece vacía)

Si la UI de GenieACS no muestra dispositivos correctamente, sembrar los 107 documentos de config por defecto:

```bash
# Copiar defaults de la imagen
docker exec genieacs-ui cat /opt/genieacs/lib/init.ts \
  | grep -A 999999 'db.config' > /tmp/genieacs-init-config.js

# Alternativa: conectar a Mongo directamente y borrar caché
docker exec genieacs-mongo mongosh genieacs --eval \
  'db.cache.deleteMany({_id: /^ui\/|^cwmp\//})'
```

Luego reiniciar GenieACS UI:
```bash
docker compose restart genieacs-ui
```

### 10.4 Verificar que las ONTs están llegando

```bash
# Ver todos los dispositivos en GenieACS
curl http://localhost:7557/devices | jq '.[].{id: ._id, last: ._lastInform}'

# Ver parámetros de una ONU específica
curl "http://localhost:7557/devices/OUI-ProductClass-Serial" | jq '.'
```

---

## 11. Flujos de datos clave

### Flujo A: ONU se registra por primera vez

```
OLT (SSH) → ont tr069-server-config 0 1 profile-id 3
         ↓ OMCI → ONU recibe ACS URL (http://192.168.100.136:7547)
ONU → Inform → GenieACS CWMP :7547
         ↓ provision "refresh" corre
GenieACS NBI: ONU aparece con ~900 parámetros
         ↓ sync manual o scheduler
POST /api/tr069-sync → Supabase tr069_devices INSERT
```

### Flujo B: Sincronización periódica de caché

```
Scheduler (PM2 / cron)
  → POST /api/tr069-sync
  → GenieACS NBI GET /devices
  → Para cada device: PATCH tr069_devices (last_seen_at, model, firmware, wan_ip, ssid)
```

### Flujo C: Recolección de métricas ópticas

```
POST /api/genieacs-sync/metrics
  → Para cada tenant → para cada device en tr069_devices
  → GenieACS NBI GET /devices/?query={"_id":"..."}
  → extractMetricsFromGenieACS() → normaliza dBm y °C
  → INSERT tr069_performance_metrics
  → evaluateAlerts() → crea alertas si rx_power < umbral
```

### Flujo D: Cambio de WiFi vía TR-069

```
UI → PUT /api/genieacs (proxy) → NBI POST /devices/{id}/tasks
  → task: {name:"setParameterValues", parameterValues:[["...SSID", "nuevo-ssid", "xsd:string"],...]}
  → GenieACS espera siguiente Inform y ejecuta la tarea
  → ONU aplica nueva config WiFi
```

---

## 12. Comandos OLT Huawei MA5800

### Apuntar ONU a perfil TR-069

```
# Conectar a la OLT (SSH en 10.100.0.2 o 192.168.100.2)
# MA5800> enable → config

# Asignar perfil TR-069 a una ONU específica
ont tr069-server-config <puerto> <ont-id> profile-id <profile-id>

# Ejemplo: puerto 0, ONU id 1, perfil 3 (GenieACS)
ont tr069-server-config 0 1 profile-id 3
```

> **Perfiles comunes en fiberops.sytes.net:**
> - Perfil 1: SmartOLT (ACS externo)
> - Perfil 2: GenieACS local (http://192.168.100.136:7547)
> - Perfil 3: GenieACS local (id actualizado)

### Ver perfiles TR-069 configurados en la OLT

```
display ont tr069-server-profile all
```

### Ver qué perfil tiene una ONU específica

```
display ont info <puerto> <ont-id>
```

### Crear un nuevo perfil TR-069 en la OLT

```
ont-srvprofile gpon profile-id <id> profile-name <nombre>
  tr069-server
    acs-url <url>          # ej. http://192.168.100.136:7547
    acs-username <user>
    acs-password <pass>
    inform-interval 300
    connection-request-username <cr-user>
    connection-request-password <cr-pass>
  quit
commit
```

---

## 13. Actualizar en producción

### Script automático (`deploy/update.sh`)

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1/4  git pull =="
git pull --ff-only

echo "== 2/4  build + up (solo recrea lo que cambió) =="
docker compose -f docker-compose.onprem.yml up -d --build

echo "== 3/4  limpieza de imágenes viejas =="
docker image prune -f

echo "== 4/4  estado =="
docker compose -f docker-compose.onprem.yml ps
```

Ejecutar: `bash deploy/update.sh`

### Ver logs en tiempo real

```bash
docker compose -f docker-compose.onprem.yml logs -f backend
docker compose -f docker-compose.onprem.yml logs -f genieacs-cwmp
docker logs -f genieacs-nbi
```

### Backup de MongoDB (datos GenieACS)

```bash
# Exportar
docker exec genieacs-mongo mongodump --db genieacs --archive=/tmp/genie-backup.gz --gzip
docker cp genieacs-mongo:/tmp/genie-backup.gz ./backup-genieacs-$(date +%Y%m%d).gz

# Restaurar
docker cp ./backup-genieacs-YYYYMMDD.gz genieacs-mongo:/tmp/
docker exec genieacs-mongo mongorestore --db genieacs --archive=/tmp/backup-genieacs-YYYYMMDD.gz --gzip
```

---

## 14. Checklist de réplica

### Infraestructura
- [ ] Docker Engine ≥ 24 instalado
- [ ] Puerto 7547 alcanzable desde la LAN de ONTs
- [ ] Dominio / DDNS configurado (si se usa HTTPS)
- [ ] Port-forward 80 y 443 en el router (si se usa Caddy)

### Archivos de configuración
- [ ] `.env` creado con todos los valores
- [ ] `deploy/Caddyfile` con el dominio correcto (si se usa HTTPS)

### Base de datos
- [ ] Ejecutar migración 029 (`tr069_devices`)
- [ ] Ejecutar migración 030 (columnas de caché)
- [ ] Ejecutar migración 068 (framework de parámetros)
- [ ] Ejecutar migración 069 (métricas de desempeño)
- [ ] Ejecutar migración 073 (perfiles TR-069 server)
- [ ] Ejecutar migración 074 (backfill + acs_ip/is_default)

### Docker
- [ ] `docker compose up -d` (desarrollo) o `docker compose -f docker-compose.onprem.yml up -d --build` (producción)
- [ ] Verificar que los 5 contenedores GenieACS están `Up`
- [ ] Verificar que la UI de GenieACS responde en `:3001`

### GenieACS post-arranque
- [ ] Crear provision `refresh` (via NBI o UI)
- [ ] Crear preset `inform-refresh`
- [ ] Verificar que las ONTs aparecen en la UI tras el primer Inform
- [ ] Confirmar que cada ONU tiene ~900 parámetros (no solo ~1)

### OLT Huawei MA5800
- [ ] Crear perfil TR-069 en la OLT apuntando a `http://<IP-servidor>:7547`
- [ ] Asignar el perfil a las ONUs: `ont tr069-server-config <port> <ont-id> profile-id <id>`
- [ ] Verificar registro en GenieACS UI

### Backend fosmikro
- [ ] Variable `GENIEACS_NBI` apuntando a la IP correcta
- [ ] Endpoint `/api/tr069-sync` responde con `{ok: true}`
- [ ] Endpoint `/api/genieacs/devices` devuelve lista de devices

### Verificación final
- [ ] Panel fosmikro → `/tr069/devices` muestra los dispositivos
- [ ] Detalle de un dispositivo muestra parámetros WAN y WiFi
- [ ] Sync de métricas: `POST /api/genieacs-sync/metrics` guarda registros en Supabase

---

*Generado el 2026-09-11 desde el proyecto fosmikro, rama `feat/instalaciones-registro`.*
