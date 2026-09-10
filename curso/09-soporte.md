# FASE 9 (Opcional) — Soporte Técnico

## Índice

- [9.0 Sistema de tickets](#90-sistema-de-tickets)
- [9.1 Panel de soporte (staff)](#91-panel-de-soporte-staff)
- [9.2 Portal del cliente](#92-portal-del-cliente)
- [9.3 En fsMk (app móvil)](#93-en-fsmk-app-móvil)
- [9.4 Integración WhatsApp (opcional)](#94-integración-whatsapp-opcional)
- [9.5 Prompt Claude para crear el módulo de soporte completo](#95-prompt-claude-para-crear-el-módulo-de-soporte-completo)

---

## 9.0 Sistema de tickets

El módulo de soporte técnico permite registrar, gestionar y resolver incidencias de clientes. Es independiente del flujo operativo del ISP pero se integra con clientes, técnicos y el sistema de notificaciones existente.

### Tablas principales

**Migración:** `supabase/migrations/044_soporte.sql`

```sql
-- Tickets principales
CREATE TABLE support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  numero TEXT NOT NULL, -- Auto-generado: TKT-0001, TKT-0002...
  cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_nombre TEXT, -- Snapshot por si se elimina el cliente
  cliente_telefono TEXT,
  titulo TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'abierto'
    CHECK (estado IN ('abierto', 'en_progreso', 'resuelto', 'cerrado')),
  prioridad TEXT NOT NULL DEFAULT 'media'
    CHECK (prioridad IN ('baja', 'media', 'alta', 'critica')),
  tecnico_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  tecnico_nombre TEXT,
  canal_origen TEXT DEFAULT 'web'
    CHECK (canal_origen IN ('web', 'whatsapp', 'telefono', 'portal', 'app')),
  etiquetas TEXT[] DEFAULT '{}',
  tiempo_resolucion_min INTEGER, -- Calculado al cerrar
  sla_horas INTEGER DEFAULT 24,
  sla_vencimiento TIMESTAMPTZ,
  resolucion TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  resuelto_at TIMESTAMPTZ,
  cerrado_at TIMESTAMPTZ
);

-- Actualizaciones / respuestas del ticket
CREATE TABLE support_ticket_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  autor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  autor_nombre TEXT NOT NULL,
  autor_tipo TEXT NOT NULL CHECK (autor_tipo IN ('staff', 'cliente', 'sistema')),
  mensaje TEXT NOT NULL,
  es_nota_interna BOOLEAN DEFAULT false, -- Solo visible para staff
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Fotos adjuntas a tickets o actualizaciones
CREATE TABLE support_ticket_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  update_id UUID REFERENCES support_ticket_updates(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  url TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  nombre_archivo TEXT,
  subido_por TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Usuarios del portal de clientes (autenticación separada del staff)
CREATE TABLE client_portal_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  nombre TEXT NOT NULL,
  activo BOOLEAN DEFAULT true,
  ultimo_acceso TIMESTAMPTZ,
  token_reset TEXT,
  token_reset_exp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, email)
);

-- Índices
CREATE INDEX idx_tickets_tenant ON support_tickets(tenant_id);
CREATE INDEX idx_tickets_estado ON support_tickets(tenant_id, estado);
CREATE INDEX idx_tickets_cliente ON support_tickets(cliente_id);
CREATE INDEX idx_tickets_tecnico ON support_tickets(tecnico_id);
CREATE INDEX idx_ticket_updates_ticket ON support_ticket_updates(ticket_id);
CREATE INDEX idx_ticket_photos_ticket ON support_ticket_photos(ticket_id);

-- RLS
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_portal_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_tickets" ON support_tickets
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

CREATE POLICY "tenant_ticket_updates" ON support_ticket_updates
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

CREATE POLICY "tenant_ticket_photos" ON support_ticket_photos
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- Función para generar número de ticket
CREATE OR REPLACE FUNCTION generar_numero_ticket(p_tenant_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) + 1 INTO v_count
  FROM support_tickets WHERE tenant_id = p_tenant_id;
  RETURN 'TKT-' || LPAD(v_count::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- Trigger para calcular tiempo de resolución
CREATE OR REPLACE FUNCTION calcular_tiempo_resolucion()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estado = 'resuelto' AND OLD.estado != 'resuelto' THEN
    NEW.resuelto_at = now();
    NEW.tiempo_resolucion_min = EXTRACT(EPOCH FROM (now() - NEW.created_at)) / 60;
  END IF;
  IF NEW.estado = 'cerrado' AND OLD.estado != 'cerrado' THEN
    NEW.cerrado_at = now();
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ticket_resolucion
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION calcular_tiempo_resolucion();
```

### Estados del ciclo de vida

```
abierto --> en_progreso --> resuelto --> cerrado
    |                           |
    +---------------------------+  (el cliente puede reabrir un ticket resuelto)
```

| Estado | Color | Descripción |
|---|---|---|
| `abierto` | Azul | Recién creado, sin asignar |
| `en_progreso` | Amarillo | Asignado a un técnico |
| `resuelto` | Verde | Técnico marcó como resuelto |
| `cerrado` | Gris | Confirmado y archivado |

### Prioridades y SLA

| Prioridad | Color | SLA por defecto |
|---|---|---|
| `baja` | Verde | 72 horas |
| `media` | Azul | 24 horas |
| `alta` | Naranja | 8 horas |
| `critica` | Rojo | 2 horas |

---

## 9.1 Panel de soporte (staff)

### Vista principal: `src/views/soporte/SoporteView.vue`

La vista principal muestra todos los tickets del tenant con capacidad de filtrado y acciones rápidas.

**Estructura del componente:**

```
SoporteView.vue
├── Barra de métricas (abiertos / en_progreso / vencidos SLA / resueltos hoy)
├── Barra de filtros
│   ├── Filtro por estado (chips seleccionables)
│   ├── Filtro por prioridad
│   ├── Filtro por técnico asignado
│   └── Búsqueda por número, cliente o descripción
├── Tabla de tickets
│   ├── Columnas: Nro, Prioridad, Título, Cliente, Técnico, Estado, SLA, Fecha
│   └── Acciones por fila: ver, asignar, cambiar estado
└── Botón "Nuevo ticket" (modal o vista separada)
```

**Rutas necesarias en `src/router/index.ts`:**

```typescript
{
  path: '/soporte',
  name: 'soporte',
  component: () => import('@/views/soporte/SoporteView.vue'),
  meta: { requiresAuth: true }
},
{
  path: '/soporte/:id',
  name: 'ticket-detail',
  component: () => import('@/views/soporte/TicketDetailView.vue'),
  meta: { requiresAuth: true }
},
{
  path: '/soporte/nuevo',
  name: 'ticket-nuevo',
  component: () => import('@/views/soporte/TicketNuevoView.vue'),
  meta: { requiresAuth: true }
}
```

**Store: `src/stores/soporte.ts`**

```typescript
import { defineStore } from 'pinia'
import { supabase } from '@/lib/supabase'

export const useSoporteStore = defineStore('soporte', {
  state: () => ({
    tickets: [] as SupportTicket[],
    loading: false,
    filtros: {
      estado: '' as string,
      prioridad: '' as string,
      tecnico_id: '' as string,
      busqueda: '' as string
    }
  }),

  getters: {
    ticketsFiltrados(state) {
      return state.tickets.filter(t => {
        if (state.filtros.estado && t.estado !== state.filtros.estado) return false
        if (state.filtros.prioridad && t.prioridad !== state.filtros.prioridad) return false
        if (state.filtros.tecnico_id && t.tecnico_id !== state.filtros.tecnico_id) return false
        if (state.filtros.busqueda) {
          const q = state.filtros.busqueda.toLowerCase()
          return t.numero.toLowerCase().includes(q)
            || t.titulo.toLowerCase().includes(q)
            || (t.cliente_nombre ?? '').toLowerCase().includes(q)
        }
        return true
      })
    },
    metricas(state) {
      return {
        abiertos: state.tickets.filter(t => t.estado === 'abierto').length,
        en_progreso: state.tickets.filter(t => t.estado === 'en_progreso').length,
        vencidos_sla: state.tickets.filter(t =>
          t.sla_vencimiento && new Date(t.sla_vencimiento) < new Date()
          && !['resuelto', 'cerrado'].includes(t.estado)
        ).length,
        resueltos_hoy: state.tickets.filter(t => {
          if (!t.resuelto_at) return false
          const hoy = new Date().toDateString()
          return new Date(t.resuelto_at).toDateString() === hoy
        }).length
      }
    }
  },

  actions: {
    async fetchTickets() {
      this.loading = true
      const { data } = await supabase
        .from('support_tickets')
        .select('*')
        .order('created_at', { ascending: false })
      this.tickets = data ?? []
      this.loading = false
    },

    async crearTicket(payload: Partial<SupportTicket>) {
      const { data } = await supabase
        .from('support_tickets')
        .insert(payload)
        .select()
        .single()
      if (data) this.tickets.unshift(data)
      return data
    },

    async actualizarEstado(id: string, estado: string, resolucion?: string) {
      const { data } = await supabase
        .from('support_tickets')
        .update({ estado, resolucion })
        .eq('id', id)
        .select()
        .single()
      if (data) {
        const idx = this.tickets.findIndex(t => t.id === id)
        if (idx !== -1) this.tickets[idx] = data
      }
      return data
    },

    async asignarTecnico(id: string, tecnico_id: string, tecnico_nombre: string) {
      return this.actualizarTicket(id, { tecnico_id, tecnico_nombre, estado: 'en_progreso' })
    }
  }
})
```

### Vista de detalle: `src/views/soporte/TicketDetailView.vue`

```
TicketDetailView.vue
├── Header: número, título, badges de estado y prioridad
├── Panel izquierdo (2/3 del ancho)
│   ├── Descripción original del ticket
│   ├── Timeline de actualizaciones
│   │   ├── Mensaje del cliente (burbuja derecha, azul)
│   │   ├── Respuesta del staff (burbuja izquierda, gris)
│   │   └── Nota interna (burbuja amarilla con candado)
│   └── Formulario de respuesta
│       ├── Textarea de mensaje
│       ├── Toggle "Nota interna" (solo staff)
│       ├── Subir fotos (drag & drop o botón)
│       └── Botón "Enviar respuesta"
└── Panel derecho (1/3 del ancho) — sidebar de info
    ├── Estado actual (dropdown para cambiar)
    ├── Prioridad (dropdown)
    ├── Técnico asignado (select de usuarios del tenant)
    ├── Cliente (link al perfil)
    ├── Canal de origen
    ├── SLA: vence en X horas / VENCIDO
    ├── Tiempo de resolución (si está resuelto)
    └── Acciones: Resolver / Cerrar / Reabrir
```

**Manejo de fotos con Supabase Storage:**

```typescript
// En TicketDetailView.vue
async function subirFotos(files: File[], ticketId: string, updateId: string) {
  const uploads = files.map(async (file) => {
    const path = `soporte/${ticketId}/${Date.now()}_${file.name}`
    const { error } = await supabase.storage
      .from('ticket-photos')
      .upload(path, file)
    if (error) throw error

    const { data: urlData } = supabase.storage
      .from('ticket-photos')
      .getPublicUrl(path)

    await supabase.from('support_ticket_photos').insert({
      ticket_id: ticketId,
      update_id: updateId,
      storage_path: path,
      url: urlData.publicUrl,
      nombre_archivo: file.name
    })
  })
  await Promise.all(uploads)
}
```

**Bucket de Storage:**

```sql
-- Crear bucket en Supabase Dashboard o via migración
INSERT INTO storage.buckets (id, name, public)
VALUES ('ticket-photos', 'ticket-photos', true);

-- Política de acceso (staff del mismo tenant puede subir)
CREATE POLICY "staff_upload_ticket_photos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'ticket-photos');
```

---

## 9.2 Portal del cliente

El portal es una sección completamente separada de la interfaz del staff. Los clientes acceden con credenciales propias (tabla `client_portal_users`) y solo ven sus propios tickets.

### Rutas del portal

```typescript
// En src/router/index.ts
{
  path: '/portal',
  children: [
    {
      path: 'login',
      name: 'portal-login',
      component: () => import('@/views/portal/PortalLoginView.vue'),
      meta: { requiresAuth: false }
    },
    {
      path: 'dashboard',
      name: 'portal-dashboard',
      component: () => import('@/views/portal/PortalDashboardView.vue'),
      meta: { requiresPortalAuth: true }
    },
    {
      path: 'tickets',
      name: 'portal-tickets',
      component: () => import('@/views/portal/PortalTicketsView.vue'),
      meta: { requiresPortalAuth: true }
    },
    {
      path: 'tickets/:id',
      name: 'portal-ticket-detalle',
      component: () => import('@/views/portal/PortalTicketDetalleView.vue'),
      meta: { requiresPortalAuth: true }
    }
  ]
}
```

### Autenticación del portal

La autenticación del portal NO usa Supabase Auth — usa la tabla `client_portal_users` con un endpoint del backend Hono:

**Backend: `server/src/routes/portal.ts`**

```typescript
import { Hono } from 'hono'
import { sign, verify } from 'hono/jwt'
import bcrypt from 'bcrypt'
import { createClient } from '@supabase/supabase-js'

const portal = new Hono()

// POST /api/portal/login
portal.post('/login', async (c) => {
  const { email, password, tenant_id } = await c.req.json()

  const { data: user } = await supabase
    .from('client_portal_users')
    .select('*')
    .eq('email', email)
    .eq('tenant_id', tenant_id)
    .eq('activo', true)
    .single()

  if (!user) return c.json({ error: 'Credenciales incorrectas' }, 401)

  const valido = await bcrypt.compare(password, user.password_hash)
  if (!valido) return c.json({ error: 'Credenciales incorrectas' }, 401)

  // Actualizar último acceso
  await supabase
    .from('client_portal_users')
    .update({ ultimo_acceso: new Date().toISOString() })
    .eq('id', user.id)

  const token = await sign(
    { sub: user.id, cliente_id: user.cliente_id, tenant_id, exp: Math.floor(Date.now() / 1000) + 86400 },
    process.env.PORTAL_JWT_SECRET!
  )

  return c.json({ token, nombre: user.nombre, cliente_id: user.cliente_id })
})

// GET /api/portal/tickets — tickets del cliente autenticado
portal.get('/tickets', async (c) => {
  const payload = c.get('portalUser') // middleware de verificación JWT
  const { data } = await supabase
    .from('support_tickets')
    .select(`*, support_ticket_updates(*), support_ticket_photos(*)`)
    .eq('cliente_id', payload.cliente_id)
    .eq('tenant_id', payload.tenant_id)
    .order('created_at', { ascending: false })
  return c.json(data ?? [])
})

// POST /api/portal/tickets — crear nuevo ticket
portal.post('/tickets', async (c) => {
  const payload = c.get('portalUser')
  const { titulo, descripcion } = await c.req.json()

  // Obtener datos del cliente
  const { data: cliente } = await supabase
    .from('clientes')
    .select('nombre, telefono')
    .eq('id', payload.cliente_id)
    .single()

  const numero = await generarNumeroTicket(payload.tenant_id)

  const { data } = await supabase
    .from('support_tickets')
    .insert({
      tenant_id: payload.tenant_id,
      numero,
      cliente_id: payload.cliente_id,
      cliente_nombre: cliente?.nombre,
      cliente_telefono: cliente?.telefono,
      titulo,
      descripcion,
      canal_origen: 'portal'
    })
    .select()
    .single()

  return c.json(data)
})

export default portal
```

### Vistas del portal

**`PortalLoginView.vue`** — Pantalla de login con logo del ISP (configurable), campo email y contraseña. Tono visual diferente al panel del staff (puede ser blanco/azul corporativo).

**`PortalDashboardView.vue`** — Resumen:
- Nombre del cliente bienvenida
- Cantidad de tickets abiertos
- Último ticket creado
- Botón destacado "Nuevo ticket"

**`PortalTicketsView.vue`** — Lista de tickets propios:
- Solo ve: número, título, estado, prioridad, fecha
- No ve: técnico asignado, notas internas
- Puede filtrar por estado
- Puede crear nuevo ticket desde aquí

**`PortalTicketDetalleView.vue`** — Detalle del ticket:
- Ve la descripción original
- Ve todas las respuestas del staff (excepto las marcadas como `es_nota_interna = true`)
- Puede escribir una respuesta (que crea un `support_ticket_update` con `autor_tipo = 'cliente'`)
- Puede adjuntar fotos

---

## 9.3 En fsMk (app móvil)

Los técnicos de campo pueden consultar y actualizar tickets directamente desde la app móvil, incluyendo adjuntar fotos tomadas con la cámara del dispositivo.

### Estructura de archivos

```
D:/fsmk/src/views/soporte/
├── SoporteListView.vue      — lista de tickets asignados al técnico
├── TicketDetalleView.vue    — detalle con timeline y respuesta
└── TicketFotoView.vue       — captura y adjunta foto con la cámara
```

### Capacitor Camera Plugin

```bash
# En D:/fsmk
npm install @capacitor/camera
npx cap sync android
```

**`TicketFotoView.vue`:**

```typescript
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'

async function tomarFoto(ticketId: string) {
  const photo = await Camera.getPhoto({
    quality: 80,
    allowEditing: false,
    resultType: CameraResultType.DataUrl,
    source: CameraSource.Camera // o CameraSource.Photos para galería
  })

  if (!photo.dataUrl) return

  // Convertir dataUrl a blob
  const res = await fetch(photo.dataUrl)
  const blob = await res.blob()
  const file = new File([blob], `foto_${Date.now()}.jpg`, { type: 'image/jpeg' })

  // Subir a Supabase Storage (mismo bucket que el web)
  const path = `soporte/${ticketId}/${Date.now()}_campo.jpg`
  await supabase.storage.from('ticket-photos').upload(path, file)

  const { data: urlData } = supabase.storage.from('ticket-photos').getPublicUrl(path)

  await supabase.from('support_ticket_photos').insert({
    ticket_id: ticketId,
    storage_path: path,
    url: urlData.publicUrl,
    nombre_archivo: `foto_campo_${Date.now()}.jpg`,
    subido_por: 'tecnico_movil'
  })
}
```

**`SoporteListView.vue` — filtrado por técnico autenticado:**

```typescript
// El técnico solo ve los tickets que tiene asignados
const { data } = await supabase
  .from('support_tickets')
  .select('id, numero, titulo, estado, prioridad, cliente_nombre, updated_at')
  .eq('tecnico_id', user.value?.id)
  .not('estado', 'in', '("cerrado")')
  .order('prioridad', { ascending: false })
```

### Permisos Android requeridos

En `android/app/src/main/AndroidManifest.xml` agregar si no están:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
```

### Navegación en la app móvil

Agregar entrada en el menú lateral de fsMk (`src/components/NavMenu.vue`):

```typescript
{ icon: 'ticket', label: 'Soporte', route: '/soporte', roles: ['tecnico', 'admin'] }
```

---

## 9.4 Integración WhatsApp (opcional)

Permite enviar notificaciones automáticas a los clientes vía WhatsApp cuando cambia el estado de su ticket.

### Migración: `supabase/migrations/045_whatsapp_soporte.sql`

```sql
-- Configuración de WhatsApp por tenant
CREATE TABLE whatsapp_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  proveedor TEXT NOT NULL DEFAULT 'meta'
    CHECK (proveedor IN ('meta', 'twilio', 'waba360', 'ultramsg')),
  api_url TEXT,
  api_token TEXT,
  phone_number_id TEXT,     -- Para Meta Cloud API
  waba_id TEXT,             -- WhatsApp Business Account ID
  activo BOOLEAN DEFAULT false,
  notif_ticket_nuevo BOOLEAN DEFAULT true,
  notif_ticket_respuesta BOOLEAN DEFAULT true,
  notif_ticket_resuelto BOOLEAN DEFAULT true,
  mensaje_nuevo TEXT DEFAULT 'Hola {nombre}, tu ticket {numero} fue registrado. Te responderemos pronto.',
  mensaje_respuesta TEXT DEFAULT 'Hola {nombre}, hay una respuesta en tu ticket {numero}.',
  mensaje_resuelto TEXT DEFAULT 'Hola {nombre}, tu ticket {numero} fue resuelto. ¿Quedaste satisfecho?',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Log de notificaciones enviadas
CREATE TABLE whatsapp_notificaciones_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  ticket_id UUID REFERENCES support_tickets(id) ON DELETE SET NULL,
  telefono TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('enviado', 'error', 'pendiente')),
  error_detalle TEXT,
  proveedor TEXT,
  message_id TEXT, -- ID de mensaje devuelto por el proveedor
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Función de envío (backend Hono)

**`server/src/services/whatsapp.ts`:**

```typescript
interface WhatsAppConfig {
  proveedor: string
  api_url: string
  api_token: string
  phone_number_id?: string
}

export async function enviarNotificacionWhatsApp(
  config: WhatsAppConfig,
  telefono: string,
  mensaje: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  // Normalizar teléfono (Ecuador: agregar 593 si empieza en 0)
  const tel = normalizarTelefono(telefono)

  if (config.proveedor === 'meta') {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${config.phone_number_id}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.api_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: tel,
          type: 'text',
          text: { body: mensaje }
        })
      }
    )
    const json = await res.json()
    if (!res.ok) return { success: false, error: json.error?.message }
    return { success: true, messageId: json.messages?.[0]?.id }
  }

  if (config.proveedor === 'ultramsg') {
    const res = await fetch(`${config.api_url}/messages/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: config.api_token, to: tel, body: mensaje })
    })
    const json = await res.json()
    return { success: json.sent === 'true', messageId: json.id }
  }

  return { success: false, error: 'Proveedor no soportado' }
}

