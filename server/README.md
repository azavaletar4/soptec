# server/

Backend Hono (Node.js) de SmartRayco. Se implementa en la **Fase 2** (Backend Hono y base de
datos): servidor en `server/src/index.ts`, proxy `/api/*` desde Vite en desarrollo, y las
primeras tablas SQL en `supabase/migrations/`.

En la Fase 1, la autenticación se hace directamente contra Supabase Auth desde el frontend
(`@supabase/supabase-js`), sin pasar por este servidor.
