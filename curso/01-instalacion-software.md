# FASE 1 — Instalación de software y librerías

## ISP Manager Fosmikro — Curso Técnico

---

## ✅ LISTA DE VERIFICACIÓN PREVIA AL CURSO
### (Instalar ANTES de la primera clase)

> **Instrucción para el alumno:** completa esta lista antes de asistir al curso.
> Ejecuta cada comando de verificación en tu terminal para confirmar que está instalado.
> Si algo falla, sigue las instrucciones de instalación más abajo en este documento.

---

### Hardware mínimo requerido

| Componente | Mínimo | Recomendado |
|---|---|---|
| Procesador | Intel i5 / AMD Ryzen 5 | i7 / Ryzen 7 |
| RAM | 8 GB | 16 GB |
| Disco | 50 GB libres (SSD) | 100 GB SSD |
| Sistema operativo | Windows 10/11 64-bit | Windows 11 |
| Conexión a internet | 10 Mbps | 20 Mbps+ |
| Teléfono (opcional) | Android 8.0+ | Android 11+ |

> Para desarrollar la app fsMk (APK Android) se necesitan **al menos 16 GB RAM** porque Android Studio y el emulador consumen muchos recursos.

---

### Software a instalar antes del curso

| # | Herramienta | Versión | Precio | Descarga | Verificar |
|---|---|---|---|---|---|
| 1 | **Node.js LTS** | v22+ | Gratis | https://nodejs.org | `node --version` |
| 2 | **npm** | v10+ | Incluido con Node | — | `npm --version` |
| 3 | **Git** | Cualquiera | Gratis | https://git-scm.com/downloads | `git --version` |
| 4 | **VS Code** | Última | Gratis | https://code.visualstudio.com | Abrir y verificar |
| 5 | **PM2** | Última | Gratis | `npm install -g pm2` | `pm2 --version` |
| 6 | **Claude Code** | Última | Gratis* | `npm install -g @anthropic-ai/claude-code` | `claude --version` |
| 7 | **Supabase CLI** | Última | Gratis | `npm install -g supabase` | `supabase --version` |
| 8 | **Cloudflared** | Última | Gratis | https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ | `cloudflared --version` |
| 9 | **Android Studio** *(solo fsMk)* | Meerkat+ | Gratis | https://developer.android.com/studio | Abrir y verificar |
| 10 | **JDK 21 Temurin** *(solo fsMk)* | 21 LTS | Gratis | https://adoptium.net | `java --version` |

> *Claude Code requiere cuenta en https://console.anthropic.com — el plan gratuito incluye créditos iniciales.

---

### Cuentas a crear antes del curso (todas gratuitas)

| Servicio | Para qué se usa | URL de registro |
|---|---|---|
| **GitHub** | Guardar el código, build automático del APK | https://github.com/signup |
| **Supabase** | Base de datos PostgreSQL en la nube, Auth, Storage | https://supabase.com |
| **Cloudflare** | Tunnel gratuito para exponer el servidor a internet | https://cloudflare.com |
| **Anthropic Console** | Usar Claude Code para desarrollo asistido con IA | https://console.anthropic.com |

---

### Comandos de verificación — ejecutar en terminal antes del curso

Copia y pega este bloque en tu terminal (PowerShell o CMD en Windows):

```bash
echo "=== Verificación de herramientas fosmikro ===" && \
node --version && \
npm --version && \
git --version && \
pm2 --version && \
claude --version && \
supabase --version && \
cloudflared --version && \
java --version && \
echo "=== Todo OK - listo para el curso ==="
```

Si todos los comandos muestran versiones sin errores, estás listo para comenzar.

---

### Extensiones de VS Code recomendadas (instalar antes del curso)

Abre VS Code, ve a Extensiones (Ctrl+Shift+X) e instala:

| Extensión | ID | Para qué |
|---|---|---|
| **Vue - Official** (Volar) | `Vue.volar` | Soporte Vue 3 + TypeScript |
| **Tailwind CSS IntelliSense** | `bradlc.vscode-tailwindcss` | Autocompletado Tailwind |
| **ESLint** | `dbaeumer.vscode-eslint` | Linting de código |
| **Prettier** | `esbenp.prettier-vscode` | Formateo automático |
| **GitLens** | `eamodio.gitlens` | Historial Git integrado |
| **Thunder Client** | `rangav.vscode-thunder-client` | Probar APIs REST |
| **Supabase** | `Supabase.supabase-vscode` | Conexión a Supabase |