function normalizarTelefono(tel: string): string {
  const limpio = tel.replace(/\D/g, '')
  if (limpio.startsWith('0') && limpio.length === 10) return '593' + limpio.slice(1)
  if (!limpio.startsWith('593')) return '593' + limpio
  return limpio
}
```

### Hook en el backend al cambiar estado del ticket

```typescript
// En server/src/routes/tickets.ts — cuando se actualiza un ticket
app.patch('/api/tickets/:id/estado', async (c) => {
  const { id } = c.req.param()
  const { estado } = await c.req.json()
  const tenantId = c.get('tenantId')

  // Actualizar ticket
  const { data: ticket } = await supabase
    .from('support_tickets')
    .update({ estado })
    .eq('id', id)
    .select()
    .single()

  // Buscar config WhatsApp del tenant
  const { data: waConfig } = await supabase
    .from('whatsapp_config')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('activo', true)
    .single()

  if (waConfig && ticket?.cliente_telefono) {
    let plantilla = ''
    if (estado === 'en_progreso' && waConfig.notif_ticket_respuesta) plantilla = waConfig.mensaje_respuesta
    if (estado === 'resuelto' && waConfig.notif_ticket_resuelto) plantilla = waConfig.mensaje_resuelto

    if (plantilla) {
      const mensaje = plantilla
        .replace('{nombre}', ticket.cliente_nombre ?? 'Cliente')
        .replace('{numero}', ticket.numero)

      const resultado = await enviarNotificacionWhatsApp(waConfig, ticket.cliente_telefono, mensaje)
      await supabase.from('whatsapp_notificaciones_log').insert({
        tenant_id: tenantId,
        ticket_id: ticket.id,
        telefono: ticket.cliente_telefono,
        mensaje,
        estado: resultado.success ? 'enviado' : 'error',
        error_detalle: resultado.error,
        message_id: resultado.messageId,
        proveedor: waConfig.proveedor
      })
    }
  }

  return c.json(ticket)
})
```

### Proveedores WhatsApp recomendados

| Proveedor | Precio aprox. | Facilidad | Notas |
|---|---|---|---|
| Meta Cloud API (oficial) | Gratis primeras 1000 conv/mes | Media | Requiere verificar empresa en Meta |
| UltraMsg | $15/mes | Alta | No oficial, pero muy fácil de integrar |
| Twilio | $0.005/msg + $15/num | Media | Muy confiable, documentación excelente |
| WABA360 | $49/mes | Media | Oficial, orientado a empresas |

---

## 9.5 Prompt Claude para crear el módulo de soporte completo

Usa este prompt dentro del proyecto fosmikro para que Claude Code genere todo el módulo de soporte técnico desde cero. Ejecuta este prompt en Claude Code con acceso al directorio del proyecto.

---

```
Estoy trabajando en el proyecto fosmikro (ISP Manager) ubicado en D:/fosmikro.

