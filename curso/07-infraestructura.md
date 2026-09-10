Ahora tengo toda la información real del código. Genero el documento del curso:

---

# FASE 7 — Infraestructura de Red

## 7.0 ¿Qué es el módulo de infraestructura?

El módulo de infraestructura es un **mapa interactivo en tiempo real** que muestra todos los elementos de la red del ISP sobre un plano geográfico real. Desde una sola pantalla el técnico puede ver:

- Dónde están sus OLTs, routers MikroTik y ONUs de clientes
- Qué elementos pasivos (NAPs, splitters, mangas) tiene instalados y en qué estado
- El estado online/offline de cada equipo con semáforo de color
- Detalles de potencia óptica, spliteo y notas al pasar el cursor

**Librería de mapas:** Leaflet + OpenStreetMap. No requiere API key ni cuenta externa. Es completamente gratuita y funciona sin límite de peticiones. Leaflet es la librería de mapas más popular del mundo en código abierto, usada por organizaciones como GitHub, Craigslist y muchos sistemas GIS gubernamentales.

**Vista web:** `src/views/infraestructura/InfrastructuraView.vue`

**Vista móvil:** módulo de infraestructura en la app fsMk (Capacitor + Vue 3)

---

## 7.1 Tabla `infra_elementos` en Supabase

La migración `043_infra_elementos_pasivos.sql` crea la tabla que almacena cada elemento pasivo de la red:

```sql
-- supabase/migrations/043_infra_elementos_pasivos.sql
CREATE TABLE IF NOT EXISTS infra_elementos (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  tipo        VARCHAR(50)  NOT NULL DEFAULT 'caja_nap',
  potencia    VARCHAR(50),                    -- ej: "-15 dBm"
  spliteo     VARCHAR(20),                    -- ej: "1:8"
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  image_url   TEXT,                           -- foto del elemento
  lat         DECIMAL(10,8),                  -- latitud GPS
  lng         DECIMAL(11,8),                  -- longitud GPS
  notes       TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE infra_elementos ENABLE ROW LEVEL SECURITY;
CREATE POLICY infra_elementos_all ON infra_elementos
  FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
```

**Campos clave explicados:**

| Campo | Tipo | Descripcion |
|---|---|---|
| `name` | VARCHAR(100) | Nombre del elemento, ej: "NAP-001", "Splitter Sector Norte" |
| `tipo` | VARCHAR(50) | Tipo de elemento (ver lista abajo) |
| `potencia` | VARCHAR(50) | Potencia optica medida, ej: "-15 dBm" |
| `spliteo` | VARCHAR(20) | Relacion de division: 1:2, 1:4, 1:8, 1:16, 1:32, 1:64 |
| `is_active` | BOOLEAN | TRUE = operativo, FALSE = fuera de servicio |
| `image_url` | TEXT | URL de foto en Supabase Storage |
| `lat` / `lng` | DECIMAL | Coordenadas GPS con 8 decimales de precision |

**Tipos de elementos soportados:**

- `Caja NAP` — caja de distribucion de fibra en poste o pared
- `Splitter` — divisor optico pasivo
- `Manga de empalme` — union de cables de fibra
- `Armario` — gabinete outdoor o indoor
- `Poste` — poste de soporte
- `Camara` — camara de vigilancia
- `Otro` — elemento personalizado

> **Nota sobre multi-tenant:** La tabla actual no tiene columna `tenant_id`. En la fase de produccion multi-ISP se agregaria mediante una migracion `ALTER TABLE infra_elementos ADD COLUMN tenant_id UUID REFERENCES tenants(id)` y se ajustaria la politica RLS para filtrar por `auth.jwt()->>'tenant_id'`.

---

## 7.2 Capas del mapa

El mapa tiene cuatro capas independientes que se pueden activar o desactivar con los botones de filtro:

### Capa OLT (marcador azul/gota)

Los datos de coordenadas de cada OLT se guardan dentro del campo JSONB `extra_params` de la tabla `olt_devices`:

```json
{
  "lat": -0.2295,
  "lng": -78.5243,
  "community": "0",
  "slot": "0"
}
```

El icono es una "gota" (teardrop) rotada 45° con un icono SVG de servidor dentro. El color del fondo indica el estado: verde (online), rojo (offline), gris (desconocido).

### Capa MikroTik (marcador violeta/gota)

Los routers MikroTik tienen columnas `lat` y `lng` directas en la tabla `mikrotik_devices`. El icono SVG dentro de la gota representa un router con antenas.

### Capa ONU (marcador indigo/gota)

Las ONUs de clientes se obtienen cruzando `service_contracts` con `installation_addresses`. Cada contrato con numero serial ONU y una instalacion con latitud/longitud aparece como punto en el mapa. El icono SVG representa una antena WiFi/GPON.

