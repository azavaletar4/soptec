# FASE 8 (Opcional) — Gestión de Clientes

## Introducción

La gestión de clientes es el núcleo comercial de cualquier ISP. En Fosmikro, este módulo centraliza el ciclo de vida completo de un cliente: desde el registro inicial como prospecto, pasando por la instalación y activación del servicio, hasta la facturación y soporte técnico. Todo vinculado al modelo multi-tenant con RLS en Supabase.

Esta fase es marcada como **opcional** porque el sistema funciona operativamente sin ella (puedes gestionar ONUs y redes), pero es indispensable para la administración comercial real de un ISP.

---

## 8.0 Modelo de Datos

### Tabla `clients`

Cada cliente pertenece a un tenant y opcionalmente a una zona geográfica.

```sql
-- supabase/migrations/001_schema_inicial.sql (extracto relevante)

CREATE TABLE clients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  zone_id         UUID REFERENCES zones(id),

  -- Identificación
  document_type   TEXT NOT NULL DEFAULT 'cedula'
                  CHECK (document_type IN ('cedula', 'ruc', 'pasaporte')),
  document_number TEXT NOT NULL,

  -- Datos personales
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  phone           TEXT,
  email           TEXT,
  birthdate       DATE,

  -- Estado comercial
  status          TEXT NOT NULL DEFAULT 'prospect'
                  CHECK (status IN ('prospect', 'active', 'suspended', 'retired')),

  -- Auditoría
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (tenant_id, document_number)
);

-- RLS
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON clients
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID);
```

### Tabla `installation_addresses`

Cada instalación tiene una dirección georreferenciada independiente del cliente, porque un cliente puede tener múltiples puntos de servicio.

```sql
CREATE TABLE installation_addresses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  street      TEXT,
  number      TEXT,
  reference   TEXT,
  city        TEXT,
  province    TEXT,

  -- Coordenadas GPS (Leaflet)
  latitude    DOUBLE PRECISION,
  longitude   DOUBLE PRECISION,

  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE installation_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON installation_addresses
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID);
```

### Tabla `service_contracts`

El contrato vincula al cliente con su plan de servicio, su ONU y opcionalmente su equipo MikroTik (para clientes con gestión de ancho de banda por Simple Queue o PCQ).

```sql
CREATE TABLE service_contracts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- Plan comercial
  plan_id         UUID REFERENCES service_plans(id),
  monthly_fee     NUMERIC(10,2) NOT NULL DEFAULT 0,
  download_mbps   INT,
  upload_mbps     INT,

  -- Equipos vinculados
  onu_id          UUID REFERENCES onus(id),
  mikrotik_id     UUID REFERENCES mikrotik_devices(id),
  address_id      UUID REFERENCES installation_addresses(id),

  -- Estado del contrato
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'suspended', 'cancelled')),
  start_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date        DATE,

  -- Facturación
  billing_day     INT DEFAULT 1 CHECK (billing_day BETWEEN 1 AND 28),
  payment_method  TEXT DEFAULT 'cash',

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE service_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON service_contracts
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID);
```

### Relaciones del módulo

```
tenants
  └── clients (many)
        ├── installation_addresses (many)
        └── service_contracts (many)
              ├── service_plans (ref)
              ├── onus (ref)
              └── mikrotik_devices (ref)
```

---

## 8.1 Lista de Clientes

**Vista:** `src/views/clientes/ClientesView.vue`

La vista principal muestra el padrón completo de clientes con búsqueda en tiempo real, filtros combinables y paginación del lado del servidor para soportar miles de registros sin degradar el rendimiento.

### Comportamiento esperado

