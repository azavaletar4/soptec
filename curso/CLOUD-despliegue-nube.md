# CLOUD — Subir el sistema a la nube (Supabase + Cloudflare + Dominio)

---

## C.1 Arquitectura de producción

```
                        ┌─────────────────────────────────────┐
                        │         CLOUDFLARE CLOUD            │
  Usuario / Browser     │   CDN + DDoS Protection + Tunnel    │
       ──────────►      │   app.midominio.com (DNS → Tunnel)  │
                        └──────────────┬──────────────────────┘
                                       │  cloudflared (TLS cifrado)
                        ┌──────────────▼──────────────────────┐
                        │       SERVIDOR LOCAL / VPS          │
                        │  PM2 → Hono (puerto 3000)           │
                        │    ├─ API REST /api/*               │
                        │    └─ Frontend estático dist/       │
                        └──────────────┬──────────────────────┘
                                       │  HTTPS / SDK
                        ┌──────────────▼──────────────────────┐
                        │         SUPABASE CLOUD              │
                        │  PostgreSQL + Auth + Storage + RLS  │
                        └─────────────────────────────────────┘
```

**Flujo:** El usuario accede a tu dominio → Cloudflare enruta al tunnel → PM2/Hono atiende la petición → consulta Supabase para BD y autenticación.

---

## C.2 Supabase — Base de datos en la nube

### Crear el proyecto

1. Ir a https://supabase.com y crear una cuenta (gratis, no requiere tarjeta)
2. Clic en **New Project**
3. Llenar:
   - **Name:** `fosmikro-prod`
   - **Database Password:** contraseña fuerte (guardarla bien, no se puede recuperar)
   - **Region:** `us-east-1 (N. Virginia)` — mejor latencia desde Ecuador
4. Esperar ~2 minutos mientras Supabase aprovisiona la BD
5. Ir a **Settings → API** y copiar:
   - `Project URL` → va a `VITE_SUPABASE_URL`
   - `anon public` key → va a `VITE_SUPABASE_ANON_KEY`
   - `service_role` key → va a `SUPABASE_SERVICE_ROLE_KEY` (solo backend)

### Tabla de precios Supabase

| Plan   | Precio/mes | Base de datos | Storage   | Auth           | Backups         |
|--------|-----------|---------------|-----------|----------------|-----------------|
| Free   | $0        | 500 MB        | 1 GB      | 50 000 usuarios| Sin backup auto |
| Pro    | $25       | 8 GB          | 100 GB    | Ilimitados     | Diario (7 días) |
| Team   | $599      | Ilimitado     | Ilimitado | Ilimitados     | PITR 30 días    |

> Para un ISP de hasta 200 clientes, el plan **Free** es suficiente para empezar. Migrar a Pro cuando se supere 400 MB de BD o se necesiten backups automáticos.

### Ejecutar las migraciones SQL

El proyecto tiene 66 migraciones en `supabase/migrations/`. Dos opciones:

**Opción 1 — Supabase CLI (recomendado)**
```bash
# Instalar CLI (una sola vez)
npm install -g supabase

# Vincular al proyecto en la nube
supabase login
supabase link --project-ref <ref-del-proyecto>

# Ejecutar todas las migraciones en orden
supabase db push
```

**Opción 2 — SQL Editor en el panel web**
```
supabase.com → Tu proyecto → SQL Editor → New query
Pegar el contenido de cada archivo supabase/migrations/*.sql
Ejecutar en orden numérico (001, 002, 003...)
```

> El `--project-ref` se encuentra en Settings → General → Reference ID.

---

## C.3 Variables de entorno en producción

Crear el archivo `.env.production` en la raíz del proyecto (no subir a Git):

```env
# Supabase
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Solo para el backend Hono (NUNCA exponer al frontend)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Puerto del servidor
BACKEND_PORT=3000
NODE_ENV=production
```

> **Regla de oro:** La `service_role` key bypasea Row Level Security. Solo debe existir en el servidor Node.js, nunca en el bundle de Vue que llega al navegador.