```typescript
// Consulta que carga las ONUs (simplificada)
db.from('service_contracts')
  .select('id, olt_serial, installation_addresses(latitude, longitude, address_line1)')
  .not('olt_serial', 'is', null)
  .limit(500)
```

### Capa elementos pasivos (iconos por tipo)

Los elementos pasivos usan iconos cuadrados/circulares con colores distintos por tipo. A diferencia de los equipos activos, estos marcadores son arrastrables.

**Paleta de colores y formas:**

| Tipo | Color | Forma |
|---|---|---|
| Caja NAP | Naranja `#f97316` | Cuadrado |
| Splitter | Violeta `#8b5cf6` | Diamante |
| Manga de empalme | Azul cielo `#0ea5e9` | Pildora |
| Armario | Gris pizarra `#64748b` | Cuadrado |
| Poste | Marron `#92400e` | Circulo |
| Camara | Rojo `#dc2626` | Circulo |
| Otro | Indigo `#6366f1` | Pentagono |

Cuando un elemento esta marcado como inactivo (`is_active = false`), su color se degrada a gris `#9ca3af` independientemente del tipo.

---

## 7.3 Interactividad

### Filtros de capa

Cuatro botones tipo pill en la barra superior permiten mostrar u ocultar cada capa. Al hacer clic se llama `renderMarkers()` que limpia todos los marcadores y los vuelve a dibujar segun el estado de los filtros `showOlt`, `showMikrotik`, `showOnu` y `showElementos`.

```typescript
// Reactivo: al cambiar el filtro se re-renderiza el mapa
<button @click="showOlt = !showOlt; renderMarkers()">
  OLT ({{ stats.olts.length }})
</button>
```

### Tooltip permanente (membrete)

Cada marcador tiene un tooltip permanente que siempre esta visible (no requiere hover). Muestra el nombre en negrita y el tipo en gris debajo. Usa la clase CSS `leaflet-label-custom` con fondo blanco translucido y blur:

```css
.leaflet-label-custom {
  background: rgba(255,255,255,0.92) !important;
  border: 1px solid rgba(0,0,0,0.12) !important;
  border-radius: 6px !important;
  padding: 4px 8px !important;
  backdrop-filter: blur(4px);
}
```

### Tooltip hover con datos tecnicos (solo elementos pasivos)

Al pasar el cursor sobre un elemento pasivo aparece un tooltip adicional con fondo oscuro que muestra:

- Nombre y tipo
- Potencia optica (icono ⚡)
- Relacion de spliteo (icono con flechas)
- Notas adicionales

```typescript
m.on('mouseover', () => {
  hoverTip.setLatLng(m.getLatLng())
  map!.openTooltip(hoverTip)
})
m.on('mouseout', () => { map!.closeTooltip(hoverTip) })
```

### Drag & drop con guardado automatico

Los marcadores de elementos pasivos tienen `draggable: true`. Al soltar el marcador en una nueva posicion, el evento `dragend` guarda las coordenadas directamente en Supabase:

```typescript
m.on('dragend', async () => {
  const pos = m.getLatLng()
  await supabase
    .from('infra_elementos')
    .update({
      lat: Number(pos.lat.toFixed(7)),
      lng: Number(pos.lng.toFixed(7))
    })
    .eq('id', el.id)
})
```

No se necesita ningun boton de guardar. El mapa es la interfaz de edicion de coordenadas.

### Popup al hacer clic

Al hacer clic en cualquier marcador se abre un popup de Leaflet con:
- Equipos: nombre, IP/host, estado, detalle de version/identidad
- Elementos pasivos: foto (si tiene), tipo, potencia, spliteo, notas, estado activo/inactivo

### Leyenda plegable

Un panel colapsable en la parte superior muestra la simbologia completa del mapa. Se abre/cierra con un boton tipo accordion. Incluye: iconos de equipos activos, semaforo de estado, paleta de elementos pasivos y notas de interaccion.

---

## 7.4 Instalacion de Leaflet

```bash
npm install leaflet @types/leaflet
```

**Importacion en el componente Vue:**

```typescript
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
```

El CSS es critico. Sin el import de `leaflet.css` el mapa no se renderiza correctamente (los tiles aparecen desfasados, los controles no tienen estilo).

**Crear el mapa:**

```typescript
// Inicializar el mapa centrado en Ecuador
map = L.map(mapContainer.value, {
  center: [-1.8312, -78.1834],  // Centro geografico de Ecuador
  zoom: 7,
  zoomControl: true
})

// Agregar capa de tiles OpenStreetMap (gratuita, sin API key)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors',
  maxZoom: 19,
}).addTo(map)
```