- **Búsqueda** por nombre completo, número de cédula/RUC o teléfono (campo único, búsqueda combinada con `ilike` en Supabase)
- **Filtro de estado:** prospect, activo, suspendido, retirado (puede seleccionarse más de uno)
- **Filtro de zona:** desplegable con las zonas configuradas por el tenant
- **Paginación:** 25 registros por página, navegación con botones anterior/siguiente y selector de página
- **Columnas visibles:** Nombre completo, cédula, teléfono, zona, estado (badge de color), fecha de registro, acción (ver perfil)
- **Exportar CSV:** botón que descarga la lista actual (con filtros aplicados) como archivo CSV

### Colores de estado en los badges

| Estado | Color Tailwind |
|---|---|
| prospect | `bg-yellow-100 text-yellow-800` |
| active | `bg-green-100 text-green-800` |
| suspended | `bg-red-100 text-red-800` |
| retired | `bg-gray-100 text-gray-700` |

### Ruta en el backend

```
GET /api/clients
  ?search=juan
  &status=active,suspended
  &zone_id=<uuid>
  &page=1
  &limit=25
```

El backend aplica los filtros sobre la vista de Supabase y devuelve `{ data, count }` para que el frontend calcule el total de páginas.

---

## 8.2 Registro de Cliente

**Vista:** `src/views/clientes/ClientRegistroView.vue`

El formulario se divide en tres pasos para reducir la carga cognitiva del operador y permitir guardar progreso en cada etapa sin perder datos si se interrumpe el flujo.

### Paso 1 — Datos Personales

Campos requeridos:
- Tipo de documento (cédula / RUC / pasaporte)
- Número de documento — con validación de cédula ecuatoriana (algoritmo módulo 10)
- Nombres y apellidos
- Teléfono (formato Ecuador: 09XXXXXXXX o 0X-XXXXXXX)
- Correo electrónico (opcional)
- Fecha de nacimiento (opcional, útil para verificación)
- Zona geográfica (desplegable)

**Validación de cédula ecuatoriana** implementada en el frontend antes de enviar al servidor:

```typescript
// src/utils/validarCedula.ts
export function validarCedula(cedula: string): boolean {
  if (!/^\d{10}$/.test(cedula)) return false
  const provincia = parseInt(cedula.substring(0, 2))
  if (provincia < 1 || provincia > 24) return false

  const digitos = cedula.split('').map(Number)
  const verificador = digitos[9]
  let suma = 0

  for (let i = 0; i < 9; i++) {
    let val = digitos[i] * (i % 2 === 0 ? 2 : 1)
    if (val >= 10) val -= 9
    suma += val
  }

  const residuo = suma % 10
  return residuo === 0 ? verificador === 0 : verificador === 10 - residuo
}
```

### Paso 2 — Dirección de Instalación

Campos:
- Calle principal y número
- Referencia (descripción libre: "casa azul junto a la escuela")
- Ciudad y provincia
- Mapa interactivo Leaflet para marcar la ubicación GPS exacta

El mapa inicia centrado en las coordenadas del tenant (configuradas en la tabla `tenants`). El técnico hace clic en el mapa o arrastra el marcador para ajustar la posición. Las coordenadas `latitude` y `longitude` se guardan en `installation_addresses`.

### Paso 3 — Contrato de Servicio

Campos:
- Plan de servicio (desplegable con los planes del tenant: nombre, velocidad, precio)
- Fecha de inicio del contrato
- Día de corte/facturación (1 al 28)
- Método de pago habitual
- ONU asignada (opcional en el registro; puede vincularse después desde el perfil)
- MikroTik asignado (opcional)

Al confirmar el paso 3, el sistema crea en una transacción:
1. Registro en `clients`
2. Registro en `installation_addresses`
3. Registro en `service_contracts`

Si alguna de las tres inserciones falla, se hace rollback completo.

---

## 8.3 Perfil de Cliente

**Vista:** `src/views/clientes/ClientShow.vue`

Accesible desde la lista o desde la URL `/clientes/:id`. Organizado en tabs para separar la información operativa de la histórica.

### Tab 1 — Datos Personales

Muestra todos los campos del cliente con botón "Editar" que abre un formulario inline (sin cambiar de vista). Incluye botón "Cambiar estado" con confirmación para transiciones válidas:

