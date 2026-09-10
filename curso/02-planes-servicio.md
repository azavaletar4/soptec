Now I have all the real data from the codebase. Let me generate the document.

---

# FASE 2 — Planes de Servicio

## 2.1 ¿Qué son los planes de servicio?

En el contexto de un ISP, un **plan de servicio** es el producto comercial que se le vende al cliente: define cuánta velocidad recibirá, a qué precio mensual, mediante qué tecnología de conexión y con qué perfil de calidad de servicio (QoS) se aplica en el equipo de red.

Un plan es el "molde" que se replica en cada contrato. Cuando un cliente se activa, el sistema toma el plan asignado para:

- Configurar la velocidad en el **router MikroTik** (perfil PPPoE/simple queue)
- Configurar la velocidad en la **OLT Huawei MA5800** (lineprofile / speed plan)
- Calcular la **mensualidad** del contrato y la factura

### Campos principales de un plan

| Campo | Tipo | Descripción |
|---|---|---|
| `name` | VARCHAR(100) | Nombre comercial, ej. "Fibra 30 Mbps" |
| `description` | TEXT | Descripción opcional para el cliente |
| `download_speed` | SMALLINT | Velocidad de descarga en Mbps |
| `upload_speed` | SMALLINT | Velocidad de subida en Mbps |
| `price` | NUMERIC(10,2) | Precio mensual en USD |
| `technology` | ENUM | `fiber`, `radio`, `cable`, `dsl` |
| `burst_download` | INT | Velocidad pico descarga (opcional) |
| `burst_upload` | INT | Velocidad pico subida (opcional) |
| `mikrotik_profile` | VARCHAR(100) | Nombre exacto del profile PPPoE en RouterOS |
| `is_active` | BOOLEAN | Disponible para asignar a nuevos contratos |
| `deleted_at` | TIMESTAMPTZ | Soft delete (NULL = no eliminado) |

El campo `mikrotik_profile` es el nombre exacto configurado en el router (ej. `fibra-30mbps`). El sistema lee los perfiles directamente desde la API del MikroTik al abrir el modal, evitando errores de tipeo.

La tabla también existe una segunda tabla relacionada, `olt_speed_plans`, para los perfiles de velocidad propios de la OLT Huawei MA5800 (migración 019). Esto se detalla en la sección 2.5.

---

## 2.2 Tabla en Supabase

### Tabla `plans`

Definida en `supabase/migrations/001_schema_inicial.sql`:

```sql
CREATE TYPE connection_technology AS ENUM ('fiber', 'radio', 'cable', 'dsl');

CREATE TABLE plans (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            VARCHAR(100) NOT NULL,
  description     TEXT,
  download_speed  SMALLINT NOT NULL,
  upload_speed    SMALLINT NOT NULL,
  price           NUMERIC(10, 2) NOT NULL,
  technology      connection_technology DEFAULT 'fiber',
  burst_download  INT,
  burst_upload    INT,
  mikrotik_profile VARCHAR(100),
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
```

El `tenant_id` en fosmikro se gestiona mediante el JWT de Supabase Auth (campo `app_metadata.tenant_id`) y las políticas RLS, no como columna explícita en `plans` (la tabla es compartida por usuarios del mismo tenant mediante el contexto de autenticación).

### Tabla relacionada: `olt_speed_plans`

Definida en `supabase/migrations/019_speed_plans.sql`. Almacena los índices de traffic-table y lineprofile de la MA5800:

```sql
CREATE TABLE IF NOT EXISTS olt_speed_plans (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  download_kbps    INTEGER NOT NULL CHECK (download_kbps > 0),
  upload_kbps      INTEGER NOT NULL CHECK (upload_kbps > 0),
  traffic_inbound  INTEGER,   -- índice traffic-table subida (desde ONT)
  traffic_outbound INTEGER,   -- índice traffic-table bajada (hacia ONT)
  lineprofile_id   INTEGER,
  type             TEXT NOT NULL DEFAULT 'internet'
                   CHECK (type IN ('internet','iptv')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Los contratos de servicio se vinculan a `olt_speed_plans` mediante la columna `speed_plan_id` (agregada en la migración 019).

### Políticas RLS (Row Level Security)

La migración `004_fix_plans_rls.sql` corrige un problema real del proyecto: la tabla tenía RLS habilitado pero solo una política `SELECT`, lo que bloqueaba silenciosamente los `INSERT`, `UPDATE` y `DELETE`:

```sql
-- Lectura: planes no eliminados
CREATE POLICY "Auth lee planes activos (app)"
  ON plans FOR SELECT TO authenticated
  USING (deleted_at IS NULL);