**Problema comun en Vue: el contenedor debe existir en el DOM antes de inicializar Leaflet.** Por eso siempre se inicializa dentro de `onMounted`. Si el contenedor es condicional (`v-if`), usar `nextTick()`:

```typescript
onMounted(async () => {
  await Promise.all([loadDevices(), loadElementos()])
  if (!mapContainer.value) return
  map = L.map(mapContainer.value, { ... })
})

onUnmounted(() => {
  map?.remove()
  map = null
})
```

**El `onUnmounted` es obligatorio** para destruir la instancia del mapa y evitar errores si el componente se monta dos veces (hot-reload en dev).

---

## 7.5 Vista en fsMk (app movil)

La app movil Android usa el mismo componente Leaflet. Capacitor expone un WebView donde Vue 3 se ejecuta igual que en el navegador. Leaflet funciona sin modificaciones en WebView de Android.

**Diferencias respecto a la version web:**

- La pantalla es mas angosta: se ocultan las tarjetas de resumen estadistico y la leyenda aparece colapsada por defecto
- Se agrega un boton "Centrar en mi ubicacion" que usa `navigator.geolocation.getCurrentPosition()`
- Las instalaciones pendientes (clientes sin ONU asignada) se muestran con marcadores de color amarillo parpadeante para que el tecnico las identifique al llegar a la zona

**Mostrar instalaciones pendientes en el mapa:**

```typescript
// Cargar instalaciones pendientes con geolocalización
const { data: pendientes } = await supabase
  .from('service_contracts')
  .select('id, installation_addresses(latitude, longitude, address_line1)')
  .is('olt_serial', null)          // Sin ONU asignada = pendiente
  .not('installation_addresses', 'is', null)

for (const inst of pendientes ?? []) {
  const addr = inst.installation_addresses
  if (!addr?.latitude) continue

  L.circleMarker([addr.latitude, addr.longitude], {
    radius: 10,
    fillColor: '#f59e0b',
    color: '#d97706',
    weight: 2,
    opacity: 1,
    fillOpacity: 0.8
  })
  .bindTooltip(addr.address_line1 ?? 'Instalacion pendiente')
  .addTo(map)
}
```

---

## 7.6 Diagrama de jerarquia de red

```
                    INTERNET
                       |
              ┌────────┴────────┐
              │   MikroTik CCR  │  (core router, upstream BGP/ISP)
              │  192.168.1.1    │
              └────────┬────────┘
                       │  (fibra backbone o GbE)
              ┌────────┴────────┐
              │   OLT Huawei   │  (MA5800-X15, MA5800-X7...)
              │  olt_devices   │
              └──┬──────────┬──┘
                 │          │
         ┌───────┴─┐    ┌───┴──────┐
         │ Puerto 0│    │ Puerto 1 │  (PON port, hasta 128 ONUs)
         └───┬─────┘    └──┬───────┘
             │             │
      ┌──────┴──────┐      │
      │   Splitter  │      │  (infra_elementos, tipo: Splitter)
      │   1:8 -6dB  │      │
      └──┬──┬──┬────┘      │
         │  │  │
    ┌────┘  │  └────────┐
    │       │           │
┌───┴──┐ ┌──┴───┐ ┌─────┴──┐
│ NAP  │ │ NAP  │ │  NAP   │  (infra_elementos, tipo: Caja NAP)
│ -01  │ │ -02  │ │  -03   │
└──┬───┘ └──┬───┘ └────┬───┘
   │        │          │
 ONU1     ONU2       ONU3       (service_contracts + installation_addresses)
 cliente  cliente    cliente
```

**Ruta optica tipica (presupuesto de potencia):**

```
OLT TX:  +2 dBm
  - Fibra troncal (2 km): -0.4 dB
  - Conector ODF: -0.5 dB
  - Splitter 1:8: -10.5 dB
  - Conector NAP: -0.5 dB
  - Fibra abonado (300 m): -0.06 dB
  - Conector ONU: -0.5 dB
                ────────────────
ONU RX:  -10.46 dBm  (umbral minimo: -27 dBm en clase B+)
```

---

## 7.7 Prompt Claude para crear el modulo de infraestructura completo

Copia este prompt en Claude Code para implementar el modulo desde cero en tu propio proyecto:

