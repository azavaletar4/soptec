# SmartRayco

Sistema integral de gestión y administración para ISP, con capacidades equivalentes a
**SmartOLT** (gestión de OLT/ONU), **AdminOLT** (provisioning) y **MikroWisp**
(clientes, facturación, soporte) — construido siguiendo el plan del curso "ISP Manager
Fosmikro" (ver `curso/`), adaptado a este proyecto.

## Estado del proyecto

Fase actual: **Fase 6d-6g — TR-069 / GenieACS** (migraciones aplicadas; backend, panel y stack
Docker validados de punta a punta contra un CPE simulado — `docker compose --profile testing up -d`,
ver `docker-compose.yml` — sync a `tr069_devices` confirmado. Ojo: la imagen Docker de GenieACS
que asumia originalmente `REPLICA-TR069-GENIEACS.md` (`genieacs/genieacs:1.2`) no existe en
Docker Hub — se corrigio a `drumsergio/genieacs:1.2.16.0`, ver nota al inicio de ese doc).
**Probado contra la OLT ZTE C300 real (10.15.15.2) el 2026-09-11**: el registro de ONT y el
comando `setTr069AcsCommands` (asignar ACS a una ONU real) corren sin error contra el equipo
real — de paso se encontro y corrigio un bug real de firewall (Windows bloqueaba el puerto 7547
entrante, la ONT no podia alcanzar el ACS). Lo que **no** se pudo confirmar de punta a punta es
que una ONT fisica reporte efectivamente a GenieACS: se probo con la unica ONU "sin configurar"
de marca ZTE disponible (serial `ZTEGDD19A29C`, tipo asumido `ZTE-F660`, ID 25 en el puerto
1/2/2 — verificado libre antes de usarlo), incluyendo un reinicio fisico, sin que llegara ningun
Inform a GenieACS ni siquiera un intento fallido — probablemente el equipo fisico no es
realmente un ZTE-F660/VEIP-capaz. Falta repetir la prueba con un CPE cuyo modelo TR-069/VEIP
este confirmado (no asumido por marca). **Sync/metricas automaticos**: agregado
`server/src/services/tr069Scheduler.ts` — corre `syncTr069Devices()` y `collectAllTr069Metrics()`
solos cada 15/10 min (configurable, `TR069_SCHEDULER_ENABLED=false` para apagarlo), sin depender
del boton manual del panel; probado en vivo el 2026-09-11. **Importante:** durante la primera prueba se asumio
erroneamente que un ID de la lista de "ONUs sin configurar" estaba libre y no lo estaba —
pertenecia a una clienta real; se revirtio sin causar corte de servicio. Ver leccion aprendida:
nunca asumir un onu-id libre en esta OLT sin verificarlo antes con `show gpon onu detail-info`.
La Fase 11 (Inventario) también tiene su migración aplicada. La
Fase 9 (Instalaciones y Mapa) ya quedó aplicada y funcionando. La numeración de fases se reordenó
en el camino: Soporte (6a-c) y TR-069 (6d-g) comparten el número 6; se priorizó Soporte,
Facturación básica (Fase 7), Instalaciones/Mapa (Fase 9) e Inventario (Fase 11) antes de completar
TR-069; Facturación SRI y
Cobros/Caja siguen pendientes.

> Notas de rumbo: (1) el proyecto arrancó con una arquitectura genérica (NestJS + Next.js) antes
> de descubrir el material detallado en `curso/`, específico para esta infraestructura, y se
> adoptó ese plan (`docs/phases/fase-1-fundacion.html`). (2) La OLT real es **ZTE C300**, no
> Huawei/V-SOL como asumía el curso, y solo tiene **Telnet** habilitado, no SSH — la Fase 5
> original del curso (V-SOL) se omite por no aplicar (`docs/phases/fase-4-olt.html`).

## Stack