---

## C.4 Cloudflare Tunnel

Cloudflare Tunnel crea un canal seguro desde tu servidor local hacia Cloudflare, **sin abrir puertos en el router ni necesitar IP pública fija**.

### Instalar cloudflared

```bash
# Windows (ya instalado en D:/fosmikro según ecosystem.config.cjs)
# Ruta: C:\Program Files (x86)\cloudflared\cloudflared.exe

# Linux/VPS
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
  -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
```

### Quick Tunnel (gratis, URL temporal)

```bash
cloudflared tunnel --url http://localhost:3000 --protocol http2
```

- URL del tipo: `https://random-words-123.trycloudflare.com`
- Cambia cada vez que se reinicia el proceso
- Útil para demos y pruebas — ya está configurado en `ecosystem.config.cjs`

### Named Tunnel (URL fija, requiere dominio)

```bash
# 1. Autenticarse en Cloudflare
cloudflared tunnel login

# 2. Crear el tunnel (una sola vez)
cloudflared tunnel create fosmikro-prod

# 3. Crear el archivo de configuración
# ~/.cloudflared/config.yml
tunnel: <TUNNEL_ID>
credentials-file: /root/.cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: app.midominio.com
    service: http://localhost:3000
  - service: http_status:404

# 4. Apuntar el DNS al tunnel
cloudflared tunnel route dns fosmikro-prod app.midominio.com

# 5. Ejecutar (o dejar que PM2 lo maneje)
cloudflared tunnel run fosmikro-prod
```

---

## C.5 Dominios — Precios y registradores

| TLD     | Precio/año | Registrador recomendado  | URL                               |
|---------|-----------|--------------------------|-----------------------------------|
| .com    | $10-13    | Cloudflare Registrar     | cloudflare.com/products/registrar |
| .net    | $12-15    | Cloudflare Registrar     | cloudflare.com/products/registrar |
| .io     | $30-40    | Namecheap                | namecheap.com                     |
| .com.ec | $30-50    | NIC Ecuador              | nic.ec                            |
| .app    | $14-18    | Google Domains / Squarespace | domains.google                |

> **Recomendación:** Comprar el dominio directamente en **Cloudflare Registrar** porque vende al precio de costo (sin markup), y al tener el dominio ahí el tunnel se configura con un clic desde el panel.

**Pasos para conectar dominio a Cloudflare Tunnel:**
1. Comprar dominio en Cloudflare Registrar (o transferir nameservers a Cloudflare)
2. Panel Cloudflare → Zero Trust → Networks → Tunnels → tu tunnel → Public Hostname
3. Agregar: `app.midominio.com` → `http://localhost:3000`
4. Cloudflare crea el registro DNS automáticamente

---

## C.6 PM2 en producción

PM2 es el gestor de procesos que mantiene el sistema corriendo 24/7 y lo reinicia automáticamente si falla.

### Instalación y primer arranque

```bash
# Instalar PM2 globalmente
npm install -g pm2

# Compilar el frontend Vue → dist/
npm run build-only

# Iniciar todos los procesos definidos en ecosystem.config.cjs
pm2 start ecosystem.config.cjs

# Guardar la lista de procesos
pm2 save

# Configurar auto-arranque al reiniciar el servidor
pm2 startup
# Ejecutar el comando que PM2 muestra en pantalla (requiere admin/sudo)
```

### Los 3 procesos del sistema (ecosystem.config.cjs)

| Proceso            | Script                   | Puerto | Descripción                                             |
|--------------------|--------------------------|--------|---------------------------------------------------------|
| `fosmikro`         | `start-server.cjs`       | 3000   | Servidor Hono: API REST + sirve el frontend compilado `dist/` |
| `fosmikro-tunnel`  | `cloudflared.exe`        | —      | Tunnel hacia Cloudflare. Expone el puerto 3000 a internet sin abrir router |
| `fosmikro-monitor` | `monitor-devices.cjs`    | —      | Monitoreo de ONUs/dispositivos en background, envía alertas |