Stack:
- Frontend: Vue 3 + TypeScript + Vite + Tailwind CSS 4
- Backend: Hono (Node.js) en server/src/index.ts
- Base de datos: Supabase PostgreSQL + RLS multi-tenant
- App móvil: proyecto separado en D:/fsmk con Capacitor

Necesito que crees el MÓDULO DE SOPORTE TÉCNICO (Fase 9) completo. Sigue este orden:

### PASO 1 — Migración SQL

Crea el archivo supabase/migrations/044_soporte.sql con:
- Tabla support_tickets (campos: id, tenant_id, numero auto-generado TKT-XXXX, cliente_id, titulo, descripcion, estado, prioridad, tecnico_id, canal_origen, sla_vencimiento, tiempo_resolucion_min, resolucion, created_at, updated_at)
- Tabla support_ticket_updates (id, ticket_id, autor_id, autor_nombre, autor_tipo, mensaje, es_nota_interna, created_at)
- Tabla support_ticket_photos (id, ticket_id, update_id, url, storage_path)
- Tabla client_portal_users (id, tenant_id, cliente_id, email, password_hash, nombre, activo)
- RLS policies usando tenant_id del JWT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
- Función SQL para generar número de ticket
- Trigger para calcular tiempo_resolucion_min al resolver

### PASO 2 — Store Pinia

