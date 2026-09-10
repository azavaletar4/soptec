# Configuración de Supabase para SmartRayco

## Fase 1 — Autenticación (ya cubierto)

1. Crea un proyecto en https://app.supabase.com.
2. En **Project Settings → API**, copia `Project URL` → `VITE_SUPABASE_URL` y `anon public` key
   → `VITE_SUPABASE_ANON_KEY` en tu `.env` (raíz del repo, `cp .env.example .env`).
3. `npm install && npm run dev` → login en `http://localhost:5173/login`.

## Fase 2 — Esquema de base de datos (tablas + RLS)

La migración vive en `supabase/migrations/20260910120000_fase2_esquema_inicial.sql` y crea:
`profiles`, `zones`, `plans`, `clients`, `service_contracts`, con RLS por rol
(`SUPERADMIN`, `ADMIN`, `TECNICO_RED`, `SOPORTE`, `FACTURACION`, `CLIENTE`) y un trigger que crea
automáticamente el `profile` de cada usuario que se registra.

### Opción A — rápida, sin CLI (recomendada para probar ya)

1. Abre tu proyecto en https://app.supabase.com → **SQL Editor**.
2. Pega el contenido completo de
   `supabase/migrations/20260910120000_fase2_esquema_inicial.sql` y ejecútalo.
3. Verifica en **Table Editor** que aparecen `profiles`, `zones`, `plans`, `clients`,
   `service_contracts`.

### Opción B — con Supabase CLI (recomendada a partir de aquí, para futuras migraciones)

```bash
npm install -g supabase
supabase login
supabase link --project-ref TU_PROJECT_REF
supabase db push
```

`supabase db push` aplica todas las migraciones nuevas de `supabase/migrations/` en orden.

### Completar variables del backend

Para que el backend Hono arranque con acceso admin a Supabase, completa en `.env`:

| Valor (Project Settings → API) | Variable |
|---|---|
| `service_role` key | `SUPABASE_SERVICE_ROLE_KEY` |
| `JWT Secret` (API → JWT Settings) | `JWT_SECRET` |

### Crear tu primer usuario SUPERADMIN

1. El trigger crea automáticamente un `profile` con rol `CLIENTE` para cualquier usuario nuevo.
2. Crea tu usuario: **Authentication → Users → Add user** (o regístrate desde `/login` si activas
   signup público).
3. Promuévelo a `SUPERADMIN` en el **SQL Editor**:

```sql
update public.profiles set role = 'SUPERADMIN' where email = 'tu-correo@dominio.com';
```

### Backend (Hono)

```bash
npm run dev:api     # solo backend (puerto segun PORT en .env)
npm run dev         # backend + frontend en paralelo
```

## Fase 4 — OLT (ZTE C300)

A partir de esta fase el backend valida el JWT de cada usuario antes de ejecutar comandos SSH,
y usa la `service_role` key para leer/escribir `olt_devices`/`olt_onts` (tablas sin acceso directo
desde el frontend). Completa en tu `.env`:

| Valor (Project Settings → API) | Variable |
|---|---|
| `service_role` key | `SUPABASE_SERVICE_ROLE_KEY` |
| `JWT Secret` (API → JWT Settings) | `JWT_SECRET` |

Sin estas dos variables, `/api/olt-devices/*` responde 500 (con un mensaje claro) — el resto de
la app (login, clientes, contratos) sigue funcionando igual, no depende de ellas.

Luego aplica la migración `supabase/migrations/20260910140000_fase4_olt.sql` (SQL Editor o
`supabase db push`), y registra tu primera OLT desde `/olt` en la app.

⚠️ Los comandos SSH implementados para la ZTE C300 son un punto de partida basado en
convenciones generales de su CLI — no están validados contra tu equipo real. Antes de usarlos en
producción, revisa `server/src/ssh/zteCommands.ts` y `docs/phases/fase-4-olt.html`.
