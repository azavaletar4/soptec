El documento fue generado en `D:/fosmikro/docs/curso/fase5-gestion-ont-onu.md`.

Aqui esta el contenido completo del documento:

---

# FASE 5 — Gestión ONT/ONU

---

## 5.0 ¿Qué es una ONU/ONT?

### Diferencia entre ONU y ONT

| Término | Significado | Uso típico |
|---------|------------|------------|
| **ONU** (Optical Network Unit) | Unidad que puede servir a varios usuarios | Edificios, multi-usuario |
| **ONT** (Optical Network Terminal) | Terminal para un solo abonado | Hogares, negocios individuales |

En equipos Huawei MA5800 y en Fosmikro, ambos se usan indistintamente. La convención del sistema es **ONT**.

### Tipos de tecnologia PON

| Tipo | Downstream | Upstream |
|------|-----------|---------|
| GPON | 2.5 Gbps | 1.25 Gbps |
| XGS-PON | 10 Gbps | 10 Gbps |
| XG-PON | 10 Gbps | 2.5 Gbps |

El campo `gpon_capabilities` en `olt_onu_types` registra qué tecnologías soporta cada modelo (array `{gpon}`, `{gpon,xg-pon}`, etc.).

### Jerarquía OLT → PON Port → ONT → Cliente

```
OLT (MA5800-X7)
 ├── Tarjeta slot 0
 │    ├── PON Port 0
 │    │    ├── ONT 0  ← Cliente A (HWTC12345678)
 │    │    ├── ONT 1  ← Cliente B
 │    │    └── ONT N  (hasta 128 por puerto GPON)
 │    └── PON Port 7
 └── Tarjeta slot 1 ...

Notación F/S/P — ejemplo: 0/0/3 = frame 0, slot 0, puerto 3
```

---

## 5.1 ONUs Registradas y Registro de nuevas

Los datos de la ONT no tienen tabla separada; viven en `service_contracts` (migración `010_olt.sql`):

```sql
olt_device_id  UUID    -- referencia a olt_devices
olt_serial     VARCHAR -- ej: HWTC12345678
olt_frame      INTEGER -- generalmente 0
olt_slot       INTEGER
olt_port       INTEGER
olt_ont_id     INTEGER -- ID asignado en ese puerto
olt_extra      JSONB
```

**Vista `OnuListView.vue`** — Funciones clave:
- Selector de OLT → selector F/S/P → consulta ONTs via SSH
- Tipo `OltOnt` con 30+ campos: serial, run_state, rx_power, tx_power, client_name, plan, zona, VLAN, IP asignada, MAC WAN
- Cache de leases MikroTik para resolver MAC → IP en tiempo real
- Paginación de 50 por página
- Ping individual por ONU (`/api/ping`)

**Proceso de registro:**

1. En la OLT ejecutar `display ont autofind all` para ver ONUs en espera
2. Copiar el serial (ej. `HWTC12345678`) al formulario en Fosmikro
3. El backend Hono ejecuta via SSH:

```
enable
config
interface gpon 0/0
ont add 3 0 sn-auth "HWTC12345678" omci ont-lineprofile-id 10 ont-srvprofile-id 10 desc "APELLIDO"
ont ipconfig 3 0 static ip-address 192.168.95.100 mask 255.255.255.0 gateway 192.168.95.1
service-port vlan 100 gpon 0/0/3 ont 0 gemport 1 multi-service user-vlan 100 rx-cttr 6 tx-cttr 6
```

4. Verificar: `display ont info 0/0/3 0` — `Run state` debe ser `online`

---

## 5.2 Planes de Velocidad (Speed Profiles)

**Tabla `olt_speed_profiles`** (migración 012):

```sql
name           text       -- nombre del perfil
direction      text       -- 'download' | 'upload'
type           text       -- 'internet' | 'iptv'
speed_kbps     integer    -- ej: 10240 = 10 Mbps
lineprofile_id integer    -- line profile asociado en la OLT
traffic_inbound / traffic_outbound  -- índices en traffic table OLT
is_default_download boolean        -- único índice parcial
```

**Vista `SpeedProfileView.vue`** — Funciones:
- CRUD local en Supabase
- Panel "Importar desde OLT": muestra `display traffic table ip` de la OLT y permite importar índices inbound/outbound como plan
- Asocia line profile al plan (`lineprofile_id`)

Al provisionar: el `lineprofile_id` del plan va al comando `ont add ... ont-lineprofile-id X`, y los índices de traffic van en `rx-cttr`/`tx-cttr` del service-port.

---

## 5.3 Tipos de ONUs

**Tabla `olt_onu_types`** (migración 013) — campos clave:

| Campo | Descripción |
|-------|-------------|
| `gpon_capabilities` | Array de tecnologías: `{gpon,xg-pon,xgs-pon}` |
| `capability` | `bridging` = bridge puro. `bridging_routing` = tiene IP propia (TR-069) |
| `default_speed_profile_id` | Plan asignado por defecto al registrar esta ONU |
| `allow_custom_profile` | Permite cambiar line profile en el registro |
| `use_default_image` | Si false, usa `image_url` en Supabase Storage |

**Vista `OnuTypesView.vue`**: CRUD + upload de imagen a Storage (migración `022_olt_device_images_bucket.sql`).

**Modelos Huawei comunes en Ecuador:**