**Configuración real del archivo `ecosystem.config.cjs`:**

```js
// fosmikro: servidor principal
{
  name: 'fosmikro',
  script: 'start-server.cjs',
  env: { NODE_ENV: 'production', BACKEND_PORT: '3000' },
  autorestart: true,
  restart_delay: 5000,    // espera 5s antes de reiniciar
  max_restarts: 15,       // máximo 15 reinicios seguidos
  kill_timeout: 10000,    // 10s para cierre limpio
}

// fosmikro-tunnel: cloudflared
{
  name: 'fosmikro-tunnel',
  script: 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
  args: 'tunnel --url http://127.0.0.1:3000 --protocol http2',
  interpreter: 'none',    // ejecutable nativo, no Node
  autorestart: true,
}

// fosmikro-monitor: monitoreo de dispositivos
{
  name: 'fosmikro-monitor',
  script: 'monitor-devices.cjs',
  autorestart: true,
  restart_delay: 10000,   // 10s entre reinicios (menos agresivo)
}
```

### Comandos PM2 esenciales

```bash
pm2 list                     # ver todos los procesos y su estado
pm2 restart fosmikro         # reiniciar solo el servidor
pm2 restart all              # reiniciar todos los procesos
pm2 stop fosmikro-tunnel     # detener tunnel temporalmente
pm2 delete fosmikro-monitor  # eliminar un proceso de PM2
pm2 logs fosmikro            # ver logs en tiempo real
pm2 logs fosmikro --lines 100  # últimas 100 líneas de log
pm2 monit                    # panel de métricas en tiempo real (CPU, RAM)
pm2 save                     # guardar estado actual (después de cambios)
```

---

## C.7 Backups

### Supabase (automático en plan Pro)
- Plan Free: sin backup automático — hacer backup manual desde el panel
- Plan Pro: backup diario automático, retención 7 días
- Panel: supabase.com → Project → Settings → Backups

### Backup manual de BD con pg_dump

```bash
# Desde terminal con las credenciales de Supabase
pg_dump "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" \
  --schema=public \
  --no-owner \
  --no-acl \
  -f backup_$(date +%Y%m%d).sql

# Automatizar con cron (Linux) — cada día a las 3am
0 3 * * * pg_dump "postgresql://..." -f /backups/fosmikro_$(date +\%Y\%m\%d).sql
```

### Backup del código fuente

```bash
# Subir cambios a GitHub (recomendado — historial completo)
git add -p                  # revisar cambios antes de agregar
git commit -m "feat: descripción del cambio"
git push origin master

# Repositorio privado en GitHub: gratis para equipos pequeños
```

### Qué respaldar

| Dato               | Método             | Frecuencia |
|--------------------|--------------------|------------|
| Base de datos      | pg_dump / Supabase | Diario     |
| Código fuente      | Git → GitHub       | Cada commit|
| Variables .env     | Gestor contraseñas | Al cambiar |
| Certificados tunnel| Carpeta .cloudflared| Al crear  |

---

## C.8 Monitoreo

### PM2 — métricas en tiempo real

```bash
# Panel visual con CPU, RAM, logs de todos los procesos
pm2 monit
```

```
┌─────────────────────┬──────────────────────────────────────────┐
│ fosmikro            │ CPU: 2%   RAM: 145 MB   Restarts: 0      │
│ fosmikro-tunnel     │ CPU: 0%   RAM: 28 MB    Restarts: 0      │
│ fosmikro-monitor    │ CPU: 1%   RAM: 67 MB    Restarts: 0      │
└─────────────────────┴──────────────────────────────────────────┘
```

### Logs del servidor

```bash
# Logs en tiempo real del servidor Hono
pm2 logs fosmikro

# Logs de todos los procesos
pm2 logs

# Últimas 200 líneas y seguir
pm2 logs fosmikro --lines 200

# Limpiar logs acumulados
pm2 flush fosmikro
```

### Monitoreo externo (opcional)