```
Crea el modulo completo de Infraestructura de Red para un ISP Manager con Vue 3 + TypeScript + Tailwind CSS 4 + Supabase + Leaflet.

STACK:
- Vue 3 Composition API con <script setup lang="ts">
- Tailwind CSS 4 (clases utilitarias modernas)
- Supabase como backend/base de datos
- Leaflet + OpenStreetMap (sin API key)
- Heroicons (@heroicons/vue/24/outline)

BASE DE DATOS (ya existe):
- Tabla olt_devices: id, name, host, brand, last_test_ok, extra_params (JSONB con lat/lng)
- Tabla mikrotik_devices: id, name, host, last_test_ok, lat, lng, identity, ros_version
- Tabla service_contracts: id, olt_serial, installation_addresses (FK)
- Tabla installation_addresses: latitude, longitude, address_line1
- Tabla infra_elementos: id, name, tipo, potencia, spliteo, is_active, image_url, lat, lng, notes

CREAR el archivo src/views/infraestructura/InfrastructuraView.vue con:

1. MAPA LEAFLET
   - Centro inicial: [-1.8312, -78.1834] (Ecuador), zoom 7
   - Tiles: OpenStreetMap gratuito
   - Destruir instancia en onUnmounted()

2. CUATRO CAPAS DE MARCADORES
   a) OLT: marcador gota azul, icono SVG de servidor, coordenadas de extra_params.lat/lng
   b) MikroTik: marcador gota violeta, icono SVG de router, coordenadas de mikrotik_devices.lat/lng
   c) ONU: marcador gota indigo, icono SVG de antena, coordenadas de installation_addresses
   d) Elementos pasivos: iconos distintos por tipo (cuadrado/circulo/pildora), arrastrables

3. ICONOS SVG PERSONALIZADOS (L.divIcon)
   - Forma "gota" (teardrop): div rotado -45deg con borde redondeado 50%50%50%0
   - Color de relleno = semaforo de estado (verde online, rojo offline, gris desconocido)
   - SVG interno rotado +45deg para compensar

4. INTERACTIVIDAD
   - Tooltip permanente (siempre visible): nombre + tipo
   - Tooltip hover (oscuro): potencia + spliteo + notas
   - Popup al click: imagen + todos los datos
   - Drag & drop en elementos pasivos → guardar en Supabase automaticamente en evento dragend
   - Filtros de capa: 4 botones pill toggle que llaman renderMarkers()
   - Ajuste automatico de vista: map.fitBounds() despues de renderizar

5. TARJETAS DE RESUMEN
   - Contadores: OLTs, MikroTiks, ONUs, Pasivos, En linea, Caidos
   - Con computed() que filtra devices.value por type

6. LEYENDA PLEGABLE (accordion)
   - Iconos de equipos activos
   - Semaforo de estado
   - Paleta de elementos pasivos
   - Nota de interaccion (drag, click, filtros)

7. MODAL CRUD PARA ELEMENTOS PASIVOS
   - Campos: nombre, tipo (select), spliteo (select 1:2..1:64), potencia (text), estado (toggle), imagen (upload), lat/lng (number), notas (textarea)
   - Upload de imagen via POST /api/upload-image con base64
   - Abrir en modo "nuevo" con coordenadas del centro del mapa actual
   - Abrir en modo "editar" con datos del elemento

8. ESTILOS CSS
   .leaflet-label-custom: fondo blanco translucido, backdrop-filter blur, borde suave
   .leaflet-hover-potencia: fondo oscuro rgba(15,23,42,0.92), sin flecha, padding 8px

TIPOS TYPESCRIPT:
interface MapDevice { id, name, host, type: 'olt'|'mikrotik'|'onu', lat, lng, status, detail, brand? }
interface InfraElemento { id, name, tipo, potencia, spliteo, is_active, image_url, lat, lng, notes }

COLORES POR TIPO DE ELEMENTO:
Caja NAP: #f97316 (naranja), cuadrado
Splitter: #8b5cf6 (violeta), diamante
Manga de empalme: #0ea5e9 (azul cielo), pildora
Armario: #64748b (gris pizarra), cuadrado
Poste: #92400e (marron), circulo
Camara: #dc2626 (rojo), circulo
Otro: #6366f1 (indigo), pentagono

Inactivo: siempre gris #9ca3af independiente del tipo.

El resultado debe ser un componente completo, autocontenido, listo para usar.
```

---

## Resumen de archivos del modulo

| Archivo | Proposito |
|---|---|
| `supabase/migrations/043_infra_elementos_pasivos.sql` | Crea la tabla `infra_elementos` con RLS |
| `src/views/infraestructura/InfrastructuraView.vue` | Componente principal: mapa + CRUD |

**Dependencias que deben estar instaladas:**

```bash
npm install leaflet @types/leaflet
```

**Verificar en `package.json`:**

```json
{
  "dependencies": {
    "leaflet": "^1.9.x"
  },
  "devDependencies": {
    "@types/leaflet": "^1.9.x"
  }
}
```

**Ruta del router Vue** (agregar en `src/router/index.ts`):

```typescript
{
  path: '/infraestructura',
  name: 'infraestructura',
  component: () => import('@/views/infraestructura/InfrastructuraView.vue'),
  meta: { requiresAuth: true }
}
```