| Modelo | ETH | WiFi | VoIP | Capacidad |
|--------|-----|------|------|-----------|
| HG8010H | 1 | No | No | bridging |
| HG8546M | 4 | Si | Si | bridging_routing |
| EG8145V5 | 4 | Si | Si | bridging_routing |
| MA5671A | 1 | No | No | bridging |

---

## 5.4 Line Profile

Un `ont-lineprofile` define la capa de transporte GPON:
- **TCONT**: contenedor de transmisión upstream, regido por un perfil DBA
- **DBA Profile**: tipo de ancho de banda (fixed/assured/best-effort) y límites kbps
- **GEM Port**: canal virtual dentro del TCONT
- **Mapping**: asocia VLAN de servicio al GEM port

**Vista `LineProfileView.vue`** — formulario reactive:

```typescript
const form = reactive({
  profile_id:     1,
  profile_name:   '',
  tcont_id:       4,
  dba_profile_id: 1,
  gem_id:         1,
  vlan:           null,
  // Modo TR-069:
  dba0_id:        2,   // datos
  dba1_id:        10,  // gestión ACS
  tr069_ip_index: 0,
})
```

Cuando `tr069Mode = true`, se generan comandos con doble TCONT/GEM: uno para datos del cliente y otro para tráfico de gestión hacia el ACS TR-069.

**Tabla `olt_line_profiles_info`** (migración 034):
- `source = 'managed'`: creado desde Fosmikro
- `source = 'system'`: preexistente en la OLT, importado por escaneo
- `binding_times`: cuántos ONTs usan actualmente este perfil

**Cadena de relaciones:**
```
olt_line_profiles_info.profile_id
    ← olt_speed_profiles.lineprofile_id
        ← service_contracts.plan_id
```

---

## 5.5 ONU IP Pools

**Tabla `olt_ip_pools`** (migración 032):

```sql
olt_device_id  UUID   -- a qué OLT pertenece este pool
pool_type      text   -- 'mgmt' (gestión) | 'wan_static' (IP pública cliente)
network_cidr   text   -- ej: 192.168.95.0/24
gateway        text   -- ej: 192.168.95.1
dns1/dns2      text
vlan_id        integer
```

**Tabla `olt_ip_allocations`**: registra qué IP fue asignada a qué contrato.

**Vista `OltIpPoolsView.vue`**: ver IPs libres/ocupadas/reservadas, obtener la próxima disponible. Al provisionar con IP estática, el sistema consulta el endpoint `/api/olt/ip-pools/:id/next-available`.

---

## 5.6 Diagrama de provisioning

```
+------------------+
|  ALUMNO/ADMIN    |
+------------------+
        |
        v
Registrar Cliente ──────→ BD: tabla clients
        |
        v
Crear Contrato ──────────→ service_contracts
(plan, olt_serial,         (olt_serial, olt_port,
 olt_port...)               olt_ont_id)
        |
        v
Seleccionar ONU
- Tipo ONU      ← olt_onu_types
- Speed Profile ← olt_speed_profiles
- Line Profile  ← olt_line_profiles_info
- IP Pool       ← olt_ip_pools
        |
        v
Backend Hono (SSH) ──────→ OLT MA5800
                           enable / config
                           interface gpon 0/0
                           ont add 3 0 sn-auth "HWTC..."
                           ont ipconfig 3 0 static ...
                           service-port vlan 100 ...
        |                           |
        v                           v
Actualiza BD               ONU ONLINE
is_synced_olt = true       run_state: online
                                    |
                                    v
                           MikroTik asigna IP
                           via PPPoE/DHCP
```

**Estados posibles de una ONT:**

| run_state | config_state | match_state | Significado |
|-----------|-------------|-------------|-------------|
| `online` | `normal` | `match` | Todo correcto |
| `online` | `failed` | `mismatch` | Perfil no coincide |
| `offline` | `normal` | `match` | ONU apagada o sin luz |
| `online` | `initial` | `initial` | Recién registrada, configurando |

---

## 5.7 Prompt Claude para crear el módulo ONT completo

El prompt completo para regenerar este módulo desde cero está en el archivo en `D:/fosmikro/docs/curso/fase5-gestion-ont-onu.md`, sección 5.7. Incluye:

- 6 migraciones SQL detalladas con todas las tablas y RLS
- Helper SSH (`olt-ssh.ts`) con timeout 30s y retardo entre comandos
- Parser Huawei (`huawei-parser.ts`) con 4 funciones: parseOntList, parseOntSignal, parseLineProfiles, parseTrafficTable
- 10 rutas Hono completas: test-connection, list onts, provision, delete, signal, ping, speed profiles, line profiles, ip pools
- 5 vistas Vue 3 con especificación de todos los componentes y comportamiento
- Store Pinia con las funciones provisionOnt y deleteOnt
- Configuración de Vue Router
- Consideraciones de seguridad (Supabase Vault, RLS, logging de comandos SSH)

---

**Archivo generado:** `D:/fosmikro/docs/curso/fase5-gestion-ont-onu.md`

El documento esta basado en el codigo real del proyecto: tablas SQL de las migraciones `010`, `012`, `013`, `032`, `034`, tipos TypeScript de `OnuListView.vue`, `LineProfileView.vue` y `SpeedProfileView.vue`, y el esquema de provisioning que usa el backend Hono con ssh2.