```
prospect  →  active
active    →  suspended  →  active
active    →  retired
suspended →  retired
```

### Tab 2 — Contratos

Lista los contratos del cliente (normalmente uno activo, pero puede tener históricos cancelados). Cada contrato muestra:
- Plan y velocidad contratada
- ONU vinculada (con badge online/offline en tiempo real via Supabase Realtime)
- Estado del contrato
- Fecha de inicio y corte mensual
- Botón "Gestionar ONU" que navega a la vista de la ONU
- Botón "Suspender / Reactivar" que llama al endpoint del backend que bloquea/desbloquea la ONU en la OLT Huawei via SSH

### Tab 3 — Documentos

Adjuntos del cliente almacenados en Supabase Storage bajo el bucket `client-documents` con path `{tenant_id}/{client_id}/`:
- Cédula (anverso / reverso)
- Contrato firmado (PDF)
- Fotos de instalación

Subida directa desde el navegador con drag-and-drop. El backend valida el `tenant_id` antes de generar la URL firmada de subida.

### Tab 4 — Historial de Pagos

Lista paginada de pagos registrados contra los contratos del cliente. Columnas: fecha, monto, método, referencia, estado (pagado / pendiente / anulado), quien registró el pago.

### Tab 5 — Tickets de Soporte

Lista de tickets abiertos y cerrados asociados al cliente. Botón "Nuevo ticket" que crea un ticket pre-rellenado con los datos del cliente y su contrato activo.

---

## 8.4 Contratos de Servicio

**Vista:** `src/views/contratos/ContratosKanbanView.vue`

La vista Kanban organiza los contratos activos por estado en columnas, permitiendo gestión visual del pipeline de clientes similar a la vista de instalaciones.

### Columnas del Kanban

| Columna | Estado | Color |
|---|---|---|
| Prospectos | prospect | Amarillo |
| Activos | active | Verde |
| Suspendidos | suspended | Rojo |
| Cancelados (mes actual) | cancelled | Gris |

### Tarjetas del Kanban

Cada tarjeta muestra:
- Nombre del cliente
- Plan contratado y velocidad
- ONU (badge online/offline)
- Días en el estado actual
- Acción rápida: ver perfil, suspender, reactivar

### Drag and drop

Al arrastrar una tarjeta entre columnas se activa una confirmación modal antes de aplicar el cambio de estado. Las transiciones inválidas (por ejemplo: cancelado → activo) se bloquean con un mensaje explicativo.

### Endpoint de suspensión / reactivación

```
POST /api/contracts/:id/suspend
POST /api/contracts/:id/reactivate
```

Internamente el backend:
1. Actualiza `service_contracts.status` en Supabase
2. Si hay ONU vinculada, ejecuta el comando SSH en la OLT para bloquear/desbloquear el puerto GPON
3. Si hay MikroTik vinculado, aplica o elimina la Simple Queue de bloqueo
4. Registra el evento en la tabla `audit_log`

---

## 8.5 fsMk — App Móvil (Técnicos)

La app móvil expone una versión simplificada del módulo de clientes orientada al trabajo de campo del técnico. No incluye funciones administrativas como cambio de planes o gestión de pagos.

### Pantalla: Lista de Clientes

- Búsqueda por nombre o cédula con debounce de 300ms
- Resultado muestra: nombre, teléfono, dirección referencial, estado
- Tocar un cliente abre su ficha simplificada

### Pantalla: Ficha de Cliente (modo técnico)

Información visible:
- Nombre completo y teléfono (tappable para llamar)
- Dirección con botón "Abrir en Google Maps" (coordenadas GPS de `installation_addresses`)
- ONU vinculada: número de serie, estado online/offline, señal óptica (dBm)
- Contrato: plan, velocidad, estado
- Últimas 5 incidencias registradas

### Acción disponible en campo