-- Escritura para usuarios autenticados
CREATE POLICY "Auth inserta planes"
  ON plans FOR INSERT TO authenticated WITH CHECK (TRUE);

CREATE POLICY "Auth actualiza planes"
  ON plans FOR UPDATE TO authenticated
  USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY "Auth elimina planes"
  ON plans FOR DELETE TO authenticated USING (TRUE);
```

**Leccion aprendida:** Cuando una operacion Supabase no lanza error pero tampoco devuelve filas (`data` es array vacio), casi siempre es un problema de RLS. Siempre verificar que existan politicas para INSERT, UPDATE y DELETE ademas de SELECT.

---

## 2.3 Vista en fosmikro (web)

Archivo: `src/views/plans/PlansView.vue`

La vista implementa un CRUD completo en una sola pantalla con tabla + modal.

### Funcionalidades implementadas

**Listado:**
- Tabla con columnas: Nombre, Tecnologia, Velocidad (con burst si aplica), Precio, Perfil MikroTik, Estado
- Ordenado por precio ascendente
- Muestra burst como detalle secundario: `Burst: 50↓ / 10↑`

**Crear / Editar (modal):**
- Campos: nombre, descripcion, tecnologia, precio, descarga, subida, burst, perfil MikroTik, estado activo
- El selector de perfil MikroTik se carga dinamicamente desde la API del router (`mikrotik.listProfiles(deviceId)`)
- Si hay mas de un router MikroTik activo, aparece primero un selector de dispositivo
- Cache de sesion (`Map<deviceId, string[]>`) evita repetir la consulta al MikroTik
- Fallback a input de texto si no hay routers configurados
- Validacion: nombre obligatorio, precio no negativo

**Activar / Desactivar (soft toggle):**
- Boton en la columna Estado: alterna `is_active` sin eliminar el plan
- Solo visible para usuarios con permiso `canEdit`

**Eliminar:**
- Elimina permanentemente (hard delete) tras confirmacion
- Solo visible para usuarios con permiso `canDelete`
- Nota: el campo `deleted_at` existe en el schema para soft delete futuro

**Permisos por rol:**
```
canCreate  → muestra boton "Nuevo plan"
canEdit    → muestra icono lapiz + boton estado
canDelete  → muestra icono papelera
```

**Catalogo Pinia:**
El store `useCatalogsStore` (archivo `src/stores/catalogs.ts`) mantiene los planes en memoria para toda la app. Tras crear o editar, se llama `catalogs.resetPlans()` para invalidar el cache y forzar recarga en la proxima consulta.

```typescript
// src/stores/catalogs.ts - fragmento clave
async function fetchPlans() {
  if (plans.value.length) return   // cache en memoria
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('is_active', true)
    .order('price')
  plans.value = data ?? []
}

function resetPlans() {
  plans.value = []   // invalida cache
}
```

---

## 2.4 Vista en fsMk (app movil)

En la app movil Android (`D:/fsmk`), los planes se usan **solo en modo lectura** para mostrar informacion en dos contextos:

### 1. Vista de instalaciones pendientes (`InstalacionesView.vue`)

Al listar instalaciones, se hace un join de Supabase que trae el plan embebido en el contrato:

```typescript
// Query con join embebido
const { data } = await supabase
  .from('service_contracts')
  .select(`
    id, contract_number, installation_date, monthly_fee,
    clients ( id, first_name, last_name, mobile, phone ),
    plans ( name, download_speed, upload_speed ),
    installation_addresses ( address, reference, sector, latitude, longitude )
  `)
  .eq('status', 'pending')
```

El nombre del plan se muestra como chip de color en la tarjeta de instalacion:

```html
<span class="text-blue-400 text-xs font-medium">
  {{ inst.plans?.name }}
</span>
```

### 2. Detalle de instalacion (panel expandido)

```html
<div v-if="clientTarget.plans">
  <p class="text-xs text-slate-500">Plan</p>
  <p class="text-white">
    {{ clientTarget.plans.name }}
    <span class="text-slate-400 text-xs">
      · ↓{{ clientTarget.plans.download_speed }}/↑{{ clientTarget.plans.upload_speed }} Mbps
    </span>
  </p>
