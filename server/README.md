# server/

Backend Hono (Node.js + TypeScript) de SmartRayco.

- `src/index.ts` — arranque del servidor, monta las rutas bajo `/api/*`.
- `src/routes/` — una ruta Hono por dominio (`health.ts`, y desde Fase 3 `clients.ts`, etc.).
- `src/lib/supabaseAdmin.ts` — cliente Supabase con `service_role` key (se salta RLS), solo backend.

## Arranque

```bash
npm run dev:api      # solo el backend, con recarga (tsx watch)
npm run dev          # backend + frontend en paralelo (concurrently)
```

## Endpoints

- `GET /api/health` — healthcheck, sin autenticación.

En producción, Hono también sirve el build estático de `dist/` (se configura en la Fase 15).