---

## Introducción

Esta fase cubre la instalación y configuración de todas las herramientas necesarias para desarrollar, desplegar y mantener el sistema ISP Manager Fosmikro. El stack utiliza tecnologías modernas de desarrollo web y móvil, todas de código abierto o con tier gratuito disponible.

**Tiempo estimado:** 2-3 horas (incluyendo descargas)
**Sistema operativo de referencia:** Windows 11 (con notas para Linux/Mac donde aplica)

---

## 1.1 Node.js v22+ LTS

Node.js es el entorno de ejecución JavaScript que alimenta tanto el backend (servidor Hono) como las herramientas de construcción del frontend (Vite).

**URL de descarga:** https://nodejs.org/en/download

**Precio:** Gratuito (open source, licencia MIT)

**Version usada en el proyecto:** v24.18.0 (npm v11.16.0)

### Instalacion en Windows

1. Ir a https://nodejs.org/en/download
2. Descargar el instalador `.msi` para Windows (64-bit)
3. Ejecutar el instalador, aceptar las opciones por defecto
4. Reiniciar la terminal

### Instalacion en Linux (Ubuntu/Debian)

```bash
# Usar el administrador de versiones nvm (recomendado)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc

# Instalar Node.js LTS
nvm install --lts
nvm use --lts
```

### Instalacion en macOS

```bash
# Con Homebrew
brew install node@22

# O con nvm (igual que Linux)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
```

### Verificacion

```bash
node --version
# Resultado esperado: v24.18.0 (o superior a v22.0.0)

npm --version
# Resultado esperado: v11.16.0 (o superior a v10.0.0)
```

### Por que Node.js 22+

- Soporte nativo de ESModules sin flags experimentales
- `fetch` nativo (sin necesidad de `node-fetch`)
- Mejoras de rendimiento del motor V8
- LTS (Long Term Support) hasta abril 2027

---

## 1.2 Git

Git es el sistema de control de versiones. Se usa para clonar el repositorio, gestionar cambios y colaborar en el proyecto.

**URL de descarga:** https://git-scm.com/downloads

**Precio:** Gratuito (open source, licencia GPL v2)

### Instalacion en Windows

1. Ir a https://git-scm.com/downloads/win
2. Descargar `Git-2.x.x-64-bit.exe`
3. Durante la instalacion: seleccionar "Git from the command line and also from 3rd-party software"
4. Editor por defecto: seleccionar VS Code si ya esta instalado

### Instalacion en Linux

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install git -y

# CentOS/RHEL/Rocky
sudo dnf install git -y
```

### Instalacion en macOS

```bash
brew install git
```

### Configuracion inicial obligatoria

```bash
# Configurar nombre de usuario (aparece en commits)
git config --global user.name "Tu Nombre Completo"

# Configurar email (debe coincidir con tu cuenta GitHub)
git config --global user.email "tu-email@ejemplo.com"

# Configurar editor por defecto (VS Code)
git config --global core.editor "code --wait"

# Configurar rama principal como 'main' (estandar moderno)
git config --global init.defaultBranch main

# Verificar configuracion
git config --global --list
```

### Verificacion

```bash
git --version
# Resultado esperado: git version 2.47.x o superior
```

---

## 1.3 VS Code (Visual Studio Code)

Editor de codigo principal para el desarrollo del proyecto.

**URL de descarga:** https://code.visualstudio.com/download

**Precio:** Gratuito (open source, licencia MIT)

### Instalacion

1. Ir a https://code.visualstudio.com/download
2. Descargar el instalador para tu sistema operativo
3. En Windows: marcar "Agregar al PATH" y "Abrir con Code" en el menu contextual

### Extensiones recomendadas

Instalar desde el panel de extensiones de VS Code (Ctrl+Shift+X) o con los comandos:

```bash
# Vue 3 / TypeScript (Volar — reemplaza Vetur)
code --install-extension Vue.volar

# TypeScript soporte adicional
code --install-extension ms-vscode.vscode-typescript-next

# Tailwind CSS IntelliSense (autocompletado de clases)
code --install-extension bradlc.vscode-tailwindcss

# GitLens (visualizacion avanzada de git)
code --install-extension eamodio.gitlens

# Prettier (formateo automatico de codigo)
code --install-extension esbenp.prettier-vscode