</div>
```

La app movil no tiene pantalla de administracion de planes. El alta, edicion y baja de planes se hace exclusivamente desde la web.

---

## 2.5 Diagrama de relaciones

```
┌─────────────────────────────────────────────────────────┐
│                       plans                              │
│  id · name · download_speed · upload_speed · price      │
│  technology · mikrotik_profile · is_active              │
└───────────────────────┬─────────────────────────────────┘
                        │  plan_id (FK)
                        │
          ┌─────────────▼──────────────────────────────────┐
          │            service_contracts                    │
          │  id · contract_number · client_id · plan_id     │
          │  speed_plan_id · monthly_fee · status           │
          │  ont_serial · pppoe_username · ip_address       │
          └──────┬───────────────────┬──────────────────────┘
                 │                   │
    client_id   │                   │  speed_plan_id
    (FK)        │                   │  (FK, migración 019)
                 │                   │
    ┌────────────▼──┐    ┌───────────▼───────────────────┐
    │    clients    │    │       olt_speed_plans          │
    │  id · name    │    │  id · name · download_kbps    │
    │  document_*   │    │  upload_kbps · lineprofile_id │
    │  status       │    │  traffic_inbound/outbound     │
    └───────────────┘    └───────────────────────────────┘

                               ▲
                               │ (uso en OLT)
                    ┌──────────┴───────────────┐
                    │   Huawei MA5800 OLT       │
                    │   lineprofile + traffic   │
                    │   table (por TELNET/SSH)  │
                    └──────────────────────────┘

    plans.mikrotik_profile ──────────────────────────────▶
                    ┌──────────────────────────────────┐
                    │   MikroTik RouterOS              │
                    │   /ppp profile  (PPPoE)          │
                    │   simple-queue / queue-tree      │
                    └──────────────────────────────────┘
```

**Flujo de datos al activar un cliente:**

```
1. Operador selecciona plan en contrato
        ↓
2. service_contracts.plan_id = plans.id
   service_contracts.speed_plan_id = olt_speed_plans.id
        ↓
3. Sistema aplica en MikroTik:
   plans.mikrotik_profile → /ppp profile set rate-limit
        ↓
4. Sistema aplica en OLT MA5800:
   olt_speed_plans.lineprofile_id → ont lineprofile
   olt_speed_plans.traffic_inbound/outbound → traffic-table
```

---

## 2.6 Prompt Claude para crear el modulo

El siguiente prompt esta calibrado para que un alumno pueda pedirle a Claude que genere el modulo de planes desde cero, con el mismo nivel de detalle que tiene fosmikro.

---

```
Crea el módulo completo de Planes de Servicio para un ISP Manager
con Vue 3 + TypeScript + Supabase. El módulo debe incluir:

STACK:
- Vue 3 con <script setup lang="ts">
- Supabase JS v2 (@supabase/supabase-js)
- Tailwind CSS para estilos
- Heroicons para iconos (@heroicons/vue)
- vue-sonner para notificaciones toast
- Pinia para el store