Crea src/stores/soporte.ts con:
- State: tickets[], loading, filtros (estado, prioridad, tecnico_id, busqueda)
- Getters: ticketsFiltrados, metricas (conteos por estado)
- Actions: fetchTickets, crearTicket, actualizarEstado, asignarTecnico, agregarUpdate, subirFotos

### PASO 3 — Vista principal (SoporteView.vue)

Crea src/views/soporte/SoporteView.vue con:
- Cards de métricas en la parte superior (abiertos, en_progreso, vencidos SLA, resueltos hoy)
- Barra de filtros: chips de estado (todos/abierto/en_progreso/resuelto/cerrado), select de prioridad, input de búsqueda
- Tabla de tickets con columnas: Nro, Prioridad (badge con color), Título, Cliente, Técnico, Estado, SLA (badge verde/rojo), Fecha
- Al hacer click en una fila navega a /soporte/:id
- Botón "Nuevo ticket" que abre un modal o navega a /soporte/nuevo
- Estilos consistentes con el resto de la app (Tailwind, colores del proyecto)

### PASO 4 — Vista de detalle (TicketDetailView.vue)

Crea src/views/soporte/TicketDetailView.vue con:
- Layout de dos columnas: timeline a la izquierda (2/3), sidebar a la derecha (1/3)
- Timeline muestra la descripción original y todas las actualizaciones con estilos diferenciados (staff vs cliente vs nota interna)
- Formulario de respuesta: textarea, toggle "nota interna", botón subir fotos (múltiples)
- Sidebar: dropdown de estado, dropdown de prioridad, select de técnico, info del cliente, badge SLA
- Acciones en sidebar: Resolver (pide resolución), Cerrar, Reabrir