# ESLint (deteccion de errores)
code --install-extension dbaeumer.vscode-eslint

# Iconos para archivos (opcional, mejora navegacion)
code --install-extension PKief.material-icon-theme

# REST Client (probar APIs directamente desde VS Code)
code --install-extension humao.rest-client
```

### Configuracion recomendada (.vscode/settings.json)

Crear el archivo `.vscode/settings.json` en la raiz del proyecto:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.tabSize": 2,
  "typescript.preferences.importModuleSpecifier": "relative",
  "vue.inlayHints.missingProps": true,
  "tailwindCSS.experimental.classRegex": [
    ["clsx\\(([^)]*)\\)", "(?:'|\"|`)([^']*)(?:'|\"|`)"]
  ]
}
```

---

## 1.4 Supabase CLI

La CLI de Supabase permite gestionar la base de datos, migraciones, autenticacion y funciones edge desde la terminal.

**Precio Supabase:**

| Plan | Precio | Base de datos | Storage | Usuarios auth |
|------|--------|---------------|---------|---------------|
| Free | $0/mes | 500 MB | 1 GB | 50,000 |
| Pro | $25/mes | 8 GB | 100 GB | Ilimitados |
| Team | $599/mes | Personalizado | Personalizado | Ilimitados |

### Instalacion

```bash
# Instalar Supabase CLI globalmente via npm
npm install -g supabase

# Verificar instalacion
supabase --version
# Resultado esperado: 2.x.x
```

### Autenticacion y proyecto

```bash
# Iniciar sesion con tu cuenta Supabase
supabase login
# Abre el navegador para autorizar — ingresa tu email/password de app.supabase.com

# Vincular con proyecto existente (obtener project-ref en el dashboard)
supabase link --project-ref TU_PROJECT_REF
# Ejemplo: supabase link --project-ref abcdefghijklmnopqrst

# Verificar estado de conexion
supabase status
```

### Comandos esenciales de base de datos

```bash
# Inicializar estructura Supabase en proyecto nuevo
supabase init

# Ver estado actual de migraciones
supabase db diff

# Aplicar todas las migraciones al proyecto en la nube
supabase db push

# Crear nueva migracion desde cambios locales
supabase db diff --use-migra -f nombre_de_migracion

# Ejecutar una consulta SQL rapida
supabase db execute --sql "SELECT count(*) FROM clientes;"

# Ver logs de la base de datos en tiempo real
supabase db logs --follow

# Hacer backup local
supabase db dump -f backup_$(date +%Y%m%d).sql
```

### Estructura de migraciones del proyecto

El proyecto Fosmikro tiene **66 migraciones SQL** en `supabase/migrations/`. Cada migracion es un archivo `.sql` con nombre `YYYYMMDDHHMMSS_descripcion.sql`:

```
supabase/
  migrations/
    20240101120000_init_tenants.sql
    20240102150000_create_clientes.sql
    ...
    20260822100000_ultima_migracion.sql
```

---

## 1.5 PM2 (Process Manager 2)

PM2 mantiene el servidor backend corriendo en produccion, lo reinicia si hay errores y lo arranca automaticamente con el sistema.

**Precio:** Gratuito (open source)

### Instalacion

```bash
# Instalar PM2 globalmente
npm install -g pm2

# Verificar instalacion
pm2 --version
# Resultado esperado: 5.x.x
```

### Comandos esenciales

```bash
# Iniciar la aplicacion Fosmikro (usando ecosystem.config.cjs)
pm2 start ecosystem.config.cjs

# Listar todos los procesos activos
pm2 list

# Ver estado detallado de un proceso
pm2 show fosmikro

# Reiniciar proceso (aplica cambios sin downtime)
pm2 restart fosmikro

# Recargar con zero-downtime (para produccion)
pm2 reload fosmikro

# Detener un proceso
pm2 stop fosmikro

# Eliminar proceso de la lista PM2
pm2 delete fosmikro

# Ver logs en tiempo real
pm2 logs fosmikro

# Ver logs con limite de lineas
pm2 logs fosmikro --lines 100

# Monitoreo interactivo en tiempo real
pm2 monit

# Guardar lista actual de procesos (para que sobrevivan reinicios)
pm2 save

# Generar script de inicio automatico del sistema
pm2 startup
# Ejecutar el comando que PM2 muestra en pantalla como administrador