BASE DE DATOS (ya creada en Supabase):
CREATE TYPE connection_technology AS ENUM ('fiber', 'radio', 'cable', 'dsl');
CREATE TABLE plans (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            VARCHAR(100) NOT NULL,
  description     TEXT,
  download_speed  SMALLINT NOT NULL,
  upload_speed    SMALLINT NOT NULL,
  price           NUMERIC(10, 2) NOT NULL,
  technology      connection_technology DEFAULT 'fiber',
  burst_download  INT,
  burst_upload    INT,
  mikrotik_profile VARCHAR(100),
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
RLS habilitado con políticas SELECT/INSERT/UPDATE/DELETE
para usuarios autenticados.

ARCHIVOS A GENERAR:

1. src/views/plans/PlansView.vue
   - Tabla que lista todos los planes ordenados por precio
   - Columnas: Nombre, Tecnología, Velocidad (↓X/↑Y Mbps), Precio ($), 
     Perfil MikroTik, Estado (badge Activo/Inactivo)
   - Botón "Nuevo plan" en el encabezado
   - Botones editar (PencilIcon) y eliminar (TrashIcon) por fila
   - Click en badge Estado → alterna is_active sin recargar toda la tabla
   - Modal Teleport para crear/editar con los campos del schema
   - Validación: nombre requerido, precio no negativo
   - Soft toggle: UPDATE is_active = !is_active
   - Hard delete con confirm() antes de eliminar
   - Campos burst (opcional): burst_download, burst_upload en Mbps
   - Campo mikrotik_profile como input de texto libre
   - Loading state mientras carga y mientras guarda

2. src/stores/plansStore.ts (Pinia)
   - State: plans[], loading, error
   - Action fetchPlans(): carga solo planes activos (is_active=true, 
     deleted_at IS NULL), orden por precio
   - Action resetPlans(): vacía el array para forzar recarga
   - Cache en memoria: si plans.length > 0, no vuelve a consultar Supabase

3. src/types/plans.ts
   - Interface Plan con todos los campos del schema
   - Type ConnectionType = 'fiber' | 'radio' | 'cable' | 'dsl'

COMPORTAMIENTO ESPERADO:
- Al crear/editar → cerrar modal → llamar resetPlans() → recargar tabla
- Toast de éxito en crear/editar/eliminar
- Toast de error con el mensaje de Supabase si falla
- El campo technology muestra etiquetas en español:
  fiber→"Fibra óptica", radio→"Radio", cable→"Cable", dsl→"DSL"
- Precio se muestra con toFixed(2)
- Si no hay planes, mostrar mensaje: "No hay planes. Crea el primero."

Genera los 3 archivos completos y listos para usar.
```

---

## 2.7 Codigo ejemplo: queries Supabase para planes

### Listar todos los planes del tenant (pantalla de administracion)

```typescript
// Todos los planes no eliminados, ordenados por precio
const { data: planes, error } = await supabase
  .from('plans')
  .select('*')
  .is('deleted_at', null)
  .order('price', { ascending: true })

if (error) throw error
// planes: Plan[]
```

### Listar solo planes activos (para selector en contratos)

```typescript
// Solo los disponibles para asignar a nuevos contratos
const { data: planes, error } = await supabase
  .from('plans')
  .select('id, name, download_speed, upload_speed, price, technology, mikrotik_profile')
  .eq('is_active', true)
  .is('deleted_at', null)
  .order('price', { ascending: true })
```

### Crear un nuevo plan

```typescript
const { data, error } = await supabase
  .from('plans')
  .insert({
    name: 'Fibra 30 Mbps',
    download_speed: 30,
    upload_speed: 10,
    price: 25.00,
    technology: 'fiber',
    mikrotik_profile: 'fibra-30mbps',
    is_active: true,
  })
  .select()   // devuelve la fila insertada

// IMPORTANTE: si data es [] sin error, revisar RLS (INSERT policy)
if (!data || data.length === 0) {
  throw new Error('Sin filas insertadas — verificar políticas RLS de plans')
}
```

### Actualizar un plan existente

```typescript
const { data, error } = await supabase
  .from('plans')
  .update({
    price: 28.00,
    mikrotik_profile: 'fibra-30mbps-v2',
    updated_at: new Date().toISOString(),
  })
  .eq('id', planId)
  .select()

if (!data || data.length === 0) {
  throw new Error('Sin filas actualizadas — verificar políticas RLS de plans')
}
```

### Soft toggle de estado activo/inactivo

```typescript
// Alterna is_active sin eliminar el plan
const { error } = await supabase
  .from('plans')
  .update({ is_active: !plan.is_active })
  .eq('id', plan.id)

// Actualizar en memoria sin recargar tabla completa
if (!error) plan.is_active = !plan.is_active
```

### Eliminar un plan

```typescript
// Hard delete (elimina la fila permanentemente)
const { error } = await supabase
  .from('plans')
  .delete()
  .eq('id', planId)

// Alternativa: soft delete (conserva historial)
const { error } = await supabase
  .from('plans')
  .update({ deleted_at: new Date().toISOString(), is_active: false })
  .eq('id', planId)
```

### Join: contratos con plan embebido (usado en app movil)

```typescript
// Trae el nombre y velocidades del plan junto con cada contrato
const { data } = await supabase
  .from('service_contracts')
  .select(`
    id,
    contract_number,
    monthly_fee,
    status,
    plans ( name, download_speed, upload_speed, price )
  `)
  .eq('status', 'active')
  .is('deleted_at', null)

// Acceso: data[0].plans.name, data[0].plans.download_speed
```

### Query para estadisticas de planes (cuantos clientes por plan)

```typescript
// Contar contratos activos agrupados por plan
const { data } = await supabase
  .from('service_contracts')
  .select(`
    plan_id,
    plans ( name, price ),
    count
  `)
  .eq('status', 'active')
  .is('deleted_at', null)
  // Nota: para GROUP BY usar una funcion RPC o vista en Supabase
```

---

**Archivos fuente de referencia para esta fase:**

- `D:/fosmikro/supabase/migrations/001_schema_inicial.sql` — definicion de `plans` y `service_contracts`
- `D:/fosmikro/supabase/migrations/004_fix_plans_rls.sql` — politicas RLS corregidas
- `D:/fosmikro/supabase/migrations/019_speed_plans.sql` — tabla `olt_speed_plans` para OLT MA5800
- `D:/fosmikro/src/views/plans/PlansView.vue` — CRUD completo con modal y carga de perfiles MikroTik
- `D:/fosmikro/src/stores/catalogs.ts` — cache Pinia de planes activos
- `D:/fsmk/src/views/instalaciones/InstalacionesView.vue` — uso de planes (solo lectura) en app movil