- **UptimeRobot** (https://uptimerobot.com) — gratis, alerta por email/WhatsApp si el sitio cae
- **Cloudflare Analytics** — tráfico, errores 5xx, latencia (incluido con Cloudflare gratis)

---

## C.9 Checklist de go-live

Verificar cada punto antes de dar acceso a los usuarios:

### Supabase
- [ ] Proyecto creado en supabase.com con región us-east-1
- [ ] Contraseña de BD guardada en gestor de contraseñas
- [ ] Todas las migraciones ejecutadas (`supabase db push` sin errores)
- [ ] RLS habilitado en todas las tablas con `tenant_id`
- [ ] `service_role` key solo en backend, nunca en frontend
- [ ] Variables `.env.production` configuradas y probadas
- [ ] Autenticación por email habilitada en Supabase Auth

### Cloudflare Tunnel
- [ ] `cloudflared` instalado y autenticado
- [ ] Tunnel creado y URL fija apuntando al dominio
- [ ] DNS propagado (verificar con `dig app.midominio.com` o dnschecker.org)
- [ ] HTTPS activo (Cloudflare lo provee automáticamente)
- [ ] Acceso desde celular externo (no en la red local) funciona

### Servidor / PM2
- [ ] `npm run build-only` ejecutado sin errores (genera `dist/`)
- [ ] `pm2 start ecosystem.config.cjs` — los 3 procesos en estado `online`
- [ ] `pm2 save` ejecutado
- [ ] `pm2 startup` configurado y probado (reiniciar servidor y verificar)
- [ ] Logs sin errores: `pm2 logs fosmikro --lines 50`

### Aplicación
- [ ] Login funciona con usuario real de Supabase
- [ ] Multi-tenant: un usuario no ve datos de otro tenant
- [ ] OLT/ONUs responden (o muestran error claro si no hay OLT configurada)
- [ ] Módulo de clientes carga correctamente
- [ ] Facturación / SRI: prueba de emisión de factura
- [ ] En móvil: interfaz responsive, sin elementos cortados

### Seguridad básica
- [ ] `.env` y `.env.production` en `.gitignore`
- [ ] Repositorio GitHub configurado como privado
- [ ] Supabase: ninguna tabla con RLS desactivado en producción
- [ ] Cloudflare: modo SSL/TLS en "Full (strict)"

---

## C.10 Prompt Claude para configurar el despliegue completo

Si en algún momento necesitas ayuda para configurar un paso específico del despliegue, usa este prompt como punto de partida en Claude:

```
Proyecto: ISP Manager Fosmikro
Stack: Vue 3 + TypeScript + Hono (Node.js) + Supabase + PM2 + Cloudflare Tunnel
OS servidor: Windows 11 (también funciona en Ubuntu 22.04)
Directorio: D:/fosmikro

[Describe tu problema aquí. Ejemplos:]

- "El comando 'supabase db push' falla con error: [pega el error]"
- "Quiero configurar un Named Tunnel de Cloudflare con dominio propio. 
   Mi dominio es: ___. Ya tengo cloudflared instalado."
- "PM2 reinicia fosmikro continuamente. El log muestra: [pega el log]"
- "Quiero migrar de Quick Tunnel a Named Tunnel sin cortar el servicio."
- "Necesito configurar pg_dump automático en Windows con Task Scheduler."
- "El frontend compila bien pero las peticiones /api/* dan 404 en producción."
```

---

## Referencias rápidas

| Recurso              | URL                                              |
|----------------------|--------------------------------------------------|
| Supabase             | https://supabase.com                             |
| Supabase CLI docs    | https://supabase.com/docs/reference/cli          |
| Cloudflare Tunnel    | https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/ |
| Cloudflare Registrar | https://cloudflare.com/products/registrar        |
| PM2 docs             | https://pm2.keymetrics.io/docs/                  |
| NIC Ecuador          | https://nic.ec                                   |
| UptimeRobot          | https://uptimerobot.com                          |
| dnschecker.org       | https://dnschecker.org                           |