- Registrar una visita técnica (abre el formulario de instalación/soporte pre-rellenado con los datos del cliente)
- Tomar foto y adjuntarla directamente al cliente desde la cámara del móvil (Capacitor Camera API → Supabase Storage)

### Archivo en fsMk

```
D:/fsmk/src/views/clientes/ClientesMovilView.vue
D:/fsmk/src/views/clientes/ClienteFichaView.vue
```

---

## 8.6 Prompt Claude — Crear el Módulo de Clientes Completo

Usa este prompt completo en Claude Code para generar el módulo de clientes desde cero en el proyecto Fosmikro. Ejecutar desde la raíz de `D:/fosmikro`.

```
Eres un desarrollador senior Vue 3 + TypeScript + Hono + Supabase.

Proyecto: Fosmikro ISP Manager
- Backend: server/src/index.ts (Hono), rutas en server/src/routes/
- Frontend: src/views/, src/stores/, src/components/
- BD: Supabase PostgreSQL con RLS, tenant_id en app_metadata del JWT
- Multi-tenant: cada query incluye .eq('tenant_id', tenantId) donde tenantId viene
  del store de auth (useAuthStore().tenantId)
- Estilos: Tailwind CSS 4 únicamente, sin librerías de componentes externas
- Estado global: Pinia
- Validación de formularios: con lógica propia (sin vee-validate ni zod)

Implementa el módulo completo de gestión de clientes con estos archivos:

BACKEND (server/src/routes/clients.ts):
- GET    /api/clients          → lista paginada con filtros (search, status, zone_id, page, limit)
- POST   /api/clients          → crear cliente + dirección + contrato en una transacción
- GET    /api/clients/:id      → perfil completo con contratos, dirección
- PATCH  /api/clients/:id      → actualizar datos del cliente
- PATCH  /api/clients/:id/status → cambiar estado con validación de transiciones
- GET    /api/clients/:id/contracts → lista de contratos del cliente
- POST   /api/contracts/:id/suspend    → suspender: actualizar BD + bloquear ONU en OLT
- POST   /api/contracts/:id/reactivate → reactivar: actualizar BD + desbloquear ONU en OLT

FRONTEND:

1. src/stores/clientesStore.ts (Pinia)
   - Estado: clients[], selectedClient, loading, error, filters, pagination
   - Actions: fetchClients, fetchClient, createClient, updateClient, changeStatus
   - Los filtros se persisten en la URL via useRoute/useRouter

2. src/views/clientes/ClientesView.vue
   - Tabla responsiva con las columnas definidas
   - Barra de búsqueda con debounce 400ms
   - Filtros de estado (checkboxes múltiples) y zona (select)
   - Paginación inferior con selector de página
   - Botón exportar CSV
   - Skeleton loader durante la carga
   - Empty state con ilustración cuando no hay resultados

3. src/views/clientes/ClientRegistroView.vue
   - Stepper de 3 pasos con barra de progreso visual
   - Paso 1: datos personales con validación de cédula ecuatoriana
   - Paso 2: dirección con mapa Leaflet (mismo patrón que InstallacionesView)
   - Paso 3: selección de plan, día de corte, ONU (opcional)
   - Botones Anterior / Siguiente / Guardar
   - Al guardar: POST /api/clients y redirigir al perfil creado

4. src/views/clientes/ClientShow.vue
   - Tabs: Datos | Contratos | Documentos | Pagos | Tickets
   - Edición inline en tab Datos
   - Tab Contratos: lista contratos con badge ONU online/offline (Supabase Realtime)
   - Tab Documentos: subida drag-and-drop a Supabase Storage
   - Tab Pagos: tabla paginada (GET /api/clients/:id/payments)
   - Tab Tickets: lista con botón nuevo ticket

5. src/views/contratos/ContratosKanbanView.vue
   - 4 columnas: Prospectos / Activos / Suspendidos / Cancelados
   - Tarjetas con datos clave del contrato
   - Drag and drop con confirmación modal antes de aplicar el cambio
   - Bloqueo de transiciones inválidas

6. src/router/index.ts — agregar rutas:
   { path: '/clientes',            component: ClientesView }
   { path: '/clientes/nuevo',      component: ClientRegistroView }
   { path: '/clientes/:id',        component: ClientShow }
   { path: '/contratos/kanban',    component: ContratosKanbanView }

7. src/components/clientes/ClienteCard.vue — tarjeta reutilizable para Kanban y móvil

MIGRACIÓN SQL:
Genera el archivo supabase/migrations/067_clientes_contratos.sql con:
- Tabla clients con RLS
- Tabla installation_addresses con RLS
- Tabla service_contracts con RLS
- Índices en tenant_id, document_number, status, zone_id
- Trigger updated_at en clients y service_contracts

RESTRICCIONES IMPORTANTES:
- No uses librerías de componentes externas (ni Vuetify, ni PrimeVue, ni Headless UI)
- Tailwind CSS 4 puro para todos los estilos
- El mapa Leaflet solo se importa dinámicamente (import() async) para no bloquear el bundle
- Todas las peticiones al backend incluyen el header Authorization con el JWT de Supabase
- El backend obtiene el tenant_id del JWT, nunca del body de la petición
- Manejo de errores con toast notifications usando el sistema ya existente en el proyecto
- Los colores de estado son consistentes con el resto del proyecto:
  active=green, suspended=red, prospect=yellow, retired=gray

Genera todos los archivos completos, listos para copiar, sin omitir ninguna sección.
```