- **Frontend:** Vue 3 (Composition API) + TypeScript + Vite + Tailwind CSS 4 + Pinia + Vue Router
- **Backend:** Hono (Node.js) en `server/` — auth vía JWKS (Supabase), rutas privadas para OLT
- **Base de datos:** Supabase (PostgreSQL + Auth + Storage + RLS)
- **Red:** OLT ZTE C300 vía Telnet (`server/src/telnet/`); MikroTik REST API desde la Fase 5
- **App móvil de campo:** Capacitor 8 + Android (fases A-G, más adelante)
- **Producción:** PM2 + Cloudflare Tunnel

## Estructura del repositorio

```
SmartRayco/
├── src/                    # Frontend Vue 3
│   ├── views/              # LoginView, DashboardView...
│   ├── components/layout/  # AppLayout (sidebar)
│   ├── stores/             # Pinia (auth.ts)
│   ├── router/             # Vue Router + guard de autenticacion
│   └── lib/supabase.ts     # Cliente Supabase
├── server/                 # Backend Hono (desde Fase 2)
├── supabase/                # Migraciones SQL (desde Fase 2)
├── curso/                   # Material de referencia (MEGA PROMPT, glosario, fases)
└── docs/
    ├── phases/              # Reportes HTML de avance por fase
    └── architecture/        # Guias tecnicas (supabase-setup.md, etc.)
```

## Arranque local

```bash
cp .env.example .env   # completar con tus credenciales de Supabase (ver docs/architecture/supabase-setup.md)
npm install
npm run dev             # http://localhost:5173
```

## Plan de fases (proyecto web)

Numeración propia de SmartRayco (la Fase 5 original del curso, OLT V-SOL, se omite por no
aplicar — ver nota de rumbo arriba). Detalle de cada fase en `docs/phases/`.

| # | Fase | Estado |
|---|------|--------|
| 1 | Fundación (Vue+Vite+Tailwind, login Supabase, layout, dashboard vacío) | ✅ |
| 2 | Backend Hono + esquema inicial (profiles, zones, plans, clients, service_contracts + RLS) | ✅ |
| 3 | Clientes y contratos (CRUD, numeración automática, Kanban) | ✅ |
| 4 | OLT ZTE C300 (Telnet: CRUD, registrar/activar/eliminar/señal, salud del chasis, importación masiva de ONTs existentes con nombre/plan/VLAN/señal, detalle de ONT estilo SmartOLT) | ✅ validado contra el equipo real (10.15.15.2) — 676 ONTs reales importadas 2026-09-11 |
| 5 | MikroTik REST API (CRUD, PPPoE, DHCP leases) | ✅ validado contra router real |
| 6 | Soporte técnico (tickets, con sub-fases 6b puntaje y 6c permisos) | ✅ |
| 7 | Facturación básica (facturas, pagos, cobros; sin comprobantes SRI) | ✅ |
| 9 | Instalaciones (agenda por contrato) y Mapa (Leaflet, clientes + instalaciones) | ✅ |
| 11 | Inventario (productos, ingreso/egreso, Kardex con saldo acumulado) | ✅ |
| 6d-g | TR-069 / GenieACS (proxy NBI, sync/métricas automáticos, asignar ACS por ONT, panel) | ✅ validado contra CPE simulado y comandos probados contra OLT real — falta confirmar Inform de una ONT física TR-069/VEIP real |
| — | Facturación electrónica SRI Ecuador | Pendiente (confirmar país) |
| — | Cobros y Caja (arqueo/cierre) | Pendiente |
| 12 | Reportes y estadísticas (clientes, financiero, soporte — sin doc de curso, diseñado a medida) | ✅ código — sin migración pendiente (reusa tablas existentes) |
| 13 | Facturación recurrente + WhatsApp | Pendiente |
| 14 | Producción (PM2 + Cloudflare Tunnel) | En progreso — servir dist/ desde el backend probado (`ecosystem.production.config.cjs`); falta el login de Cloudflare del usuario y crear/enrutar el tunel |

App móvil (fsMk, Capacitor/Android): fases A-G, después de cerrar el proyecto web.

Cada fase se documenta con un reporte HTML en `docs/phases/`, se abre en el navegador, y requiere
tu aprobación explícita antes de avanzar a la siguiente.
