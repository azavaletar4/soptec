Ahora tengo todo el contexto necesario. Voy a generar el índice completo del curso.

---

# ISP Manager Fosmikro — Curso Completo
## Guía para replicar los proyectos fosmikro y fsMk

---

## ÍNDICE GENERAL

1. [Descripción del curso y proyectos](#1-descripción-del-curso-y-proyectos)
2. [Requisitos previos del alumno](#2-requisitos-previos-del-alumno)
3. [Cómo usar este material](#3-cómo-usar-este-material)
4. [Tabla de fases con descripción y tiempo estimado](#4-tabla-de-fases)
5. [Diagrama general de la arquitectura](#5-diagrama-de-arquitectura)
6. [Glosario de términos](#6-glosario-de-términos)
7. [Instrucciones para personalizar el proyecto](#7-personalizar-el-proyecto)
8. [Links de descarga de los proyectos](#8-links-de-descarga)
9. [MEGA PROMPT — prompt completo para empezar desde cero](#9-mega-prompt)

---

## 1. DESCRIPCIÓN DEL CURSO Y PROYECTOS

### ¿Qué vas a construir?

Este curso te enseña a replicar dos sistemas reales de gestión para ISPs (proveedores de internet) desarrollados con tecnologías modernas de código abierto.

### Proyecto 1: fosmikro (Aplicación Web)

Sistema completo de administración para un ISP pequeño o mediano. Permite gestionar clientes, contratos, facturación electrónica SRI, dispositivos de red OLT/MikroTik, instalaciones, inventario, soporte técnico y reportes — todo en una sola aplicación web accesible desde cualquier navegador.

**Stack:** Vue 3 + TypeScript + Vite 8 + Tailwind CSS 4 + Hono (Node.js) + Supabase

**Módulos implementados:**
- Dashboard con métricas en tiempo real
- Clientes y contratos (Kanban, lista, detalle)
- OLT Huawei MA5800 y V-SOL (SSH directo: registro, señal, activar/desactivar ONTs)
- MikroTik REST API (PPPoE, DHCP, firewall, IPv6)
- TR-069 / GenieACS (gestión remota de CPEs)
- Facturación electrónica SRI Ecuador (XAdES-BES, RIDE PDF, correo automático)
- Cobros y Caja con reactivación automática de servicio
- Instalaciones con mapa Leaflet y orden de trabajo imprimible
- Inventario con Kardex de entradas/salidas
- Soporte técnico con portal del cliente
- Reportes: estadísticas OLT, MikroTik, cuentas por cobrar, planes, desconexiones
- Infraestructura de red (mapa visual)
- WhatsApp Business integración
- Multi-tenant preparado (subdominios por ISP cliente)

### Proyecto 2: fsMk (Aplicación Android)

Aplicación móvil para el técnico de campo. Permite consultar y gestionar la red desde el teléfono: ver ONUs, señal óptica, ping, diagnóstico TR-069, instalaciones pendientes, infraestructura y portal del cliente.

**Stack:** Vue 3 + TypeScript + Capacitor 8 + Tailwind CSS 4 + Supabase

**AppId:** `com.szfibersystem.fsmk`

**Módulos:** OLT, ONUs, MikroTik, TR-069, Instalaciones, Infraestructura, Portal cliente

---

## 2. REQUISITOS PREVIOS DEL ALUMNO

### Conocimientos técnicos mínimos

| Area | Nivel requerido |
|------|----------------|
| HTML + CSS básico | Intermedio |
| JavaScript (funciones, arrays, objetos) | Intermedio |
| Uso de terminal / PowerShell | Básico |
| Entender qué es una API REST | Básico |
| Conceptos de base de datos (tablas, filas, columnas) | Básico |

### Conocimientos opcionales (aprenderás en el curso)

- Vue 3 / TypeScript (se explica desde cero en el prompt)
- Supabase (se configura paso a paso)
- Redes ISP: OLT, MikroTik, GPON (el glosario te ayuda)
- Facturación electrónica SRI Ecuador

### Software requerido (a instalar antes de empezar)

| Software | Version | Enlace |
|----------|---------|--------|
| Node.js | v22 LTS o superior | https://nodejs.org |
| Git | Cualquier versión | https://git-scm.com |
| VS Code | Ultima version | https://code.visualstudio.com |
| Claude Code (CLI) | Ultima version | `npm install -g @anthropic-ai/claude-code` |
| Android Studio (solo fsMk) | Hedgehog o superior | https://developer.android.com/studio |
| JDK 21 Temurin (solo fsMk) | 21 LTS | https://adoptium.net |

### Cuentas a crear (gratuitas)

| Servicio | Para qué | URL |
|----------|----------|-----|
| Supabase | Base de datos + Auth + Storage | https://supabase.com |
| Cloudflare | Tunnel gratuito (URL pública) | https://cloudflare.com |
| GitHub | Control de versiones + build APK | https://github.com |
| Anthropic | Claude API para Claude Code | https://console.anthropic.com |

### Hardware mínimo recomendado

- PC o laptop: i5 / Ryzen 5, 8 GB RAM, SSD
- Sistema operativo: Windows 10/11, macOS 12+, o Ubuntu 22+
- Acceso a internet
- Para fsMk: teléfono Android 8+ para pruebas (o emulador AVD)

---

## 3. CÓMO USAR ESTE MATERIAL

### El método del curso

Este curso funciona con un modelo diferente al tradicional: **tú le das instrucciones a Claude (IA) y él construye el código paso a paso contigo.** No memorizas código; aprendes a dirigir el proceso de desarrollo.

### Pasos para cada fase

```
1. Lee la descripción de la fase en esta guía
2. Copia el prompt correspondiente a esa fase
3. Abre tu terminal en el directorio del proyecto
4. Ejecuta: claude
5. Pega el prompt en la sesión de Claude Code
6. Sigue las instrucciones que Claude te indique
7. Verifica que el resultado funciona antes de pasar a la fase siguiente
```

### Cómo copiar un prompt

Todo el texto dentro de un bloque como este es un prompt listo para copiar:

```
Copiar este texto exactamente y pegarlo en Claude Code.
Puedes modificar los valores entre [corchetes] para personalizar.
```

### Consejos de uso

- Si Claude pide permisos para crear archivos, responde "Allow" (permitir)
- Si algo falla, copia el mensaje de error y pégalo en la misma sesión de Claude
- Cada fase deja el proyecto en un estado funcional verificable
- Puedes pausar y retomar desde cualquier fase

### Verificación al final de cada fase

Al terminar cada fase, el sistema debe cumplir un criterio específico indicado en la descripción. No avances a la siguiente fase si el criterio no se cumple.

---

## 4. TABLA DE FASES

### Proyecto fosmikro (Web)

| # | Fase | Descripcion | Modulos | Tiempo est. |
|---|------|-------------|---------|-------------|
| 1 | Fundacion del proyecto | Crear proyecto Vue 3 + TypeScript + Vite + Tailwind CSS 4. Configurar Supabase. Crear estructura de carpetas. Login con Supabase Auth. | Auth, Layout, Router | 3-4 h |
| 2 | Backend Hono + base de datos | Crear servidor Hono en Node.js. Configurar proxy. Primeras tablas: clientes, contratos, planes, zonas. RLS básico. | BD, API | 4-5 h |
| 3 | Gestión de clientes y contratos | CRUD completo de clientes. Contratos con numeración automática. Vista Kanban y lista. Detalle de cliente. | Clientes, Contratos | 5-6 h |
| 4 | OLT — Huawei MA5800 | Conexión SSH desde Node.js. Listar ONTs. Registrar, activar, desactivar, eliminar ONTs. Señal óptica. Detalle completo. | OLT Huawei | 6-8 h |
| 5 | OLT — V-SOL | Soporte para OLT V-SOL (CLI Zebra). Comandos de provisión, señal, auto-find. Pantalla unificada con Huawei. | OLT V-SOL | 4-5 h |
| 6 | MikroTik REST API | Conexión a RouterOS via REST. PPPoE usuarios y activos. Leases DHCP. Cruce MAC→IP en lista de ONUs. Bloqueo/desbloqueo. | MikroTik | 4-5 h |
| 7 | TR-069 / GenieACS | Integración con GenieACS ACS. Listar CPEs. Detalle con parámetros TR-069. Reboot remoto. Perfiles de banda. | TR-069 | 5-6 h |
| 8 | Facturación electrónica SRI | Generación de XML factura. Firma XAdES-BES con certificado .p12. Envío al SRI. Autorización. RIDE PDF. Correo automático. | Facturación | 8-10 h |
| 9 | Cobros y Caja | Módulo de cobros por mes. Registro de pago con método. Reactivación automática (MikroTik + OLT). Caja con movimientos. | Cobros, Caja | 4-5 h |
| 10 | Instalaciones y Mapa | Órdenes de instalación. Mapa Leaflet con geolocalización. Orden de trabajo imprimible. Galería de fotos. | Instalaciones | 4-5 h |
| 11 | Inventario | Productos con categorías. Ingreso y egreso de stock. Kardex. Resumen de existencias. | Inventario | 3-4 h |
| 12 | Soporte técnico | Tickets con estados. Actualizaciones con archivos. Portal del cliente (login propio). | Soporte | 4-5 h |
| 13 | Reportes y estadísticas | Planes mas usados. Cuentas por cobrar con antigüedad. Desconexiones. Facturación por mes. Estadísticas OLT/MikroTik. | Reportes | 5-6 h |
| 14 | Facturación recurrente + WhatsApp | Generación masiva de facturas. Integración WhatsApp Business API. Notificaciones automaticas. | Recurrente, WA | 4-5 h |
| 15 | Producción con PM2 + Cloudflare | Build de producción. Hono sirve frontend estático. PM2 con procesos. Cloudflare tunnel para URL pública. | DevOps | 3-4 h |

**Tiempo total estimado fosmikro: 66-83 horas de trabajo**

---

### Proyecto fsMk (Android)

| # | Fase | Descripcion | Tiempo est. |
|---|------|-------------|-------------|
| A | Fundación Capacitor | Crear proyecto Vue 3 + Capacitor 8. Configurar Android Studio. Build APK debug. GitHub Actions automatico. | 3-4 h |
| B | Autenticación y navegación | Login con Supabase. Bottom nav. Pantallas principales vacías. | 2-3 h |
| C | Módulo OLT móvil | Lista de ONUs, señal óptica, acciones rápidas. Ping a ONUs. | 4-5 h |
| D | MikroTik móvil | PPPoE activos, recursos del sistema. | 2-3 h |
| E | TR-069 móvil | Lista de CPEs, detalle de dispositivo, reboot remoto. | 3-4 h |
| F | Instalaciones móvil | Instalaciones pendientes, registro de llegada, fotos con cámara. | 4-5 h |
| G | Infraestructura y Portal | Mapa de infraestructura. Acceso de técnico al portal. | 2-3 h |

**Tiempo total estimado fsMk: 20-27 horas de trabajo**

---

## 5. DIAGRAMA DE ARQUITECTURA

```
===============================================================================
                    ISP MANAGER FOSMIKRO — ARQUITECTURA COMPLETA
===============================================================================

  CAPA DE PRESENTACION
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                                                                         │
  │   NAVEGADOR WEB (fosmikro)              TELEFONO ANDROID (fsMk)         │
  │   ┌────────────────────────┐            ┌──────────────────────────┐    │
  │   │  Vue 3 + TypeScript    │            │  Vue 3 + Capacitor 8     │    │
  │   │  Vite 8 + Tailwind 4   │            │  Tailwind CSS 4          │    │
  │   │  Pinia (estado global) │            │  Supabase JS Client      │    │
  │   │  Vue Router 4          │            │  AppId: com.szfibersystem│    │
  │   │  Leaflet (mapas)       │            │         .fsmk            │    │
  │   │  Heroicons + Sonner    │            │                          │    │
  │   │                        │            │  Modulos:                │    │
  │   │  Modulos:              │            │  • OLT / ONUs            │    │
  │   │  • Dashboard           │            │  • MikroTik              │    │
  │   │  • Clientes            │            │  • TR-069                │    │
  │   │  • Contratos (Kanban)  │            │  • Instalaciones         │    │
  │   │  • OLT Huawei/V-SOL   │            │  • Infraestructura       │    │
  │   │  • MikroTik            │            │  • Portal Cliente        │    │
  │   │  • TR-069/GenieACS     │            └──────────────────────────┘    │
  │   │  • Facturacion SRI     │                         │                  │
  │   │  • Cobros / Caja       │                         │ HTTPS            │
  │   │  • Instalaciones       │                         │ Supabase JS      │
  │   │  • Inventario          │                         │                  │
  │   │  • Soporte             │                         │                  │
  │   │  • Reportes            │                         │                  │
  │   │  • Portal Cliente      │                         │                  │
  │   │  • WhatsApp            │                         │                  │
  │   └────────────────────────┘                         │                  │
  │               │                                      │                  │
  └───────────────┼──────────────────────────────────────┼──────────────────┘
                  │ HTTP/HTTPS                            │
                  │                                       │
  CAPA DE ACCESO PUBLICO                                  │
  ┌──────────────────────────────────────────────────────┼──────────────────┐
  │                                                       │                  │
  │   CLOUDFLARE TUNNEL (cloudflared.exe)                 │                  │
  │   ┌────────────────────────────────────────────────┐  │                  │
  │   │  URL publica: https://xxx.trycloudflare.com   │  │                  │
  │   │  o: https://mi-empresa.fosmikro.com (Named)   │  │                  │
  │   │  SSL/TLS automatico (Cloudflare)              │  │                  │
  │   │  Protocolo: HTTP/2                            │  │                  │
  │   │  Puerto local: 3000                           │  │                  │
  │   └────────────────────────────────────────────────┘  │                  │
  │               │                                       │                  │
  └───────────────┼───────────────────────────────────────┼──────────────────┘
                  │                                       │
  CAPA DE BACKEND (Servidor local Windows 11)            │
  ┌──────────────────────────────────────────────────────┼──────────────────┐
  │                                                       │                  │
  │   PM2 (gestor de procesos)                           │                  │
  │   ┌────────────────────────────────────────────────┐  │                  │
  │   │  proceso: fosmikro (puerto 3000)              │  │                  │
  │   │  ┌──────────────────────────────────────────┐ │  │                  │
  │   │  │  HONO (Node.js / TypeScript)             │ │  │                  │
  │   │  │  server/src/index.ts                     │ │  │                  │
  │   │  │                                          │ │  │                  │
  │   │  │  Rutas API:                              │ │  │                  │
  │   │  │  POST /api/olt-ssh    → OLT Huawei/VSOL │ │  │                  │
  │   │  │  POST /api/mikrotik/* → MikroTik REST    │ │  │                  │
  │   │  │  POST /api/sri/*      → Firma XAdES      │ │  │                  │
  │   │  │  POST /api/genieacs/* → TR-069 ACS       │ │  │                  │
  │   │  │  POST /api/whatsapp/* → WhatsApp API     │ │  │                  │
  │   │  │  GET  /api/upload-image → Storage        │ │  │                  │
  │   │  │  GET  /*              → Sirve dist/ Vue  │ │  │                  │
  │   │  │                                          │ │  │                  │
  │   │  │  Middleware:                             │ │  │                  │
  │   │  │  • Autenticacion JWT Supabase            │ │  │                  │
  │   │  │  • Tenant isolation (multi-tenant)       │ │  │                  │
  │   │  │  • CORS                                  │ │  │                  │
  │   │  └──────────────────────────────────────────┘ │  │                  │
  │   │                                               │  │                  │
  │   │  proceso: fosmikro-monitor                   │  │                  │
  │   │  ┌──────────────────────────────────────────┐ │  │                  │
  │   │  │  monitor-devices.cjs                     │ │  │                  │
  │   │  │  Polling cada N minutos:                 │ │  │                  │
  │   │  │  • Ping a ONUs registradas              │ │  │                  │
  │   │  │  • Estado online/offline en Supabase    │ │  │                  │
  │   │  └──────────────────────────────────────────┘ │  │                  │
  │   └────────────────────────────────────────────────┘  │                  │
  │                                                       │                  │
  └───────────────────────────────────────────────────────┼──────────────────┘
                  │                                       │
                  │ SSH (puerto 22)     REST API          │
                  │ node.js ssh2        (HTTPS)           │
  CAPA DE DISPOSITIVOS DE RED                            │
  ┌──────────────────────────────────────────────────────┼──────────────────┐
  │                                                       │                  │
  │   ┌─────────────────────┐   ┌──────────────────────┐ │                  │
  │   │  OLT HUAWEI MA5800  │   │   OLT V-SOL V1600    │ │                  │
  │   │  • SSH → enable     │   │   • SSH → Zebra CLI  │ │                  │
  │   │  • config           │   │   • configure term.  │ │                  │
  │   │  • interface gpon   │   │   • interface gpon   │ │                  │
  │   │    /slot/port       │   │     0/puerto         │ │                  │
  │   │  • ont add/delete   │   │   • onu add/delete   │ │                  │
  │   │  • service-port     │   │   • service-port     │ │                  │
  │   │  Hasta 128 ONTs     │   │   Puertos 1..N GPON  │ │                  │
  │   │  por puerto GPON    │   │                      │ │                  │
  │   └─────────┬───────────┘   └──────────┬───────────┘ │                  │
  │             │                          │             │                  │
  │             │ Fibra optica GPON        │             │                  │
  │             │                          │             │                  │
  │         Splitter óptico            Splitter          │                  │
  │             │                          │             │                  │
  │     ONTs / ONUs (clientes)         ONUs (clientes)   │                  │
  │     • Router del cliente           • Serial GPON     │                  │
  │     • Serial: HWTC08acff7a        • Estado working   │                  │
  │     • Señal Rx: -8 a -27 dBm      • Señal Rx/Tx     │                  │
  │                                                      │                  │
  │   ┌──────────────────────────────────────────────┐   │                  │
  │   │  MIKROTIK RouterOS v7+                       │   │                  │
  │   │  REST API: GET/PUT https://{host}/rest/...   │   │                  │
  │   │  • /ppp/secret     (usuarios PPPoE)         │   │                  │
  │   │  • /ppp/active     (conexiones activas)     │   │                  │
  │   │  • /ip/dhcp-server/lease (MAC→IP)           │   │                  │
  │   │  • /ip/address     (IPs configuradas)       │   │                  │
  │   │  • /resource       (CPU, RAM, uptime)       │   │                  │
  │   │  • /ip/firewall/*  (reglas de firewall)     │   │                  │
  │   └──────────────────────────────────────────────┘   │                  │
  │                                                      │                  │
  │   ┌──────────────────────────────────────────────┐   │                  │
  │   │  GENIEACS ACS (TR-069)                       │   │                  │
  │   │  • CWMP protocol (CPE → ACS)                │   │                  │
  │   │  • REST API GenieACS                        │   │                  │
  │   │  • Gestiona: ONTs, routers clientes         │   │                  │
  │   │  • Parámetros: SSID, pass, banda, firmware  │   │                  │
  │   └──────────────────────────────────────────────┘   │                  │
  │                                                      │                  │
  └──────────────────────────────────────────────────────┼──────────────────┘
                                                         │
  CAPA DE DATOS Y SERVICIOS EN LA NUBE                  │
  ┌────────────────────────────────────────────────────────────────────────┐
  │                                                                        │
  │   SUPABASE (PostgreSQL en la nube)                                     │
  │   ┌─────────────────────────────────────────────────────────────────┐  │
  │   │  PostgreSQL 15+                                                  │  │
  │   │  66+ migraciones SQL                                            │  │
  │   │                                                                  │  │
  │   │  Tablas principales:                                            │  │
  │   │  • clients              → datos de clientes ISP                 │  │
  │   │  • service_contracts    → contratos PPPoE/GPON                  │  │
  │   │  • plans                → planes de velocidad                   │  │
  │   │  • zones                → sectores de cobertura                 │  │
  │   │  • olt_devices          → equipos OLT registrados               │  │
  │   │  • olt_onts             → ONTs provisionadas                    │  │
  │   │  • mikrotik_devices     → routers MikroTik                      │  │
  │   │  • tr069_devices        → CPEs TR-069                           │  │
  │   │  • electronic_documents → facturas SRI (XML + estado)           │  │
  │   │  • instalacion_orders   → órdenes de instalación                │  │
  │   │  • support_tickets      → tickets de soporte                    │  │
  │   │  • productos            → inventario                            │  │
  │   │  • tenants              → empresas ISP (multi-tenant)           │  │
  │   │  • profiles             → usuarios con roles                    │  │
  │   │                                                                  │  │
  │   │  RLS (Row Level Security) en todas las tablas                    │  │
  │   │  Multi-tenant: tenant_id UUID en 25+ tablas                     │  │
  │   │                                                                  │  │
  │   │  Supabase Auth  → JWT con tenant_id en app_metadata             │  │
  │   │  Supabase Storage → bucket: olt-images, instalaciones           │  │
  │   │  Supabase Realtime → estados online/offline en tiempo real      │  │
  │   └─────────────────────────────────────────────────────────────────┘  │
  │                                                                        │
  │   SERVICIOS EXTERNOS                                                   │
  │   ┌──────────────────────────┐  ┌──────────────────────────────────┐   │
  │   │  SRI Ecuador (SOAP)      │  │  SMTP (correo)                   │   │
  │   │  • Recepción facturas    │  │  • Puerto 465 SSL                │   │
  │   │  • Autorización          │  │  • Puerto 587 STARTTLS           │   │
  │   │  • Ambiente 1 (pruebas)  │  │  • Envio RIDE PDF + XML          │   │
  │   │  • Ambiente 2 (produccion│  │                                  │   │
  │   │  XAdES-BES + SHA-1       │  │  WhatsApp Business API           │   │
  │   │  Certificado UANATACA    │  │  • Notificaciones de cobro       │   │
  │   └──────────────────────────┘  │  • Alertas de desconexión        │   │
  │                                  └──────────────────────────────────┘   │
  └────────────────────────────────────────────────────────────────────────┘

===============================================================================
  FLUJO DE UNA ACCION TIPICA: Registrar una ONU nueva
===============================================================================

  Técnico abre el navegador
         │
         │  1. Login: Supabase Auth → JWT con tenant_id
         ▼
  Pantalla OLT → Formulario: Serial, Frame/Slot/Port, Plan, Descripción
         │
         │  2. POST /api/olt-ssh
         │     { brand: "huawei", host: "192.168.1.100", serial: "HWTC08acff7a", ... }
         ▼
  Hono Backend (Node.js)
         │
         │  3. ssh2 abre sesión SSH a la OLT
         │     → enable → config → interface gpon 0/0
         │     → ont add 0 {id} sn-auth HWTC08acff7a ...
         │     → service-port {sp} vlan 100 ...
         │     → quit → quit
         ▼
  OLT Huawei MA5800 provisionada
         │
         │  4. Backend inserta en Supabase: olt_onts
         │     { serial, frame, slot, port, ont_id, status: 'online' }
         ▼
  Frontend recibe confirmacion → toast "ONU registrada correctamente"

```

---

## 6. GLOSARIO DE TÉRMINOS

### Redes GPON y Fibra Optica

| Termino | Significado |
|---------|-------------|
| **ISP** | Internet Service Provider — Proveedor de servicios de internet |
| **PON** | Passive Optical Network — Red optica pasiva (sin electrónica activa en la ruta entre OLT y cliente) |
| **GPON** | Gigabit Passive Optical Network — Version más comun de PON; 2.5 Gbps bajada, 1.25 Gbps subida por puerto |
| **XGS-PON** | 10-Gigabit Symmetric PON — Siguiente generación, 10 Gbps simétrico |
| **OLT** | Optical Line Terminal — Equipo principal en la cabecera del ISP (ej. Huawei MA5800, V-SOL V1600) |
| **ONT** | Optical Network Terminal — Router óptico instalado en casa del cliente. Mismo que ONU en contexto GPON |
| **ONU** | Optical Network Unit — Término genérico para el dispositivo del cliente en una red PON |
| **CPE** | Customer Premises Equipment — Cualquier equipo instalado en el domicilio del cliente |
| **Splitter** | Divisor óptico pasivo. Divide 1 fibra en 2, 4, 8, 16 o 32 ramales sin consumir energía |
| **Puerto GPON** | Puerto físico de la OLT. Cada puerto soporta hasta 64 o 128 ONTs en un árbol PON |
| **Frame/Slot/Port** | Coordenadas Huawei MA5800: chasis/tarjeta/puerto (ej. 0/0/0). V-SOL solo usa puerto |
| **ONT-ID** | Identificador logico de la ONT dentro de un puerto (0-127 Huawei; 1-128 V-SOL) |
| **Serial GPON** | Identificador único de la ONT: 4 letras fabricante + 8 caracteres hex (ej. HWTC08acff7a) |
| **Serial EPON** | Formato diferente al GPON (20 dígitos), incompatible. No se provisiona en OLT GPON |
| **Señal Rx** | Potencia óptica recibida por la ONT en dBm. Rango aceptable: -8 a -27 dBm |
| **Señal Tx** | Potencia óptica transmitida por la ONT hacia la OLT en dBm |
| **PLOAM** | Physical Layer OAM — Protocolo de registro de la ONT en el puerto PON |

### Provisión OLT

| Termino | Significado |
|---------|-------------|
| **Lineprofile** | Perfil de línea (Huawei) — define TCONT y GEMport. Vinculado a un plan de velocidad |
| **Srvprofile** | Perfil de servicio (Huawei) — define los puertos virtuales ETH, POTS, CATV de la ONT |
| **TCONT** | Transmission Container — Contenedor de trafico asignado a cada ONT con garantía de ancho de banda |
| **GEMport** | GPON Encapsulation Mode port — Canal virtual de datos dentro de un TCONT |
| **Service-port** | Puerto de servicio Huawei — Mapea la VLAN de red con el GEMport de una ONT específica |
| **VEIP** | Virtual Ethernet Interface Point — Interfaz virtual usada en V-SOL para el trafico del cliente |
| **VLAN** | Virtual LAN — Separación logica del trafico en la red. Ej: VLAN 100 = clientes internet |
| **PPPoE** | Point-to-Point Protocol over Ethernet — Protocolo de autenticación del cliente en MikroTik |
| **DHCP** | Dynamic Host Configuration Protocol — Asigna direcciones IP automaticamente |
| **Lease** | Concesión DHCP — Registro de IP asignada a una MAC específica por un tiempo determinado |
| **DBA** | Dynamic Bandwidth Allocation — Asignacion dinámica de ancho de banda en GPON |

### TR-069 y Gestión Remota

| Termino | Significado |
|---------|-------------|
| **TR-069** | Technical Report 069 — Protocolo estándar CPE WAN Management Protocol (CWMP) para gestión remota de dispositivos |
| **ACS** | Auto Configuration Server — Servidor que gestiona los CPEs via TR-069. Ej: GenieACS |
| **CWMP** | CPE WAN Management Protocol — El protocolo que define TR-069 |
| **GenieACS** | Servidor ACS de código abierto compatible con TR-069. Se instala en el servidor del ISP |
| **Parámetro TR-069** | Valor configurable de un CPE: SSID, contraseña WiFi, velocidad, firmware, etc. |
| **Inform** | Mensaje que el CPE envía al ACS periodicamente para informar su estado |
| **Provision** | Conjunto de tareas que el ACS ejecuta en el CPE al conectarse |

### Base de Datos y Seguridad

| Termino | Significado |
|---------|-------------|
| **Supabase** | Plataforma BaaS (Backend as a Service) basada en PostgreSQL con Auth, Storage y Realtime |
| **PostgreSQL** | Sistema de base de datos relacional de código abierto. El motor de Supabase |
| **RLS** | Row Level Security — Seguridad a nivel de fila en PostgreSQL. Cada usuario solo ve sus datos |
| **JWT** | JSON Web Token — Token cifrado que contiene la identidad del usuario y sus permisos |
| **app_metadata** | Campo del JWT en Supabase donde se guarda el tenant_id y rol del usuario |
| **Migración SQL** | Archivo .sql con cambios a la estructura de la base de datos, aplicados en orden |
| **Policy RLS** | Regla en PostgreSQL que define qué filas puede ver o modificar cada usuario |
| **Multi-tenant** | Arquitectura donde un mismo sistema sirve a múltiples empresas completamente aisladas |
| **tenant_id** | UUID que identifica a qué empresa pertenece cada registro en la base de datos |
| **UUID** | Universally Unique Identifier — Identificador único de 128 bits usado como clave primaria |
| **Foreign Key** | Clave foránea — Referencia entre tablas en la base de datos |

### Facturación Electrónica SRI

| Termino | Significado |
|---------|-------------|
| **SRI** | Servicio de Rentas Internas — Entidad tributaria de Ecuador |
| **RIDE** | Representacion Impresa del Documento Electrónico — El PDF de la factura electrónica |
| **XAdES-BES** | XML Advanced Electronic Signatures Basic Electronic Signature — Estándar de firma digital del SRI Ecuador |
| **Clave de acceso** | Código de 49 dígitos que identifica unívocamente cada comprobante en el SRI |
| **Comprobante** | Documento tributario: Factura (01), Nota de Crédito (04), Retención (07), Liquidación (03) |
| **PKCS#12 (.p12)** | Formato de certificado digital que contiene la clave privada y el certificado público |
| **UANATACA** | Autoridad de certificación que emite firmas electrónicas válidas para el SRI Ecuador |
| **SHA-1** | Algoritmo de hash requerido por el SRI Ecuador para la firma XAdES (obsoleto en otros contextos) |
| **Ambiente 1** | Pruebas/Certificacion — Las facturas no tienen validez legal ni tributaria |
| **Ambiente 2** | Producción — Las facturas tienen plena validez legal y tributaria |
| **Modulo 11** | Algoritmo para calcular el dígito verificador de la clave de acceso |
| **AUTORIZADO** | Estado final válido: el SRI acepto y autorizo el comprobante |
| **DEVUELTA** | El SRI rechazo el comprobante — hay errores en el XML o la firma |
| **Error 39** | Error de firma invalida — generalmente por colisión de IDs en el XML firmado |
| **RUC** | Registro Único de Contribuyentes — Número fiscal de 13 dígitos en Ecuador |
| **RIMPE** | Régimen RIMPE — Régimen impositivo para microempresas en Ecuador |

### Stack Tecnologico

| Termino | Significado |
|---------|-------------|
| **Vue 3** | Framework JavaScript progresivo para construir interfaces de usuario con Composition API |
| **TypeScript** | Superset de JavaScript con tipado estático que detecta errores antes de ejecutar |
| **Vite** | Build tool ultrarrápido para proyectos frontend. Usa ES modules nativos en desarrollo |
| **Tailwind CSS** | Framework CSS utilitario — clases predefinidas para estilizar sin escribir CSS propio |
| **Hono** | Framework web ultraligero para Node.js / Bun / Deno. Similar a Express pero mas moderno |
| **Node.js** | Entorno de ejecución de JavaScript en el servidor |
| **Pinia** | Store de estado global para Vue 3. Reemplaza a Vuex |
| **Vue Router** | Router oficial de Vue 3 para navegación entre vistas sin recargar la página |
| **Capacitor** | Framework para convertir apps web (Vue/React) en apps nativas iOS y Android |
| **ssh2** | Librería Node.js para abrir conexiones SSH desde el servidor backend |
| **PM2** | Process Manager 2 — Gestor de procesos Node.js para producción. Reinicia automaticamente |
| **Cloudflare Tunnel** | Servicio de Cloudflare que expone un servidor local a internet con HTTPS sin abrir puertos |
| **Leaflet** | Librería JavaScript para mapas interactivos. Alternativa libre a Google Maps |
| **xadesjs** | Librería JavaScript para generar firmas XAdES (usada para firma SRI Ecuador) |
| **node-forge** | Librería Node.js para manejo de certificados digitales (.p12, PKCS#8) |

---

## 7. INSTRUCCIONES PARA PERSONALIZAR EL PROYECTO

### Cambiar el nombre del proyecto

El proyecto se llama "fosmikro" en todos los archivos de configuración. Si quieres usar otro nombre (ej. "myisp", "netmanager", "fibernet"), reemplaza en estos lugares:

| Archivo | Donde reemplazar |
|---------|-----------------|
| `package.json` | campo `"name"` |
| `ecosystem.config.cjs` | nombre de procesos PM2 |
| `index.html` | `<title>` |
| `src/views/auth/LoginView.vue` | nombre visible en pantalla |
| `src/components/layout/AppLayout.vue` | nombre en el sidebar |
| `.env` / `.env.production` | prefijo de variables si lo usas |
| `supabase/config.toml` | `project_id` |

### Cambiar datos del ISP

Dentro del sistema, los datos de tu empresa ISP se configuran en:

- **Pantalla:** Configuracion > Empresa (`/settings/company`)
- **Logo:** se sube en la misma pantalla
- **RUC, razon social, direccion:** en Configuracion > SRI para facturación

### Adaptar para otro país (facturación)

El módulo de facturación electrónica está diseñado para **Ecuador (SRI)**. Si tu país usa otro sistema:

1. Omite la Fase 8 (Facturación SRI) del MEGA PROMPT
2. Pide a Claude que genere la facturación para tu país con los requisitos específicos
3. El resto del sistema (OLT, MikroTik, TR-069, clientes) funciona en cualquier país

### Adaptar para otras marcas de OLT

El sistema ya soporta **Huawei MA5800** y **V-SOL**. Para agregar otra marca (ZTE, FiberHome, etc.):

- En el MEGA PROMPT, agrega: "Agrega soporte para OLT ZTE C300 con CLI..."
- El patrón de SSH ya está creado; solo cambian los comandos específicos

---

## 8. LINKS DE DESCARGA

> Nota: Los proyectos son privados. Para acceder, contacta al autor o sigue el curso y construye el tuyo propio usando el MEGA PROMPT de la sección siguiente.

| Proyecto | Repositorio | Descripcion |
|----------|-------------|-------------|
| fosmikro (web) | Privado — usar MEGA PROMPT para replicar | Sistema ISP Manager web completo |
| fsMk (Android) | Privado — usar MEGA PROMPT para replicar | App móvil de campo Android |
| GenieACS | https://github.com/genieacs/genieacs | ACS TR-069 de código abierto |
| cloudflared | https://github.com/cloudflare/cloudflared/releases | Binario del tunnel Cloudflare |

### Dependencias y herramientas (todas gratuitas)

| Herramienta | URL de descarga |
|-------------|----------------|
| Node.js v22 LTS | https://nodejs.org/en/download |
| Git | https://git-scm.com/downloads |
| VS Code | https://code.visualstudio.com |
| Claude Code CLI | `npm install -g @anthropic-ai/claude-code` |
| Android Studio | https://developer.android.com/studio |
| JDK 21 Temurin | https://adoptium.net/temurin/releases/?version=21 |
| cloudflared (Windows) | https://github.com/cloudflare/cloudflared/releases/latest |

### Cuentas gratuitas a crear

| Servicio | URL | Que necesitas |
|----------|-----|---------------|
| Supabase | https://supabase.com | Proyecto con URL y anon key |
| Cloudflare | https://cloudflare.com | Cuenta para crear tunnels |
| GitHub | https://github.com | Repo para control de versiones |
| Anthropic Console | https://console.anthropic.com | API key para Claude Code |

---

## 9. MEGA PROMPT

El siguiente prompt está diseñado para copiarse completo y pegarlo en una sesión de **Claude Code** (`claude` en la terminal, dentro del directorio de tu proyecto). Claude te guiará fase por fase para construir el sistema completo desde cero.

**Instrucciones de uso:**
1. Instala todas las herramientas de la sección 2 (Requisitos)
2. Crea un directorio vacío para tu proyecto: `mkdir mi-isp-manager && cd mi-isp-manager`
3. Abre Claude Code: `claude`
4. Copia y pega el MEGA PROMPT completo
5. Cuando Claude termine de leerlo, te preguntará por qué fase empezar

---

```
Eres mi asistente de desarrollo. Vamos a construir juntos un sistema completo 
de gestión para un ISP (Proveedor de Internet) llamado [NOMBRE_DE_TU_EMPRESA].

=== DESCRIPCIÓN DEL PROYECTO ===

El sistema tiene dos partes:

1. APLICACIÓN WEB (ISP Manager) — para administrar el ISP desde el navegador
2. APLICACIÓN ANDROID (App de campo) — para el técnico en terreno

Puedes referirte al proyecto web como "[nombre-web]" y al Android como 
"[nombre-app]". Si no tienes preferencia, usa "isp-manager" y "isp-app".

=== STACK TECNOLÓGICO — PROYECTO WEB ===

- Vue 3 con Composition API (script setup)
- TypeScript estricto
- Vite 8 como build tool
- Tailwind CSS 4 para estilos
- Hono (Node.js) como servidor backend
- Supabase como base de datos PostgreSQL + Auth + Storage
- Pinia para estado global
- Vue Router 4 para navegación
- Leaflet para mapas
- ssh2 para conexiones SSH desde Node.js (control de OLT)
- xadesjs + node-forge para firma electrónica SRI Ecuador
- PM2 para gestión de procesos en producción
- Cloudflare Tunnel para URL pública con HTTPS

=== STACK TECNOLÓGICO — PROYECTO ANDROID ===

- Vue 3 con Composition API
- TypeScript
- Capacitor 8 para empaquetar como app Android nativa
- Tailwind CSS 4
- Supabase JS (misma base de datos que el proyecto web)
- GitHub Actions para build automático del APK

=== ARQUITECTURA GENERAL ===

El frontend Vue se comunica con:
a) El backend Hono (Node.js) en puerto 3000 para operaciones que 
   requieren SSH (OLT) o credenciales privadas (MikroTik, SRI)
b) Supabase directamente (con JWT y RLS) para CRUD de datos

El backend Hono:
- En desarrollo: el proxy de Vite redirige /api/* al puerto 3001
- En producción: Hono sirve el build estático de Vue + responde /api/*
  en el mismo puerto 3000

PM2 gestiona tres procesos:
- [nombre-web]: Hono en puerto 3000
- [nombre-web]-tunnel: cloudflared apuntando a puerto 3000
- [nombre-web]-monitor: script de monitoreo de dispositivos

=== MÓDULOS DEL SISTEMA WEB ===

Construiremos los siguientes módulos en este orden:

FASE 1 — Fundación
- Crear proyecto Vue 3 + TypeScript + Vite + Tailwind CSS 4
- Configurar Supabase (crear proyecto, obtener URL y anon key)
- Login con Supabase Auth (email + contraseña)
- Layout principal con sidebar de navegación
- Dashboard con tarjetas de métricas vacías
- Criterio: puedo hacer login y ver el dashboard

FASE 2 — Backend Hono y base de datos
- Crear servidor Hono en server/src/index.ts
- Configurar proxy en vite.config.ts para /api/* → puerto 3001
- Primeras tablas SQL: clientes, planes, zonas, service_contracts, profiles
- RLS básico en todas las tablas
- Migrations en supabase/migrations/
- Criterio: el servidor Hono responde en /api/health

FASE 3 — Gestión de clientes y contratos
- CRUD completo de clientes (nombre, cédula, teléfono, email, dirección, zona)
- Contratos con numeración automática (CTR-YYYY-NNNNN via RPC Supabase)
- Vista lista de contratos
- Vista Kanban de contratos por estado (activo, suspendido, cancelado)
- Detalle de cliente con sus contratos e historial
- Criterio: puedo crear clientes, asignarles contratos y ver el Kanban

FASE 4 — OLT Huawei MA5800
- Tabla olt_devices en Supabase con campos: host, brand='huawei', 
  username, password, extra_params (JSON)
- Endpoint POST /api/olt-ssh en Hono
- Librería ssh2 para abrir sesión SSH a la OLT
- Comandos implementados:
  * Listar ONTs: display ont info 0 all (dentro de interface gpon slot)
  * Registrar ONT: ont add port id sn-auth SERIAL omci ont-lineprofile-id LP ont-srvprofile-id SP desc DESC
  * Crear service-port: service-port ID vlan VLAN gpon F/S/P ont ID gemport 1 multi-service...
  * Señal óptica: display ont optical-info port id
  * WAN info: display ont wan-info port id
  * Activar ONT: ont activate port id
  * Desactivar ONT: ont deactivate port id
  * Eliminar ONT: undo service-port + ont delete (con confirmación y automática)
  * Reboot OLT: save configuration + espera 45s + reboot system
- Pantalla de dispositivos OLT con CRUD
- Pantalla de ONUs registradas con: serial, estado, señal Rx, IP MikroTik (cruce MAC)
- Modal de registro de ONT nueva con auto-detección de ID libre
- Modal de detalle ONT con señal, hardware, puertos ETH, WAN MAC
- Tabla olt_onts en Supabase para persistir las ONTs
- Criterio: puedo conectar a la OLT, ver las ONTs y registrar una nueva

FASE 5 — OLT V-SOL
- Soporte para brand='vsol' en el mismo endpoint /api/olt-ssh
- CLI V-SOL usa estilo Zebra/Quagga: gpon-olt> → enable (contraseña) → configure terminal
- TODOS los comandos show onu van dentro de "interface gpon 0/puerto"
- Puertos GPON empiezan en 1 (no en 0 como Huawei)
- Comandos:
  * Listar: show onu state + show onu info
  * Registrar: onu add ID profile default sn SERIAL + configurar tcont, gemport, service, service-port, portvlan
  * Señal: show onu optical-info ID (campos: "Rx optical level" y "Tx optical level")
  * Auto-find: show onu auto-find
  * Activar/desactivar: onu ID activate / onu ID deactivate
  * Guardar: write (en modo enable, fuera de configure terminal)
- Configuración extra: enable_pass (contraseña del modo enable), pon_ports (número de puertos)
- Criterio: la pantalla OLT funciona con ambas marcas sin cambiar de vista

FASE 6 — MikroTik REST API
- Tabla mikrotik_devices: host, username, password, port (443)
- Conexión via fetch/axios a https://host/rest/ con Basic Auth
- Deshabilitar verificación TLS (ISPs usan certificados autofirmados)
- Endpoints implementados:
  * GET /interface → listar interfaces
  * GET /ppp/secret → usuarios PPPoE (nombre, contraseña, perfil, disabled)
  * GET /ppp/active → conexiones PPPoE activas
  * GET /ip/dhcp-server/lease → leases DHCP (MAC → IP)
  * GET /ip/address → IPs configuradas
  * GET /resource → CPU%, RAM%, versión RouterOS, uptime
  * PUT /ppp/secret/{id} {disabled:false/true} → habilitar/deshabilitar usuario
- Integración en lista de ONUs: cruzar MAC WAN de la ONT con leases DHCP → columna IP MikroTik
- Pantalla de dispositivos MikroTik con CRUD
- Criterio: veo los usuarios PPPoE y la IP de cada ONT en la lista

FASE 7 — TR-069 / GenieACS
- Integración con GenieACS ACS (instalado localmente en el servidor)
- Tabla tr069_devices en Supabase
- Endpoints en Hono para comunicarse con la API REST de GenieACS:
  * Listar CPEs
  * Ver parámetros de un CPE
  * Ejecutar reboot remoto
  * Modificar parámetros (SSID, contraseña WiFi, banda)
- Pantalla de dispositivos TR-069 con lista y detalle
- Criterio: veo los CPEs registrados en GenieACS desde la app

FASE 8 — Facturación electrónica SRI Ecuador
- Solo aplicable si tu país es Ecuador. Si no, salta esta fase.
- Tabla electronic_documents: xml_content, clave_acceso, estado, numero_autorizacion
- Tabla sri_config: datos del emisor, archivo .p12 (almacenado en Supabase Storage), SMTP
- Tabla sri_sequences: secuenciales por tipo de comprobante
- Flujo completo:
  1. Generar XML factura según esquema SRI v2.1.0
  2. Firmar con XAdES-BES usando xadesjs + node-forge
     IMPORTANTE: el id del ds:Reference debe ser DISTINTO al id="comprobante"
     IMPORTANTE: usar digestAlgorithm SHA-1 (no SHA-256)
     IMPORTANTE: certificado en x509[] solo hoja, sin cadena CA
     IMPORTANTE: setNodeDependencies en xadesjs y xmldsigjs
  3. Enviar al SRI (SOAP)
  4. Consultar autorización con polling
  5. Generar RIDE en PDF
  6. Enviar correo al cliente con RIDE PDF + XML adjuntos via SMTP
- Clave de acceso 49 dígitos: DDMMAAAA + 01 + RUC(13) + AMBIENTE + SERIE(6) + SECUENCIAL(9) + NUMERICO + DV(módulo11)
- Pantalla de facturación con listado, emisión manual y reenvío
- Criterio: puedo emitir una factura en ambiente de pruebas y queda AUTORIZADA en el SRI

FASE 9 — Cobros y Caja
- Pantalla de cobros mensual con navegación por flechas mes anterior/siguiente
- 4 tarjetas: Total facturado, Cobrado, Pendiente, % recaudo con barra de progreso
- Filtros: Todos / Pendientes / Cobrados + búsqueda por nombre
- Badge "Suspendido" en contratos suspendidos
- Modal de registro de pago: método (Efectivo/Transferencia/Depósito/Tarjeta/Cheque), fecha, notas
- Si el contrato está suspendido: opción "Habilitar servicio al registrar el pago"
  Al activar esa opción: 
  * UPDATE service_contracts SET status='active'
  * PUT /ppp/secret/{id} {disabled:false} en MikroTik
  * ont activate en la OLT
- Campos en electronic_documents: paid_at, payment_method, payment_notes
- Módulo Caja: movimientos de entrada/salida con saldo acumulado
- Criterio: registro un pago, el contrato se reactiva automáticamente en MikroTik y OLT

FASE 10 — Instalaciones y Mapa
- Tabla instalacion_orders: cliente, dirección, fecha, técnico asignado, estado, fotos, coordenadas GPS
- Pantalla de instalaciones pendientes con lista y filtros por estado/técnico
- Mapa Leaflet con marcadores de instalaciones pendientes
- Al crear instalación: prefill de la dirección del cliente
- Orden de trabajo imprimible (window.open hacia una vista /instalaciones/:id/imprimir)
- Galería de fotos (upload a Supabase Storage)
- Criterio: creo una orden de instalación, la veo en el mapa y puedo imprimirla

FASE 11 — Inventario
- Tabla productos: nombre, categoría, unidad, stock actual, stock mínimo, precio
- Tabla movimientos_inventario: producto, tipo (ingreso/egreso), cantidad, motivo, fecha, usuario
- Pantalla de productos con CRUD
- Pantalla de ingreso de stock (compras, devoluciones)
- Pantalla de egreso de stock (instalaciones, reparaciones)
- Kardex: historial de movimientos por producto con saldo acumulado
- Resumen: existencias actuales, alertas de stock bajo
- Criterio: registro un ingreso y un egreso y el Kardex los muestra correctamente

FASE 12 — Soporte técnico y Portal del cliente
- Tabla support_tickets: cliente, asunto, descripción, prioridad, estado, técnico asignado
- Tabla support_ticket_updates: mensaje, archivos adjuntos, fecha, usuario
- Pantalla de tickets con filtros por estado/prioridad/técnico
- Detalle del ticket con hilo de conversación
- Portal del cliente (login separado): el cliente puede ver sus tickets y facturas
- Criterio: el cliente puede abrir un ticket desde el portal y el técnico responde

FASE 13 — Reportes y estadísticas
- Planes más usados: tabla + barra horizontal + % sobre total
- Cuentas por cobrar: facturas sin pagar agrupadas por antigüedad (0-15, 16-30, 31-60, +60 días)
- Desconexiones: contratos suspendidos con ingreso en riesgo
- Facturas y cobros por mes: barras CSS azul (facturado) / verde encima (cobrado), selector 3/6/12/24 meses
- Estadísticas OLT: ONTs activas/suspendidas por dispositivo y por tarjeta
- Estadísticas MikroTik: CPU%, RAM%, conexiones activas en tiempo real (paralelo por router)
- Criterio: el dashboard de reportes muestra datos reales de la base de datos

FASE 14 — Facturación recurrente y WhatsApp
- Script de facturación masiva: genera facturas para todos los contratos activos del mes
- Programable via cron o ejecutable manualmente desde la pantalla
- Integración WhatsApp Business API (Meta): envío de mensajes de cobro, alertas de desconexión
- Configuración de plantillas de mensaje en Configuración > WhatsApp
- Criterio: ejecuto la facturación recurrente y se generan facturas para todos los clientes activos

FASE 15 — Producción con PM2 y Cloudflare
- npm run build → genera dist/ con el frontend Vue
- Configurar Hono para servir dist/ en GET /* (rutas no-API)
- Crear start-server.cjs para iniciar Hono en producción
- Crear ecosystem.config.cjs con tres procesos: app, tunnel, monitor
- Instalar cloudflared (binario de Cloudflare)
- Configurar PM2: pm2 start ecosystem.config.cjs
- Obtener URL pública del tunnel Cloudflare
- Configurar VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY como variables de entorno de PM2
- Criterio: el sistema está corriendo en producción accesible desde internet con HTTPS

=== MÓDULOS DE LA APP ANDROID (fsMk) ===

FASE A — Fundación Capacitor
- Crear proyecto Vue 3 + TypeScript + Vite + Tailwind CSS 4
- Instalar Capacitor 8 y la plataforma Android
- Configurar AndroidManifest y build.gradle
- Build APK debug: npx cap build android
- Configurar GitHub Actions para build automático en push a main
- Criterio: el APK instala en un teléfono Android físico

FASE B — Autenticación y navegación
- Login con Supabase (mismas credenciales que la app web)
- Bottom navigation bar con las secciones principales
- Pantallas principales vacías (esqueleto)
- Criterio: inicio sesión desde el teléfono y veo el menú inferior

FASE C — Módulo OLT móvil
- Lista de ONUs con señal óptica, estado online/offline
- Acciones rápidas: activar, desactivar, reboot, ping
- Ping desde el servidor backend a la IP de la ONU
- Criterio: veo las ONUs y puedo activar/desactivar una

FASE D — MikroTik móvil
- Lista de conexiones PPPoE activas
- Recursos del sistema (CPU, RAM) por router
- Criterio: veo las conexiones activas de cada router

FASE E — TR-069 móvil
- Lista de CPEs registrados en GenieACS
- Detalle con parámetros principales
- Reboot remoto
- Criterio: veo los CPEs y hago reboot desde el teléfono

FASE F — Instalaciones móvil
- Lista de instalaciones pendientes asignadas al técnico logueado
- Botón "Llegué" para registrar inicio
- Fotos desde la cámara del teléfono (Capacitor Camera)
- Criterio: el técnico puede actualizar el estado de una instalación desde el teléfono

FASE G — Infraestructura y Portal
- Mapa de nodos de infraestructura (splitters, NAPs, cajas)
- Acceso del técnico al portal de clientes
- Criterio: el técnico ve el mapa y puede acceder al portal

=== INSTRUCCIONES PARA CLAUDE ===

1. Trabaja fase por fase. Al terminar una, pregúntame si quiero continuar 
   con la siguiente o si necesito ajustes.

2. Usa siempre TypeScript estricto. No uses 'any' a menos que sea 
   estrictamente necesario y documenta por qué.

3. Para la base de datos, crea las migraciones SQL en 
   supabase/migrations/ con formato NNN_nombre.sql

4. Para los componentes Vue, usa <script setup> con Composition API. 
   Tailwind CSS 4 para todos los estilos.

5. Cuando necesites abrir una vista en ventana emergente (popup), 
   usa window.open() con una ruta dedicada. No uses <dialog> ni Teleport 
   para ventanas popup — son inestables en producción.

6. Si hay algún error de compilación o de runtime, descríbelo con 
   el stack trace completo y espera mi confirmación antes de cambiar 
   más de un archivo a la vez.

7. Al final de cada fase, dame el criterio de verificación y cómo 
   comprobarlo manualmente en el navegador.

8. Todos los textos de la interfaz en español.

=== PERSONALIZACIÓN ===

Nombre del proyecto web: [ESCRIBE AQUÍ EL NOMBRE, ej: "netplus-manager"]
Nombre del proyecto Android: [ESCRIBE AQUÍ EL NOMBRE, ej: "netplus-app"]
Nombre de la empresa ISP: [ESCRIBE AQUÍ, ej: "NetPlus Fibra"]
País: [ESCRIBE AQUÍ — importante para Fase 8 de facturación]

Si tu país NO es Ecuador, omite la Fase 8 (Facturación SRI) y dime 
los requisitos de facturación de tu país si los necesitas.

Si no tienes OLT Huawei o V-SOL, indícame la marca de tu OLT y agrego 
soporte. El patrón SSH ya está creado, solo cambian los comandos específicos.

=== ¿POR DÓNDE EMPEZAMOS? ===

Antes de comenzar, dime:
1. ¿Tienes Node.js v22+ instalado? (ejecuta: node --version)
2. ¿Tienes una cuenta de Supabase creada y un proyecto nuevo vacío?
3. ¿Tienes una cuenta de Anthropic con créditos en la API?
4. ¿Cuál es el nombre de tu proyecto y empresa?
5. ¿Qué fase quieres construir primero? (recomiendo empezar por FASE 1)

Cuando me respondas esas preguntas, comienzo a escribir el código 
de la primera fase completa.
```

---

**Fin del MEGA PROMPT**

---

### Notas finales para el alumno

- El MEGA PROMPT es una guía de contexto completa. Claude lo usará durante toda la sesión para entender el proyecto y guiarte correctamente.
- Puedes pausar y retomar en cualquier momento. Claude no tiene memoria entre sesiones, así que siempre pega el MEGA PROMPT al inicio de una sesión nueva, o guarda el contexto en un archivo `CLAUDE.md` dentro de tu proyecto.
- El tiempo total estimado para completar ambos proyectos es de **86-110 horas** de trabajo, distribuidas en varias sesiones. No es necesario terminarlo en un solo día.
- Cada fase produce un sistema funcional y verificable. El aprendizaje real está en entender qué hace Claude y por qué toma cada decisión técnica.