### PASO 5 — Portal del cliente

Crea las vistas en src/views/portal/:
- PortalLoginView.vue: formulario login con email y contraseña, sin acceso al panel del staff
- PortalTicketsView.vue: lista de tickets del cliente autenticado (solo sus tickets)
- PortalTicketDetalleView.vue: detalle con timeline (sin notas internas), formulario de respuesta y adjuntar fotos

Crea el endpoint del backend en server/src/routes/portal.ts:
- POST /api/portal/login (verifica en client_portal_users, devuelve JWT propio)
- GET /api/portal/tickets (tickets del cliente del JWT)
- POST /api/portal/tickets (crear nuevo ticket desde el portal)
- POST /api/portal/tickets/:id/responder (agregar update como autor_tipo cliente)

### PASO 6 — Rutas del router

Agrega en src/router/index.ts las rutas:
- /soporte (SoporteView)
- /soporte/:id (TicketDetailView)
- /soporte/nuevo (TicketNuevoView si la creas separada)
- /portal/login (PortalLoginView, sin requiresAuth)
- /portal/tickets (PortalTicketsView, con requiresPortalAuth)
- /portal/tickets/:id (PortalTicketDetalleView, con requiresPortalAuth)

Guard de navegación: si la ruta tiene meta.requiresPortalAuth, verifica el token del portal en localStorage.

### PASO 7 — Entrada en el menú

Agrega en el sidebar del panel principal (busca el componente de navegación) una entrada:
- Ícono de ticket, texto "Soporte", ruta /soporte
- Posicionarla después de "Clientes" o en la sección de herramientas

### PASO 8 — Validaciones y detalles

- Asegúrate que todos los archivos usen TypeScript strict con interfaces definidas para SupportTicket, SupportTicketUpdate, SupportTicketPhoto
- La subida de fotos debe ir al bucket 'ticket-photos' de Supabase Storage
- El número de ticket se genera con la función SQL, no en el frontend
- Los colores de prioridad: baja=verde, media=azul, alta=naranja, critica=rojo
- Los colores de estado: abierto=azul, en_progreso=amarillo, resuelto=verde, cerrado=gris

Comienza con el PASO 1 y espera mi confirmación antes de continuar con el PASO 2.
```

---

> **Nota de uso del prompt:** Este prompt está diseñado para ejecutarse paso a paso. Confirma cada paso antes de continuar al siguiente para poder revisar el código generado, aplicar la migración SQL en Supabase y asegurarte de que todo funcione correctamente antes de avanzar. Si quieres generar todo de una sola vez, elimina la última línea del prompt.
