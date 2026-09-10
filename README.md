# SmartRayco

Sistema integral de gestión y administración para ISP, con capacidades equivalentes a
**SmartOLT** (gestión de OLT/ONU), **AdminOLT** (provisioning) y **MikroWisp**
(clientes, facturación, soporte) — construido siguiendo el plan del curso "ISP Manager
Fosmikro" (ver `curso/`), adaptado a este proyecto.

## Estado del proyecto

Fase actual: **Fase 1 — Fundación** (Vue 3 + Vite + Tailwind CSS 4 + Supabase Auth).

> Nota de rumbo: el proyecto arrancó con una arquitectura genérica (NestJS + Next.js) antes de
> descubrir el material detallado en `curso/`, específico para esta infraestructura (OLT
> Huawei/V-SOL, MikroTik REST, TR-069, facturación SRI Ecuador). Se decidió adoptar ese plan.
> Detalle completo en `docs/phases/fase-1-fundacion.html`.

## Stack

- **Frontend:** Vue 3 (Composition API) + TypeScript + Vite + Tailwind CSS 4 + Pinia + Vue Router
- **Backend:** Hono (Node.js) — se agrega en la Fase 2, en `server/`
- **Base de datos:** Supabase (PostgreSQL + Auth + Storage + RLS)
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

Ver el detalle completo en `curso/00-indice-general.md`. Resumen:

| # | Fase | Estado |
|---|------|--------|
| 1 | Fundación (Vue+Vite+Tailwind, login Supabase, layout, dashboard vacío) | ✅ En este commit |
| 2 | Backend Hono + primeras tablas (clientes, planes, zonas) | Pendiente |
| 3 | Clientes y contratos | Pendiente |
| 4 | OLT Huawei MA5800 (SSH) | Pendiente |
| 5 | OLT V-SOL | Pendiente |
| 6 | MikroTik REST API | Pendiente |
| 7 | TR-069 / GenieACS | Pendiente |
| 8 | Facturación electrónica SRI Ecuador | Pendiente (confirmar país) |
| 9 | Cobros y Caja | Pendiente |
| 10 | Instalaciones y Mapa | Pendiente |
| 11 | Inventario | Pendiente |
| 12 | Soporte técnico y portal del cliente | Pendiente |
| 13 | Reportes y estadísticas | Pendiente |
| 14 | Facturación recurrente + WhatsApp | Pendiente |
| 15 | Producción (PM2 + Cloudflare Tunnel) | Pendiente |

App móvil (fsMk, Capacitor/Android): fases A-G, después de cerrar el proyecto web.

Cada fase se documenta con un reporte HTML en `docs/phases/`, se abre en el navegador, y requiere
tu aprobación explícita antes de avanzar a la siguiente.
