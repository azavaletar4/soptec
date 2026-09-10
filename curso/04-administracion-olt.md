# FASE 4 — Administración OLT

## ISP Manager Fosmikro — Curso de Desarrollo

---

## Tabla de Contenidos

- [4.0 Arquitectura OLT](#40-arquitectura-olt)
- [4.1 Gestión de OLTs](#41-gestión-de-olts)
- [4.2 OLT Cards](#42-olt-cards)
- [4.3 PON Ports](#43-pon-ports)
- [4.4 Uplink Ports](#44-uplink-ports)
- [4.5 VLANs](#45-vlans)
- [4.6 Profiles (Speed Profiles)](#46-profiles-speed-profiles)
- [4.7 Profile TR-069 (Line Profiles)](#47-profile-tr-069-line-profiles)
- [4.8 Backup](#48-backup)
- [4.9 Diagrama de Flujo SSH](#49-diagrama-de-flujo-ssh)
- [4.10 Prompt Claude para crear el módulo OLT completo](#410-prompt-claude-para-crear-el-módulo-olt-completo)

---

## 4.0 Arquitectura OLT

### Visión general

El módulo OLT es el corazón técnico del sistema. Permite que el navegador web emita comandos SSH a una OLT física (Huawei MA5800, V-SOL, etc.) sin que el usuario final conozca las credenciales del equipo ni tenga acceso de red directo a él. Todo el tráfico SSH pasa por el backend Hono, que actúa como proxy seguro.

### Tecnología utilizada

| Capa | Tecnología |
|------|------------|
| Frontend | Vue 3 + TypeScript + Pinia |
| Backend (proxy SSH) | Hono (Node.js) en `server/src/index.ts` |
| Librería SSH | `ssh2` (Node.js) |
| Base de datos | Supabase PostgreSQL (tabla `olt_devices`) |
| Autenticación | Supabase Auth + RLS por `tenant_id` |

### Tabla `olt_devices`

```sql
CREATE TABLE olt_devices (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  nombre      TEXT NOT NULL,
  host        TEXT NOT NULL,         -- IP o hostname de la OLT
  brand       TEXT NOT NULL,         -- 'huawei' | 'vsol'
  ssh_port    INT  DEFAULT 22,
  username    TEXT NOT NULL,
  password    TEXT NOT NULL,         -- cifrado en tránsito, no expuesto al frontend
  zona        TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

> **Nota de seguridad:** La contrasena SSH de la OLT nunca se devuelve al frontend. El frontend solo conoce el `id` del dispositivo. El backend recupera las credenciales directamente de Supabase usando el service role key (privado).

### Proxy SSH en Hono

Cada solicitud del frontend que requiere datos en tiempo real de la OLT sigue este ciclo de vida:

1. El frontend llama a `POST /api/olt-ssh` con `{ olt_id, command }`.
2. Hono busca las credenciales del OLT en Supabase (con service role).
3. Hono abre una conexión SSH a la OLT usando la librería `ssh2`.
4. Ejecuta el comando, captura el output completo.
5. Cierra la sesión SSH.
6. Parsea el texto plano y devuelve JSON al frontend.

```typescript
// server/src/routes/olt-ssh.ts (esquema simplificado)
import { Hono } from 'hono'
import { Client } from 'ssh2'

const app = new Hono()

app.post('/api/olt-ssh', async (c) => {
  const { olt_id, command } = await c.req.json()

  // 1. Obtener credenciales desde Supabase (service role)
  const { data: olt } = await supabaseAdmin
    .from('olt_devices')
    .select('host, ssh_port, username, password, brand')
    .eq('id', olt_id)
    .single()

  // 2. Ejecutar SSH
  const output = await runSshCommand({
    host: olt.host,
    port: olt.ssh_port,
    username: olt.username,
    password: olt.password,
    command,
  })

  // 3. Limpiar paginacion Huawei
  const clean = output.replace(/---- More \( Press Q to break \) ----\r?\n?/g, '')

  return c.json({ output: clean })
})
```

### Marcas soportadas y deteccion de prompt

Cada marca de OLT tiene un patron de prompt diferente. El backend espera ese patron para saber cuándo el comando terminó de ejecutarse.

| Marca | `promptRe` (expresion regular) |
|-------|-------------------------------|
| Huawei MA5800 | `/[#>]\s*\r?$/` |
| V-SOL | `/[#>]\s*\r?$/` |

La logica de espera dentro de `ssh2` acumula los chunks de datos hasta que el buffer termina en un patron que coincida con `promptRe`. Recien entonces resuelve la promesa y devuelve el output completo.

### Paginacion Huawei MA5800

La MA5800 inserta el banner `---- More ( Press Q to break ) ----` cada 24 lineas de output. Para eliminar este artefacto del texto parseado se aplica esta limpieza despues de recibir el output completo:

```typescript
const cleanOutput = raw.replace(
  /---- More \( Press Q to break \) ----\r?\n?/g,
  ''
)
```

Alternativamente se puede enviar el comando con ` | no-more` al final (cuando la OLT lo admite):

```
display board 0 | no-more
```

---

## 4.1 Gestión de OLTs

### Descripcion

La vista principal de OLTs permite al administrador del ISP registrar, editar y eliminar los equipos OLT de su red. Es el punto de entrada para todas las demas funciones del modulo.

**Vista:** `src/views/olt/OltView.vue`

### Campos del formulario

| Campo | Tipo | Descripcion |
|-------|------|-------------|
| Nombre | texto | Identificador amigable (ej. "OLT-Principal") |
| Host | texto | IP o hostname de la OLT |
| Marca | selector | Huawei / V-SOL |
| Puerto SSH | numero | Por defecto 22 |
| Usuario | texto | Usuario SSH de la OLT |
| Contrasena | password | Contrasena SSH (nunca se muestra de vuelta) |
| Zona | texto | Zona geografica o sector del ISP |

### Operaciones CRUD

```
GET    /api/olt-devices          → listar OLTs del tenant
POST   /api/olt-devices          → crear nueva OLT
PUT    /api/olt-devices/:id      → editar OLT existente
DELETE /api/olt-devices/:id      → eliminar OLT
POST   /api/olt-devices/:id/test → test de conectividad SSH
```

### Test de conectividad SSH

El boton "Probar conexion" ejecuta un comando inocuo (como `display version`) y devuelve:

- **OK:** tiempo de respuesta en ms + version del firmware
- **Error:** mensaje de error SSH (host inalcanzable, credenciales incorrectas, timeout)

```typescript
// Ejemplo de respuesta exitosa
{
  "status": "ok",
  "ms": 142,
  "version": "MA5800-X15 V800R022C10"
}

// Ejemplo de error
{
  "status": "error",
  "message": "ECONNREFUSED - Connection refused at 192.168.1.10:22"
}
```

### RLS y multitenancy

La tabla `olt_devices` tiene RLS habilitado. Solo los usuarios del mismo `tenant_id` pueden ver y modificar sus OLTs. El backend valida ademas que el `olt_id` pertenezca al tenant del JWT antes de ejecutar cualquier comando SSH.

---

## 4.2 OLT Cards

### Descripcion

Muestra las tarjetas fisicas (boards/slots) instaladas en el chasis de la OLT. En la MA5800 cada slot puede alojar tarjetas de linea PON (GPBD, GPHF) o tarjetas de control (SCUN, PRTE).

### Comando SSH Huawei

```
display board 0
```

El `0` es el numero de frame (chasis). En una OLT con un solo chasis siempre es `0`.

### Ejemplo de salida cruda

```
BRD  Type         Status          SubType  SubStatus  Online/Offline
0    --            --              --       --         --
1    SCUN          Active_normal   --       --         --
2    PRTE          Active_normal   --       --         --
3    --            --              --       --         --
4    GPBH          Normal          --       --         --
5    GPBH          Normal          --       --         --
```

### Logica de parseo

```typescript
function parseBoardOutput(raw: string): Board[] {
  const lines = raw.split('\n').filter(l => /^\s*\d+/.test(l))
  return lines.map(line => {
    const parts = line.trim().split(/\s+/)
    return {
      slot:      parts[0],
      type:      parts[1] ?? '--',
      status:    parts[2] ?? '--',
      subType:   parts[3] ?? '--',
      subStatus: parts[4] ?? '--',
    }
  })
}
```

### Visualizacion en Vue

La tabla resultante muestra un badge de color por estado:

| Estado | Color |
|--------|-------|
| `Active_normal` | Verde |
| `Normal` | Azul |
| `--` (vacio) | Gris |
| `Failed` | Rojo |

---

## 4.3 PON Ports

### Descripcion

Lista todos los puertos PON de una tarjeta especifica. Cada puerto PON conecta fisicamente las fibras opticas que llegan a los domicilios de los clientes (a traves de splitters).

### Comando SSH Huawei

```
display port state 0/X
```

Donde `X` es el numero de slot de la tarjeta (ej. `0/4` para el slot 4).

### Ejemplo de salida cruda

```
F/S/P   AdminState  OperState  Loopback  Desc
0/4/0   up          up         --        Puerto-Sector-Norte
0/4/1   up          up         --        --
0/4/2   up          down       --        --
0/4/3   down        down       --        --
```

### Logica de parseo

```typescript
function parsePonPorts(raw: string): PonPort[] {
  const lines = raw.split('\n').filter(l => /^\d+\/\d+\/\d+/.test(l.trim()))
  return lines.map(line => {
    const [fsp, admin, oper, loopback, ...descParts] = line.trim().split(/\s+/)
    const [frame, slot, port] = fsp.split('/')
    return {
      fsp,
      frame: Number(frame),
      slot:  Number(slot),
      port:  Number(port),
      adminState: admin,
      operState:  oper,
      loopback,
      description: descParts.join(' ') || '--',
    }
  })
}
```

### Indicadores visuales

- `up / up` → icono verde (puerto activo con trafico)
- `up / down` → icono amarillo (puerto habilitado pero sin seal optica)
- `down / down` → icono rojo (puerto administrativamente apagado)

---

## 4.4 Uplink Ports

### Descripcion

Los puertos de uplink son los puertos Ethernet o de fibra de alta capacidad que conectan la OLT hacia el nucleo de la red (router, switch de distribucion). Monitorear su estado es critico para saber si la OLT tiene conexion hacia internet.

### Comando SSH Huawei

```
display interface GigabitEthernet brief
```

Para puertos de 10G:

```
display interface XGigabitEthernet brief
```

### Ejemplo de salida cruda

```
Interface                   PHY   Protocol InUti OutUti   inErr  outErr
GigabitEthernet 0/9/0       up    up       0.01% 0.02%    0      0
GigabitEthernet 0/9/1       down  down     0%    0%       0      0
XGigabitEthernet 0/10/0     up    up       12%   8%       0      0
```

### Logica de parseo

```typescript
function parseUplinkPorts(raw: string): UplinkPort[] {
  const lines = raw.split('\n').filter(l =>
    /GigabitEthernet|XGigabitEthernet/.test(l)
  )
  return lines.map(line => {
    const parts = line.trim().split(/\s+/)
    return {
      interface:  parts[0] + ' ' + parts[1],
      phyState:   parts[2],
      protocol:   parts[3],
      inUtil:     parts[4],
      outUtil:    parts[5],
      inErrors:   Number(parts[6]),
      outErrors:  Number(parts[7]),
    }
  })
}
```

---

## 4.5 VLANs

### Descripcion

Las VLANs segmentan el trafico de los clientes. Cada ONU/cliente puede estar en una VLAN especifica. Este modulo permite gestionar las VLANs directamente desde la aplicacion web, sin necesidad de acceder a la OLT por consola.

### Migracion SQL (migración 031)

```sql
CREATE TABLE olt_vlans (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id),
  olt_id     UUID NOT NULL REFERENCES olt_devices(id),
  vlan_id    INT  NOT NULL CHECK (vlan_id BETWEEN 1 AND 4094),
  nombre     TEXT NOT NULL,
  tipo       TEXT NOT NULL DEFAULT 'smart',  -- 'smart' | 'standard' | 'mux'
  descripcion TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (olt_id, vlan_id)
);
```

### Tipos de VLAN en Huawei MA5800

| Tipo | Descripcion |
|------|-------------|
| `smart` | VLAN inteligente, soporta traduccion de VLAN (N:1) |
| `standard` | VLAN estandar IEEE 802.1Q |
| `mux` | Multiplexacion, cada ONU en una VLAN separada (1:1) |

### Operaciones CRUD

```
GET    /api/olt-vlans?olt_id=X      → listar VLANs de una OLT
POST   /api/olt-vlans               → crear VLAN
PUT    /api/olt-vlans/:id           → editar VLAN
DELETE /api/olt-vlans/:id           → eliminar VLAN
```

### Ejemplo de formulario de creacion

```
Nombre VLAN:   [Internet-Residencial    ]
VLAN ID:       [100                     ]
Tipo:          [smart       v           ]
OLT:           [OLT-Principal v         ]
Descripcion:   [Clientes residenciales  ]
```

---

## 4.6 Profiles (Speed Profiles)

### Descripcion

Los perfiles de velocidad definen los anchos de banda que se asignan a cada ONU en el momento del provisionamiento. Permiten aplicar rapidamente un plan comercial (ej. 20 Mbps, 50 Mbps, 100 Mbps) sin tener que recordar los valores exactos en kbps.

### Migracion SQL (migración 034)

```sql
CREATE TABLE olt_speed_profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  nombre        TEXT NOT NULL,
  upstream_kbps   INT NOT NULL,    -- ancho de banda subida en kbps
  downstream_kbps INT NOT NULL,    -- ancho de banda bajada en kbps
  prioridad     INT  DEFAULT 0,    -- 0-7, prioridad QoS
  descripcion   TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

### Ejemplos de perfiles tipicos en un ISP

| Nombre | Downstream | Upstream | Prioridad |
|--------|-----------|----------|-----------|
| Plan-10M | 10,240 kbps | 5,120 kbps | 0 |
| Plan-20M | 20,480 kbps | 10,240 kbps | 0 |
| Plan-50M | 51,200 kbps | 25,600 kbps | 1 |
| Plan-100M | 102,400 kbps | 51,200 kbps | 2 |
| VIP-200M | 204,800 kbps | 102,400 kbps | 4 |

### Uso en provisionamiento de ONUs

Cuando se registra una ONU nueva, el tecnico selecciona un perfil de velocidad del selector. El backend toma los valores `upstream_kbps` y `downstream_kbps` para construir el comando de provisionamiento SSH hacia la OLT.

```typescript
// Fragmento del comando de provision Huawei
const cmd = `
  ont-srvprofile gpon profile-id ${profileId} profile-name "${profile.nombre}"
  tcont 1 dba-profile-id ${dbaId}
  gem add 1 eth tcont 1
  commit
`
```

---

## 4.7 Profile TR-069 (Line Profiles)

### Descripcion

Los perfiles de linea TR-069 definen la configuracion que se envia automaticamente a las ONUs que soportan el protocolo TR-069 (CWMP). Esto permite la gestion remota de routers y ONUs sin acceso fisico al domicilio del cliente.

### Migracion SQL (migración 034)

```sql
CREATE TABLE olt_line_profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  nombre          TEXT NOT NULL,
  templateType    TEXT NOT NULL DEFAULT 'tr069',
  enableTR069     BOOLEAN DEFAULT true,
  acsUrl          TEXT,            -- URL del servidor ACS (ej. http://acs.misp.com:7547)
  acsUsername     TEXT,            -- usuario para autenticacion en ACS
  acsPassword     TEXT,            -- contrasena para autenticacion en ACS
  periodicInform  BOOLEAN DEFAULT true,
  informInterval  INT DEFAULT 86400,  -- segundos entre cada inform (86400 = 1 dia)
  descripcion     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### Relacion con `tr069_devices`

```
olt_line_profiles  →  tr069_devices  →  ONU fisica
(configuracion)       (dispositivo      (hardware en
                        registrado)      la red)
```

Cuando una ONU se provisionaa con un line profile TR-069:

1. La OLT envia la URL del ACS a la ONU por OMCI.
2. La ONU abre una conexion HTTPS al servidor ACS.
3. El servidor ACS (GenieACS o similar) toma control de la ONU.
4. Fosmikro consulta el estado TR-069 via la tabla `tr069_devices`.

### Campos del formulario

```
Nombre perfil:       [TR069-Residencial          ]
ACS URL:             [http://192.168.1.5:7547     ]
ACS Usuario:         [admin                       ]
ACS Contrasena:      [••••••••                    ]
Inform periodico:    [x] Habilitado
Intervalo inform:    [86400       ] segundos
```

---

## 4.8 Backup

### Descripcion

El modulo de backup descarga la configuracion completa de la OLT mediante SSH y la almacena en Supabase. Permite recuperar la configuracion en caso de fallo de hardware o configuracion incorrecta.

### Migracion SQL (migración 035)

```sql
CREATE TABLE olt_backups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  olt_id      UUID NOT NULL REFERENCES olt_devices(id),
  contenido   TEXT NOT NULL,       -- texto plano de la configuracion completa
  tamano_kb   INT,                 -- tamano en kilobytes
  creado_por  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### Comando SSH de backup Huawei

```
display current-configuration
```

Este comando devuelve toda la configuracion activa de la OLT. En equipos grandes puede superar 500KB de texto. La paginacion Huawei debe ser eliminada antes de almacenar.

### Flujo de backup

```
1. Usuario pulsa "Hacer Backup"
2. Frontend → POST /api/olt-backup { olt_id }
3. Backend abre SSH → ejecuta "display current-configuration"
4. Backend limpia paginacion (regex)
5. Backend calcula tamano en KB
6. Backend inserta en olt_backups (Supabase)
7. Frontend muestra confirmacion con timestamp y tamano
```

### Listado y descarga de backups

```typescript
// Listar backups de una OLT
GET /api/olt-backups?olt_id=X

// Descargar backup como archivo .txt
GET /api/olt-backups/:id/download
// → Content-Disposition: attachment; filename="backup-OLT-Principal-2026-08-20.txt"
```

---

## 4.9 Diagrama de Flujo SSH

### Flujo completo de una solicitud

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Vue 3)                        │
│                                                                 │
│   OltView.vue                                                   │
│   ┌──────────────────────────────────────┐                      │
│   │  useOltStore (Pinia)                 │                      │
│   │  → fetch('/api/olt-ssh', {           │                      │
│   │      olt_id: "uuid-abc",             │                      │
│   │      command: "display board 0"      │                      │
│   │    })                                │                      │
│   └──────────────────┬───────────────────┘                      │
└──────────────────────┼──────────────────────────────────────────┘
                       │  HTTP POST (JSON)
                       │  Authorization: Bearer <JWT>
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND (Hono / Node.js)                     │
│                                                                 │
│   /api/olt-ssh                                                  │
│   ┌──────────────────────────────────────┐                      │
│   │  1. Verificar JWT (Supabase Auth)    │                      │
│   │  2. Obtener credenciales OLT         │                      │
│   │     (Supabase service role)          │                      │
│   │  3. Abrir conexion SSH (ssh2)        │                      │
│   │  4. Ejecutar comando                 │                      │
│   │  5. Esperar prompt (promptRe)        │                      │
│   │  6. Limpiar paginacion Huawei        │                      │
│   │  7. Cerrar SSH                       │                      │
│   │  8. Parsear texto → JSON             │                      │
│   └──────────────────┬───────────────────┘                      │
└──────────────────────┼──────────────────────────────────────────┘
                       │  SSH (puerto 22 o custom)
                       │  Credenciales del OLT
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                   OLT FISICA (Huawei MA5800)                    │
│                                                                 │
│   ┌──────────────────────────────────────┐                      │
│   │  MA5800#                             │                      │
│   │  MA5800# display board 0             │                      │
│   │  BRD  Type   Status ...              │                      │
│   │  1    SCUN   Active_normal ...       │                      │
│   │  4    GPBH   Normal ...              │                      │
│   │  MA5800#  ← promptRe detectado      │                      │
│   └──────────────────────────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
                       │
                       │  Texto plano (output SSH)
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                  PARSEO Y RESPUESTA JSON                        │
│                                                                 │
│   {                                                             │
│     "boards": [                                                 │
│       { "slot": "1", "type": "SCUN",                           │
│         "status": "Active_normal" },                            │
│       { "slot": "4", "type": "GPBH",                           │
│         "status": "Normal" }                                    │
│     ]                                                           │
│   }                                                             │
└─────────────────────────────────────────────────────────────────┘
```

### Tiempos de respuesta esperados

| Operacion | Tiempo tipico |
|-----------|--------------|
| Test de conectividad SSH | 100 - 400 ms |
| `display board 0` | 200 - 800 ms |
| `display port state 0/X` | 300 - 1,000 ms |
| `display current-configuration` (backup) | 5,000 - 30,000 ms |

---

## 4.10 Prompt Claude para crear el módulo OLT completo

El siguiente prompt esta disenado para enviarse a Claude Code (claude-sonnet-4-6 o superior) desde el directorio del proyecto `D:/fosmikro`. Genera todos los archivos del modulo OLT de una sola vez.

---

```
Eres un senior developer Vue 3 + TypeScript + Hono + Supabase.
Genera el módulo completo de administración OLT para el proyecto
ISP Manager Fosmikro con la siguiente especificación exacta:

=== CONTEXTO DEL PROYECTO ===
- Vue 3 + TypeScript + Vite 8 + Tailwind CSS 4 + Pinia
- Backend: Hono (Node.js) en server/src/routes/
- Base de datos: Supabase PostgreSQL + RLS por tenant_id
- Librería SSH: ssh2 (ya instalada)
- Node v24, sin CommonJS, solo ESM
- Rutas ya existentes: server/src/index.ts (registra routers)

=== TABLAS SUPABASE (ya existen en producción) ===
- olt_devices: id, tenant_id, nombre, host, brand, ssh_port,
               username, password, zona, created_at
- olt_vlans: id, tenant_id, olt_id, vlan_id, nombre, tipo,
             descripcion, created_at
- olt_speed_profiles: id, tenant_id, nombre, upstream_kbps,
                      downstream_kbps, prioridad, descripcion,
                      created_at
- olt_line_profiles: id, tenant_id, nombre, templateType,
                     enableTR069, acsUrl, acsUsername, acsPassword,
                     periodicInform, informInterval, descripcion,
                     created_at
- olt_backups: id, tenant_id, olt_id, contenido, tamano_kb,
               creado_por, created_at

=== ARCHIVOS A GENERAR ===

1. server/src/routes/olt.ts
   - CRUD /api/olt-devices (GET, POST, PUT /:id, DELETE /:id)
   - POST /api/olt-devices/:id/test → test conectividad SSH
   - CRUD /api/olt-vlans
   - CRUD /api/olt-speed-profiles
   - CRUD /api/olt-line-profiles
   - CRUD /api/olt-backups
   - GET /api/olt-backups/:id/download → descarga como .txt

2. server/src/ssh/olt-client.ts
   - Función runOltCommand(params): Promise<string>
     params: { host, port, username, password, command, brand }
   - Usa promptRe = /[#>]\s*\r?$/ para detectar fin de output
   - Limpia paginación Huawei automáticamente
   - Timeout configurable (default 30s)
   - Devuelve el output limpio como string

3. server/src/ssh/parsers.ts
   - parseBoardOutput(raw: string): Board[]
   - parsePonPorts(raw: string): PonPort[]
   - parseUplinkPorts(raw: string): UplinkPort[]
   Cada función con sus tipos TypeScript correspondientes.

4. src/stores/olt.ts (Pinia)
   - Estado: olts[], vlans[], speedProfiles[], lineProfiles[],
             backups[], loading, error
   - Actions: fetchOlts, createOlt, updateOlt, deleteOlt,
              testOlt, fetchVlans, createVlan, etc.
   - Usa $fetch (ofetch) para llamadas al backend

5. src/views/olt/OltView.vue
   - Tabla de OLTs con acciones: editar, eliminar, probar
   - Modal de creación/edición (todos los campos)
   - Badge de estado de conectividad (OK / Error / Sin probar)
   - Botón "Ver detalles" → navega a /olt/:id

6. src/views/olt/OltDetailView.vue
   - Tabs: Cards | PON Ports | Uplink | VLANs | Profiles |
           Line Profiles | Backups
   - Tab Cards: tabla con slots de la OLT (display board 0)
   - Tab PON Ports: selector de slot + tabla de puertos
   - Tab Uplink: tabla de puertos GigabitEthernet
   - Tab VLANs: CRUD de VLANs de esta OLT
   - Tab Profiles: CRUD de speed profiles del tenant
   - Tab Line Profiles: CRUD de line profiles TR-069
   - Tab Backups: lista de backups + botón "Hacer backup ahora"
   Cada tab hace fetch bajo demanda (lazy loading).

=== REQUISITOS DE ESTILO ===
- Tailwind CSS 4 (sintaxis moderna con @theme)
- Mismo estilo visual que el resto de la app:
  clases base: bg-white dark:bg-gray-900, rounded-xl, shadow-sm
  botones primarios: bg-blue-600 hover:bg-blue-700 text-white
  badges: rounded-full px-2 py-0.5 text-xs font-medium
- Skeletons de carga con animate-pulse mientras se obtiene data
- Mensajes de error con toast (usar la composable useToast ya
  existente en src/composables/useToast.ts)

=== REQUISITOS TÉCNICOS ===
- Todo TypeScript estricto, sin any implícito
- Composables Vue con <script setup lang="ts">
- El backend valida que olt_id pertenezca al tenant del JWT
  antes de ejecutar cualquier comando SSH
- Manejar correctamente el caso donde la OLT no responde
  (timeout SSH de 30s → devolver error 504)
- Los passwords nunca se devuelven en ningún GET

=== NO GENERES ===
- Migraciones SQL (ya existen)
- Tests unitarios
- Documentación adicional

Genera todos los archivos completos, sin omitir código,
sin usar "// ... resto del código". Cada archivo debe ser
funcional y listo para usar en producción.
```

---

### Como usar el prompt

1. Abre una terminal en `D:/fosmikro`.
2. Ejecuta `claude` para abrir Claude Code.
3. Pega el prompt completo.
4. Claude Code generara los 6 archivos. Revisalos en este orden:
   - Primero `server/src/ssh/olt-client.ts` (es la base)
   - Luego `server/src/ssh/parsers.ts`
   - Luego `server/src/routes/olt.ts`
   - Luego `src/stores/olt.ts`
   - Finalmente las vistas Vue

5. Registra el router en `server/src/index.ts`:

```typescript
import oltRouter from './routes/olt'
app.route('/', oltRouter)
```

6. Agrega las rutas Vue en `src/router/index.ts`:

```typescript
{
  path: '/olt',
  name: 'olt',
  component: () => import('../views/olt/OltView.vue'),
  meta: { requiresAuth: true }
},
{
  path: '/olt/:id',
  name: 'olt-detail',
  component: () => import('../views/olt/OltDetailView.vue'),
  meta: { requiresAuth: true }
},
```

---

*FASE 4 — Administracion OLT | ISP Manager Fosmikro | Version 2026-08-20*
