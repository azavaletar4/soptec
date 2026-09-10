# Configuración de Supabase para SmartRayco

Pasos para dejar operativa la autenticación (Fase 1). Las tablas de negocio (clientes, planes,
OLTs, etc.) se agregan en la Fase 2 vía `supabase/migrations/`.

## 1. Crear el proyecto

1. Crea una cuenta / proyecto en https://app.supabase.com (región recomendada: la más cercana,
   ej. South America).
2. Guarda la contraseña del usuario `postgres` que pide al crear el proyecto.

## 2. Copiar credenciales

En **Project Settings → API**:

| Valor | Variable de entorno (`.env` en la raíz) |
|---|---|
| `Project URL` | `VITE_SUPABASE_URL` |
| `anon public` key | `VITE_SUPABASE_ANON_KEY` |
| `service_role` key | `SUPABASE_SERVICE_ROLE_KEY` (solo se usa desde Fase 2, backend) |

En **Project Settings → API → JWT Settings**:

| Valor | Variable de entorno |
|---|---|
| `JWT Secret` | `JWT_SECRET` (se usa desde Fase 2, para validar tokens en Hono) |

## 3. Preparar el `.env`

```bash
cp .env.example .env
```

Completa `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (los únicos necesarios para la Fase 1).

## 4. Instalar dependencias y arrancar

```bash
npm install
npm run dev
```

Abre `http://localhost:5173`. Deberías ver la pantalla de login.

## 5. Crear tu primer usuario

Por defecto Supabase permite auto-registro. La forma más simple para la Fase 1:

1. En el dashboard de Supabase: **Authentication → Users → Add user → Create new user**.
2. Ingresa tu correo y una contraseña.
3. Inicia sesión con esas credenciales en `http://localhost:5173/login`.

(El flujo de registro propio, roles y perfiles se añaden en la Fase 2 en adelante.)

## 6. Supabase CLI (opcional en esta fase, necesaria desde la Fase 2)

```bash
npm install -g supabase
supabase login
supabase link --project-ref TU_PROJECT_REF
supabase init      # crea supabase/config.toml
```

Las migraciones (`supabase/migrations/*.sql`) y `supabase db push` se usan a partir de la Fase 2,
cuando se creen las primeras tablas de negocio.