# Ver todos los logs de todos los procesos
pm2 logs --lines 50
```

### Archivo ecosystem.config.cjs del proyecto

```javascript
// ecosystem.config.cjs — configuracion PM2 del proyecto
module.exports = {
  apps: [
    {
      name: 'fosmikro',
      script: 'server/src/index.ts',
      interpreter: 'node',
      interpreter_args: '--import tsx',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      watch: false,
      max_memory_restart: '512M'
    }
  ]
}
```

---

## 1.6 Cloudflared (Cloudflare Tunnel)

Expone el servidor local a internet sin necesidad de IP publica, ideal para demostraciones, APK movil y acceso remoto.

**Precio:** Gratis para Quick Tunnel (URL temporal). Named Tunnel gratis con cuenta Cloudflare.

### Descarga por sistema operativo

**Windows:**
- URL: https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
- Renombrar a `cloudflared.exe` y colocar en `C:\Windows\System32\` o agregar al PATH

**Linux (Ubuntu/Debian):**
```bash
# Descargar e instalar paquete .deb
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb
```

**macOS:**
```bash
brew install cloudflared
```

### Verificacion

```bash
cloudflared --version
# Resultado esperado: cloudflared version 2024.x.x
```

### Quick Tunnel (URL temporal — cambia al reiniciar)

```bash
# Exponer servidor local en puerto 3000
cloudflared tunnel --url http://localhost:3000

# La terminal muestra una URL como:
# https://abc-def-ghi.trycloudflare.com
# Esta URL es accesible desde cualquier lugar del mundo
```

> **Importante:** La URL del Quick Tunnel cambia cada vez que se reinicia cloudflared. Para una URL permanente se necesita un Named Tunnel con dominio propio.

### Named Tunnel (URL permanente — requiere dominio)

```bash
# 1. Autenticarse con cuenta Cloudflare
cloudflared tunnel login

# 2. Crear el tunnel con nombre
cloudflared tunnel create fosmikro-tunnel

# 3. Crear archivo de configuracion
# ~/.cloudflared/config.yml (Linux/Mac)
# C:\Users\TU-USUARIO\.cloudflared\config.yml (Windows)

# 4. Ejecutar el tunnel
cloudflared tunnel run fosmikro-tunnel
```

### Costos de dominio para Named Tunnel

| Extension | Precio anual aprox. | Proveedor recomendado |
|-----------|--------------------|-----------------------|
| .com | $10-15 | Cloudflare Registrar |
| .net | $12-18 | Cloudflare Registrar |
| .com.ec | $30-50 | NIC Ecuador |

> **Recomendacion:** Cloudflare Registrar vende dominios al precio de costo (sin markup). URL: https://www.cloudflare.com/products/registrar/

---

## 1.7 Android Studio (solo para app movil fsMk)

Requerido unicamente si vas a compilar o modificar la aplicacion movil Android (proyecto fsMk).

**URL de descarga:** https://developer.android.com/studio

**Precio:** Gratuito

### Instalacion

1. Ir a https://developer.android.com/studio
2. Descargar el instalador para tu sistema operativo
3. Ejecutar el instalador con opciones por defecto
4. Al abrir Android Studio por primera vez, completar el Setup Wizard

### JDK 21 (Temurin — OpenJDK)

El proyecto fsMk usa JDK 21 (distribuccion Adoptium Temurin):

```bash
# URL de descarga: https://adoptium.net/temurin/releases/?version=21

# Verificar instalacion
java --version
# Resultado esperado: openjdk 21.x.x (Temurin)

javac --version
# Resultado esperado: javac 21.x.x
```

### Configuracion de SDK Android

En Android Studio: Tools > SDK Manager

| Componente | Version |
|------------|---------|
| SDK Platform | Android 14 (API 34) o superior |
| Build Tools | 34.0.0 |
| NDK | No requerido |
| SDK minimo (minSdk) | 26 (Android 8.0) |
| SDK objetivo (targetSdk) | 35 (Android 15) |

### Variables de entorno necesarias

```bash
# Windows — agregar en Variables de entorno del sistema
ANDROID_HOME=C:\Users\TU-USUARIO\AppData\Local\Android\Sdk
JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-21.x.x-hotspot

