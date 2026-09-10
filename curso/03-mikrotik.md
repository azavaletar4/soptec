# FASE 3 — MikroTik

## Índice

- [3.0 Arquitectura MikroTik en el sistema](#30-arquitectura-mikrotik-en-el-sistema)
- [3.1 Registro de MikroTiks](#31-registro-de-mikrotiks)
- [3.2 IP Address](#32-ip-address)
- [3.3 Firewalls](#33-firewalls)
- [3.4 Bloqueos](#34-bloqueos)
- [3.5 Pool IPv6](#35-pool-ipv6)
- [3.6 Diagrama de flujo](#36-diagrama-de-flujo)
- [3.7 Prompt Claude para crear el módulo MikroTik completo](#37-prompt-claude-para-crear-el-módulo-mikrotik-completo)

---

## 3.0 Arquitectura MikroTik en el sistema

### Concepto central

En Fosmikro, el frontend (Vue 3) **nunca se conecta directamente** a los routers MikroTik. Existe un proxy seguro en el backend (Hono) que actúa como intermediario. El navegador solo conoce el ID del dispositivo y el JWT del usuario autenticado; las credenciales reales del router (usuario/contraseña) permanecen exclusivamente en la base de datos del servidor.

### Tabla `mikrotik_devices`

```sql
CREATE TABLE mikrotik_devices (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  nombre      TEXT NOT NULL,
  host        TEXT NOT NULL,        -- IP o hostname del router
  port        INTEGER DEFAULT 8728, -- Puerto API MikroTik (no Winbox)
  username    TEXT NOT NULL,
  password    TEXT NOT NULL,        -- Solo accesible desde el backend
  lat         NUMERIC,              -- Coordenadas para el mapa
  lng         NUMERIC,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### Seguridad: migración 051

La migración `051` ejecuta una instrucción clave:

```sql
-- Revocar acceso a la columna password para el rol authenticated
REVOKE SELECT (password) ON mikrotik_devices FROM authenticated;
```

Esto significa que aunque un usuario autenticado pueda consultar la tabla vía Supabase JS client, **el campo `password` nunca llega al navegador**. El único que puede leer las credenciales es el backend con el rol `service_role`.

### Diagrama de capas de seguridad

```
+------------------+     JWT only     +------------------+     service_role     +------------------+
|   NAVEGADOR      |  ------------->  |  HONO BACKEND    |  ----------------->  |  SUPABASE DB     |
|  Vue 3 / JS      |   deviceId +     |  /api/mikrotik-  |   SELECT host,       |  mikrotik_devices|
|  Sin credenciales|   Bearer token   |  local/*         |   user, password     |  (password col)  |
+------------------+                  +------------------+                      +------------------+
                                             |
                                             | Credenciales reales
                                             v
                                    +------------------+
                                    |  MIKROTIK ROUTER |
                                    |  API port 8728   |
                                    +------------------+
```

### Flujo de autenticación

1. El usuario inicia sesión en Fosmikro -> obtiene JWT de Supabase Auth.
2. Desde el frontend se llama a `/api/mikrotik-local?deviceId=<uuid>` con el header `Authorization: Bearer <JWT>`.
3. El backend Hono verifica el JWT, extrae `tenant_id` del payload.
4. El backend consulta `mikrotik_devices` con `service_role` para obtener `host`, `port`, `username`, `password`.
5. El backend abre conexión con el router MikroTik en el puerto 8728.
6. La respuesta (IPs, reglas, etc.) se reenvía al navegador.

---

## 3.1 Registro de MikroTiks

### Vista: `src/views/mikrotik/MikrotikView.vue`

Esta vista lista los routers MikroTik registrados del tenant y permite agregar nuevos. El formulario captura:

| Campo | Tipo | Requerido | Default |
|---|---|---|---|
| Nombre | texto | si | — |
| Host / IP | texto | si | — |
| Puerto | numero | si | 8728 |
| Usuario | texto | si | admin |
| Contrasena | password | si | — |
| Latitud | numero | no | — |
| Longitud | numero | no | — |

### Formulario de registro (ejemplo Vue 3)

```typescript
// store o composable
const form = reactive({
  nombre: '',
  host: '',
  port: 8728,
  username: 'admin',
  password: '',
  lat: null as number | null,
  lng: null as number | null,
})

async function guardarDispositivo() {
  const { error } = await supabase
    .from('mikrotik_devices')
    .insert({
      ...form,
      tenant_id: userStore.tenantId,
    })
  if (error) throw error
}
```

### Prueba de conexion

Antes de guardar (o como boton independiente), el frontend llama al backend para verificar que el router responde:

```typescript
// Frontend: solo envia deviceId (o host temporal)
async function probarConexion(deviceId: string) {
  const res = await fetch(`/api/mikrotik-local/test?deviceId=${deviceId}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  const data = await res.json()
  return data.ok // true si el router respondio
}
```

```typescript
// Backend Hono: src/routes/mikrotik-local.ts
app.get('/test', async (c) => {
  const deviceId = c.req.query('deviceId')
  const device = await getDeviceCredentials(deviceId, c) // usa service_role
  try {
    const conn = await connectMikrotik(device)
    await conn.close()
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 400)
  }
})
```

---

## 3.2 IP Address

### Que muestra este modulo

Consulta en tiempo real las IPs asignadas (address-list) en el router MikroTik seleccionado. Equivale al comando de RouterOS:

```
/ip address print
```

### Campos en la tabla del frontend

| Campo | Descripcion |
|---|---|
| Direccion | IP con prefijo (ej. 192.168.1.1/24) |
| Red | Direccion de red calculada |
| Interfaz | eth1, ether2, pppoe-out1, etc. |
| Estado | dynamic / static |
| Activo | si / no (disabled) |

### Endpoint Hono

```
GET /api/mikrotik-local/ip-address?deviceId=<uuid>
```

```typescript
// server/src/routes/mikrotik-local.ts
app.get('/ip-address', async (c) => {
  const device = await resolveDevice(c)
  const conn = await connectMikrotik(device)

  const result = await conn.write('/ip/address/print')
  await conn.close()

  return c.json(result.map((r: any) => ({
    id:        r['.id'],
    address:   r['address'],
    network:   r['network'],
    interface: r['interface'],
    dynamic:   r['dynamic'] === 'true',
    disabled:  r['disabled'] === 'true',
  })))
})
```

### Componente Vue (snippet de tabla)

```vue
<template>
  <table class="w-full text-sm">
    <thead>
      <tr>
        <th>Direccion</th>
        <th>Interfaz</th>
        <th>Red</th>
        <th>Estado</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="ip in ips" :key="ip.id">
        <td>{{ ip.address }}</td>
        <td>{{ ip.interface }}</td>
        <td>{{ ip.network }}</td>
        <td>
          <span :class="ip.disabled ? 'text-red-500' : 'text-green-500'">
            {{ ip.disabled ? 'Inactivo' : 'Activo' }}
          </span>
        </td>
      </tr>
    </tbody>
  </table>
</template>
```

---

## 3.3 Firewalls

### Que muestra este modulo

Lee las reglas de firewall del chain `filter` del router. Equivale a:

```
/ip firewall filter print
```

### Endpoint Hono

```
GET /api/mikrotik-local/firewall?deviceId=<uuid>
```

```typescript
app.get('/firewall', async (c) => {
  const device = await resolveDevice(c)
  const conn = await connectMikrotik(device)

  const result = await conn.write('/ip/firewall/filter/print')
  await conn.close()

  return c.json(result.map((r: any) => ({
    id:         r['.id'],
    chain:      r['chain'],
    action:     r['action'],
    srcAddress: r['src-address'] ?? '',
    dstAddress: r['dst-address'] ?? '',
    protocol:   r['protocol'] ?? '',
    comment:    r['comment'] ?? '',
    disabled:   r['disabled'] === 'true',
  })))
})
```

### Tabla del frontend

| Columna | Ejemplo |
|---|---|
| # | 0, 1, 2 ... |
| Chain | input / forward / output |
| Action | accept / drop / reject |
| Src Address | 0.0.0.0/0, 10.0.0.0/8 |
| Dst Address | — |
| Protocolo | tcp, udp, icmp |
| Comentario | "Bloquear torrents" |
| Habilitada | si / no |

### Colores segun accion

```vue
<span
  :class="{
    'text-green-600': rule.action === 'accept',
    'text-red-600':   rule.action === 'drop',
    'text-yellow-600': rule.action === 'reject',
  }"
>
  {{ rule.action }}
</span>
```

---

## 3.4 Bloqueos

### Concepto

Este modulo permite bloquear o desbloquear un cliente por su IP publica (o IP de la red local del ISP) directamente desde el perfil del cliente en Fosmikro. Internamente agrega o elimina la IP de una **address-list** llamada `bloqueados` en el MikroTik.

La regla de firewall que hace el bloqueo efectivo debe existir previamente en el router:

```
/ip firewall filter add chain=forward src-address-list=bloqueados action=drop comment="Clientes bloqueados fosmikro"
```

### Endpoints Hono

**Bloquear cliente:**

```
POST /api/mikrotik-local/bloquear
Body: { deviceId, ip, clienteId, comentario }
```

**Desbloquear cliente:**

```
POST /api/mikrotik-local/desbloquear
Body: { deviceId, ip }
```

### Implementacion backend

```typescript
// Bloquear: agregar IP a address-list
app.post('/bloquear', async (c) => {
  const { deviceId, ip, comentario } = await c.req.json()
  const device = await resolveDevice(c, deviceId)
  const conn = await connectMikrotik(device)

  await conn.write('/ip/firewall/address-list/add', [
    '=list=bloqueados',
    `=address=${ip}`,
    `=comment=${comentario ?? 'Bloqueado desde fosmikro'}`,
  ])
  await conn.close()

  // Registrar en BD para trazabilidad
  await supabaseAdmin.from('bloqueos').insert({
    ip, comentario, tenant_id: c.get('tenantId'),
  })

  return c.json({ ok: true })
})

// Desbloquear: remover IP de address-list
app.post('/desbloquear', async (c) => {
  const { deviceId, ip } = await c.req.json()
  const device = await resolveDevice(c, deviceId)
  const conn = await connectMikrotik(device)

  // Buscar el ID del entry en la address-list
  const entries = await conn.write('/ip/firewall/address-list/print', [
    `?list=bloqueados`,
    `?address=${ip}`,
  ])

  for (const entry of entries) {
    await conn.write('/ip/firewall/address-list/remove', [
      `=.id=${entry['.id']}`,
    ])
  }
  await conn.close()

  return c.json({ ok: true })
})
```

### Boton en el perfil del cliente

```vue
<!-- src/components/cliente/AccionesCliente.vue -->
<button
  v-if="!cliente.bloqueado"
  @click="bloquear(cliente)"
  class="bg-red-600 text-white px-4 py-2 rounded"
>
  Bloquear
</button>

<button
  v-else
  @click="desbloquear(cliente)"
  class="bg-green-600 text-white px-4 py-2 rounded"
>
  Desbloquear
</button>
```

### Tabla de trazabilidad (opcional)

```sql
CREATE TABLE bloqueos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  ip          TEXT NOT NULL,
  comentario  TEXT,
  bloqueado_por UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT now(),
  desbloqueado_at TIMESTAMPTZ
);
```

---

## 3.5 Pool IPv6

### Que muestra este modulo

Consulta los pools de prefijos IPv6 configurados en el router. Equivale a:

```
/ipv6 pool print
```

### Vista: `src/views/mikrotik/MikrotikIpv6PoolView.vue`

```typescript
// Endpoint
GET /api/mikrotik-local/ipv6-pool?deviceId=<uuid>
```

```typescript
app.get('/ipv6-pool', async (c) => {
  const device = await resolveDevice(c)
  const conn = await connectMikrotik(device)

  const result = await conn.write('/ipv6/pool/print')
  await conn.close()

  return c.json(result.map((r: any) => ({
    id:       r['.id'],
    name:     r['name'],
    prefix:   r['prefix'],
    prefixLength: r['prefix-length'],
  })))
})
```

### Tabla del frontend

| Pool | Prefijo | Longitud del prefijo |
|---|---|---|
| pool-clientes | 2800:abcd:1::/48 | 64 |
| pool-infra | 2800:abcd:2::/48 | 64 |

### Por que IPv6 importa en ISPs

Los ISPs modernos reciben bloques IPv6 de su upstream (LACNIC/NIC Ecuador). Administrar esos pools desde Fosmikro permite:
- Ver cuantos prefijos /64 estan disponibles para clientes.
- Diagnosticar si un cliente tiene asignacion IPv6 activa.
- Planificar expansion de la red.

---

## 3.6 Diagrama de flujo

```
+-------------------+
|     NAVEGADOR     |
|  Vue 3 (Browser)  |
|                   |
|  - deviceId       |
|  - JWT Bearer     |
|  - SIN password   |
+--------+----------+
         |
         | HTTPS (puerto 443 o 3000)
         | GET /api/mikrotik-local/ip-address?deviceId=xxx
         | Authorization: Bearer eyJhbG...
         |
         v
+--------+----------+
|  HONO BACKEND     |
|  Node.js / tsx    |
|                   |
|  1. Verificar JWT |
|  2. Extraer       |
|     tenant_id     |
|  3. Consultar BD  |
|     (service_role)|
|     -> host       |
|     -> username   |
|     -> password   |
|  4. Conectar al   |
|     router        |
+--------+----------+
         |
         | TCP (puerto 8728) — Red interna / LAN del ISP
         | Protocolo: MikroTik API (RouterOS API)
         | Credenciales: admin / ****
         |
         v
+--------+----------+
|  MIKROTIK ROUTER  |
|  RouterOS         |
|                   |
|  /ip/address/print|
|  /ip/firewall/... |
|  /ipv6/pool/print |
|  address-list add |
+-------------------+
         |
         | Respuesta JSON (procesada por Hono)
         |
         v
+-------------------+
|     NAVEGADOR     |
|  Tabla de IPs,    |
|  reglas firewall, |
|  pools IPv6, etc. |
+-------------------+
```

### Puertos importantes

| Puerto | Protocolo | Uso |
|---|---|---|
| 8728 | TCP | MikroTik API (sin TLS) |
| 8729 | TCP | MikroTik API over SSL |
| 8291 | TCP | Winbox (NO se usa en fosmikro) |
| 22 | TCP | SSH MikroTik (modulo SSH separado) |

> **Nota de seguridad:** El puerto 8728 solo debe ser accesible desde la red interna del servidor fosmikro. Nunca exponer el API MikroTik a Internet directamente.

---

## 3.7 Prompt Claude para crear el módulo MikroTik completo

El siguiente prompt esta disenado para usarse en Claude Code cuando se necesite crear o extender el modulo MikroTik en un proyecto nuevo basado en el mismo stack (Vue 3 + Hono + Supabase):

---

```
Necesito crear el modulo MikroTik completo para una aplicacion ISP Manager.

STACK:
- Frontend: Vue 3 + TypeScript + Tailwind CSS 4 + Pinia
- Backend: Hono (Node.js) en server/src/routes/
- Base de datos: Supabase PostgreSQL con RLS
- Autenticacion: Supabase Auth (JWT con tenant_id en app_metadata)

ARQUITECTURA DE SEGURIDAD (obligatoria):
- El frontend NUNCA recibe las credenciales del router (usuario/password)
- El frontend solo envia: deviceId (UUID) + JWT de Supabase Auth
- El backend obtiene las credenciales con service_role key de Supabase
- La columna password de mikrotik_devices tiene REVOKE SELECT para el rol authenticated

TABLA DE BASE DE DATOS:
CREATE TABLE mikrotik_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  nombre TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER DEFAULT 8728,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  lat NUMERIC, lng NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now()
);
REVOKE SELECT (password) ON mikrotik_devices FROM authenticated;

MODULOS A CREAR:

1. REGISTRO DE DISPOSITIVOS
   - Vista: src/views/mikrotik/MikrotikView.vue
   - Formulario: nombre, host, port (default 8728), username, password, lat, lng
   - Boton "Probar conexion" que llama a /api/mikrotik-local/test
   - Tabla de dispositivos registrados (nombre, host, estado)

2. IP ADDRESS
   - Vista: src/views/mikrotik/MikrotikIpAddressView.vue
   - Endpoint: GET /api/mikrotik-local/ip-address?deviceId=xxx
   - Tabla: address, network, interface, dynamic, disabled
   - Selector de dispositivo MikroTik arriba

3. FIREWALL
   - Vista: src/views/mikrotik/MikrotikFirewallView.vue
   - Endpoint: GET /api/mikrotik-local/firewall?deviceId=xxx
   - Tabla: chain, action (con colores), src-address, dst-address, comment, disabled
   - Filtro por chain (input/forward/output)

4. BLOQUEOS
   - Endpoint POST: /api/mikrotik-local/bloquear
   - Endpoint POST: /api/mikrotik-local/desbloquear
   - Agrega/remueve IP de address-list "bloqueados"
   - Tabla bloqueos en BD para trazabilidad
   - Boton Bloquear/Desbloquear en perfil del cliente

5. POOL IPv6
   - Vista: src/views/mikrotik/MikrotikIpv6PoolView.vue
   - Endpoint: GET /api/mikrotik-local/ipv6-pool?deviceId=xxx
   - Tabla: name, prefix, prefix-length

HELPER REQUERIDO (server/src/lib/mikrotik.ts):
- Funcion connectMikrotik(device) que retorna conexion usando la libreria 'node-routeros' o similar
- Funcion resolveDevice(c) que: verifica JWT, obtiene tenant_id, consulta BD con service_role, retorna credenciales

RUTAS BACKEND (server/src/routes/mikrotik-local.ts):
- Hono app con middleware de autenticacion JWT
- Endpoints: GET /test, GET /ip-address, GET /firewall, GET /ipv6-pool
- POST /bloquear, POST /desbloquear
- Manejo de errores con status codes adecuados (401, 404, 500)

STORE FRONTEND (src/stores/mikrotik.ts):
- Estado: devices[], selectedDeviceId, loading, error
- Actions: fetchDevices(), fetchIpAddress(), fetchFirewall(), bloquear(ip), desbloquear(ip)

ROUTER (agregar a src/router/index.ts):
- /mikrotik -> MikrotikView (lista de dispositivos)
- /mikrotik/:id/ip-address -> MikrotikIpAddressView
- /mikrotik/:id/firewall -> MikrotikFirewallView
- /mikrotik/:id/ipv6-pool -> MikrotikIpv6PoolView

IMPORTANTE:
- Usar Tailwind CSS 4 (no clases deprecated de v3)
- Todos los componentes en <script setup lang="ts">
- Mensajes de error en espanol
- Confirmar antes de bloquear un cliente (dialog de confirmacion)
- Loading spinner mientras se conecta al router (puede tardar 2-3 segundos)
```

---

### Como usar este prompt

1. Abrir Claude Code en el directorio del proyecto (`D:/fosmikro` o el nuevo proyecto).
2. Pegar el prompt completo en el chat.
3. Claude creara todos los archivos en el orden correcto: primero el helper de conexion, luego las rutas Hono, luego las vistas Vue y el store.
4. Revisar el archivo `server/src/lib/mikrotik.ts` generado y confirmar que la libreria de conexion coincide con la instalada en el proyecto (`node-routeros`, `mikronode`, o similar).
5. Ejecutar la migracion SQL para aplicar el `REVOKE` en produccion.

---

*Documento generado para el Curso ISP Manager Fosmikro — Fase 3.*
*Stack: Vue 3 + TypeScript + Hono + Supabase | Fecha: 2026-08-20*