---

## Checklist de Implementación

Usa esta lista para verificar que el módulo está completo antes de pasar a producción.

### Base de datos
- [ ] Migración `067_clientes_contratos.sql` aplicada en Supabase
- [ ] RLS habilitado en las tres tablas nuevas
- [ ] Índices creados (verificar con `\d clients` en psql)
- [ ] Trigger `updated_at` funcionando

### Backend
- [ ] Ruta `clients.ts` importada en `server/src/index.ts`
- [ ] Endpoint de lista devuelve paginación correcta
- [ ] Transacción de creación hace rollback ante error
- [ ] Suspensión/reactivación ejecuta comando SSH en OLT

### Frontend
- [ ] Store `clientesStore.ts` sincroniza filtros con URL
- [ ] Validación de cédula muestra error antes de enviar
- [ ] Mapa Leaflet carga de forma dinámica (no bloquea)
- [ ] Tabs del perfil no pierden datos al cambiar entre ellas
- [ ] Drag and drop del Kanban confirma antes de aplicar
- [ ] Subida de documentos funciona con Supabase Storage

### App móvil (fsMk)
- [ ] Búsqueda de clientes con debounce
- [ ] Botón "Llamar" lanza la app de teléfono del dispositivo
- [ ] Botón "Google Maps" abre la app de mapas con las coordenadas GPS
- [ ] Subida de fotos desde cámara via Capacitor Camera API

---

## Notas Técnicas

**Suspensión de ONU via SSH:**
El endpoint `POST /api/contracts/:id/suspend` reutiliza el módulo SSH ya implementado en las fases anteriores. El comando Huawei MA5800 para bloquear un puerto GPON es:

```
interface gpon 0/X
  port Y ont-deactivate Z
```

Donde X es el slot, Y es el puerto GPON y Z es el ID de la ONU. Estos valores se obtienen del registro de la ONU en la tabla `onus`.

**Sincronización de estado ONU en tiempo real:**
El badge online/offline en el tab de Contratos usa `supabase.channel()` para suscribirse a cambios en la tabla `onus` filtrada por `onu_id`. Esto evita polling y mantiene el estado actualizado sin recargar la página.

**Exportación CSV:**
La exportación no pasa por el backend para evitar timeouts en listas grandes. El frontend descarga todos los registros (hasta 5000) en una sola petición con `limit=5000` y convierte el array a CSV en memoria usando una función utilitaria antes de crear el Blob y disparar la descarga.