# Agregar al PATH:
%ANDROID_HOME%\tools
%ANDROID_HOME%\platform-tools
%JAVA_HOME%\bin
```

```bash
# Linux/macOS — agregar en ~/.bashrc o ~/.zshrc
export ANDROID_HOME=$HOME/Android/Sdk
export JAVA_HOME=/usr/lib/jvm/temurin-21
export PATH=$PATH:$ANDROID_HOME/tools:$ANDROID_HOME/platform-tools:$JAVA_HOME/bin
```

### Capacitor CLI (para app movil)

```bash
# Instalar Capacitor CLI
npm install -g @capacitor/cli

# Verificar
npx cap --version
```

---

## 1.8 Crear proyecto Fosmikro desde cero

### Clonar y configurar el repositorio

```bash
# Clonar el repositorio (reemplazar con tu URL real de GitHub)
git clone https://github.com/TU-USUARIO/fosmikro
cd fosmikro

# Instalar todas las dependencias (frontend + backend)
npm install

# Copiar archivo de variables de entorno de ejemplo
cp .env.example .env
```

### Editar el archivo .env

Abrir `.env` en VS Code y completar con tus credenciales de Supabase:

```bash
code .env
```

### Inicializar base de datos

```bash
# Vincular con tu proyecto Supabase
supabase link --project-ref TU_PROJECT_REF

# Aplicar las 66 migraciones al proyecto en la nube
supabase db push
```

### Iniciar en modo desarrollo

```bash
# Inicia frontend (Vite) y backend (Hono) en paralelo
npm run dev

# Frontend disponible en: http://localhost:5173
# Backend disponible en: http://localhost:3000
```

### Iniciar en modo produccion con PM2

```bash
# Construir el frontend
npm run build

# Iniciar con PM2
pm2 start ecosystem.config.cjs

# Ver que esta corriendo
pm2 list

# Guardar para que arranque con el sistema
pm2 save
pm2 startup
```

### Exponer con Cloudflare Tunnel

```bash
# En una segunda terminal
cloudflared tunnel --url http://localhost:3000
```

---

## 1.9 Variables de entorno (.env)

El archivo `.env` en la raiz del proyecto contiene todas las credenciales y configuraciones sensibles. **Nunca subir este archivo a Git** (ya esta en `.gitignore`).

### Variables del proyecto Fosmikro

```bash
# =============================================
# SUPABASE — Obtenidas en app.supabase.com
# Proyecto > Settings > API
# =============================================

# URL publica de tu proyecto Supabase
VITE_SUPABASE_URL=https://TU_PROJECT_REF.supabase.co

# Clave anonima (publica, segura para frontend)
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Clave de servicio (PRIVADA — solo backend, nunca al frontend)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# =============================================
# BACKEND (Hono — Node.js)
# =============================================

# Puerto del servidor backend
PORT=3000

# Entorno: development | production
NODE_ENV=production

# JWT Secret (debe coincidir con Supabase > Settings > API > JWT Secret)
JWT_SECRET=tu-jwt-secret-de-supabase

# =============================================
# CLOUDFLARE TUNNEL (opcional)
# =============================================

# URL publica del tunnel (se obtiene al ejecutar cloudflared)
VITE_API_URL=https://tu-tunnel.trycloudflare.com

# =============================================
# MULTI-TENANT
# =============================================

# UUID del tenant por defecto (para desarrollo local)
DEFAULT_TENANT_ID=00000000-0000-0000-0000-000000000001
```

### Como obtener las credenciales de Supabase

1. Ir a https://app.supabase.com
2. Seleccionar tu proyecto
3. Menu izquierdo: **Settings > API**
4. Copiar:
   - **Project URL** -> `VITE_SUPABASE_URL`
   - **anon public** -> `VITE_SUPABASE_ANON_KEY`
   - **service_role** -> `SUPABASE_SERVICE_ROLE_KEY` (mantener privada)

---

## 1.10 Tabla resumen de software

| Software | Version | Precio | URL de descarga | Comando de instalacion |
|----------|---------|--------|-----------------|----------------------|
| Node.js | v24.18.0 (LTS) | Gratis | https://nodejs.org/en/download | Instalador GUI / `nvm install --lts` |
| npm | v11.16.0 | Gratis | Incluido con Node.js | Incluido con Node.js |
| Git | v2.47+ | Gratis | https://git-scm.com/downloads | Instalador GUI / `sudo apt install git` |
| VS Code | Ultima | Gratis | https://code.visualstudio.com/download | Instalador GUI |
| Supabase CLI | v2.x | Gratis | npm | `npm install -g supabase` |
| PM2 | v5.x | Gratis | npm | `npm install -g pm2` |
| Cloudflared | v2024.x | Gratis | https://github.com/cloudflare/cloudflared/releases | Descarga binario / `brew install cloudflared` |
| Android Studio | Ladybug+ | Gratis | https://developer.android.com/studio | Instalador GUI |
| JDK Temurin | 21 LTS | Gratis | https://adoptium.net/temurin/releases/?version=21 | Instalador GUI |
| Capacitor CLI | v8.x | Gratis | npm | `npm install -g @capacitor/cli` |

---

## Verificacion final de todo el stack

Ejecutar estos comandos en orden para confirmar que todo esta correctamente instalado:

```bash
# --- Herramientas base ---
node --version          # v24.x.x
npm --version           # v11.x.x
git --version           # git version 2.47.x
code --version          # 1.9x.x

# --- Herramientas globales npm ---
supabase --version      # 2.x.x
pm2 --version           # 5.x.x
npx cap --version       # 8.x.x

# --- Cloudflare ---
cloudflared --version   # cloudflared version 2024.x.x

# --- Android / Java (solo si usas fsMk) ---
java --version          # openjdk 21.x.x
javac --version         # javac 21.x.x

# --- Proyecto Fosmikro ---
cd D:/fosmikro
npm run dev             # Debe iniciar sin errores
```

---

## Problemas comunes y soluciones

### Error: `supabase: command not found` despues de `npm install -g supabase`

```bash
# Verificar que el directorio npm global esta en el PATH
npm config get prefix
# Agregar TU_PREFIX/bin al PATH del sistema
```

### Error: `EACCES permission denied` al instalar paquetes globales (Linux/macOS)

```bash
# Cambiar el directorio de paquetes globales npm a uno sin privilegios root
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

### PM2 no arranca al reiniciar el sistema

```bash
# Ejecutar como administrador en Windows
pm2 startup
# Copiar y ejecutar el comando que muestra PM2
pm2 save
```

### cloudflared muestra error de certificado SSL

```bash
# Actualizar cloudflared a la ultima version
# Windows: descargar nuevo .exe de GitHub releases
# Linux:
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb
```

---

## PROMPT PARA CLAUDE

Usar este prompt para pedir a Claude que replique o actualice esta fase del curso:

```
Genera el documento de la FASE 1 del curso ISP Manager Fosmikro en español.
Título: "FASE 1 — Instalación de software y librerías"

Stack del proyecto:
- Frontend: Vue 3 + TypeScript + Vite + Tailwind CSS 4
- Backend: Hono (Node.js) con tsx
- Base de datos: Supabase (PostgreSQL + Auth + Storage + RLS)
- App móvil: Capacitor 8 + Android
- Proceso: PM2 (puerto 3000)
- Tunnel: Cloudflare (cloudflared)
- Node.js: v24.18.0, npm: v11.16.0

El documento debe cubrir en detalle (con comandos exactos en bloques de código):
1.1 Node.js v22+ LTS — URL nodejs.org, verificación, por qué v22+
1.2 Git — URL git-scm.com, configuración global (user.name, user.email, editor)
1.3 VS Code — URL code.visualstudio.com, extensiones: Volar, TypeScript, Tailwind, GitLens, Prettier
1.4 Supabase CLI — npm install -g supabase, login, link, db push, tabla de precios Free/Pro/Team
1.5 PM2 — npm install -g pm2, comandos: start, list, restart, reload, logs, monit, save, startup, archivo ecosystem.config.cjs
1.6 Cloudflared — URLs de descarga por OS, quick tunnel, named tunnel, tabla de costos de dominio
1.7 Android Studio — URL developer.android.com, JDK 21 Temurin, SDK mínimo/target, variables de entorno
1.8 Clonar proyecto — git clone, npm install, cp .env.example .env, supabase db push, npm run dev, pm2 start
1.9 Variables de entorno — todas las variables .env con descripción (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, PORT, NODE_ENV, JWT_SECRET, VITE_API_URL, DEFAULT_TENANT_ID)
1.10 Tabla resumen — Nombre | Versión | Precio | URL | Comando instalación

Incluir también:
- Script de verificación final que comprueba todas las herramientas
- Sección de problemas comunes y soluciones
- Formato Markdown con todos los comandos en bloques de código
```

---

*Documento generado para ISP Manager Fosmikro — Curso Tecnico Fase 1*
*Fecha de referencia: agosto 2026 | Node.js v24.18.0 | 66 migraciones SQL*
