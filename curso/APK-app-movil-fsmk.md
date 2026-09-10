Documento generado en `D:/fosmikro/docs/appmovil-fsmk-curso.md`.

---

# APP MÓVIL fsMk — Build APK con Capacitor y GitHub Actions

---

## A.1 ¿Qué es fsMk?

fsMk es la aplicación Android del ecosistema ISP Manager Fosmikro. Está diseñada para que los **técnicos de campo** puedan operar desde su teléfono sin necesidad de abrir el panel web.

| Dato | Valor |
|---|---|
| Stack | Vue 3 + TypeScript + Vite 8 + Tailwind CSS 4 + Capacitor 8 + Supabase |
| AppId | `com.szfibersystem.fsmk` |
| AppName | fosmikro |
| Plataforma | Android (APK) |

### Módulos incluidos

| Módulo | Carpeta |
|---|---|
| OLT — lista y registro de ONUs | `src/views/olt/` |
| MikroTik | `src/views/mikrotik/` |
| TR-069 | `src/views/tr069/` |
| Instalaciones | `src/views/instalaciones/` |
| Infraestructura | `src/views/infraestructura/` |
| Portal cliente | `src/views/portal/` |
| Clientes | `src/views/clientes/` |
| Soporte | `src/views/soporte/` |
| Dashboard | `src/views/dashboard/` |

---

## A.2 Diferencias con fosmikro (web)

| Característica | fosmikro (web) | fsMk (Android) |
|---|---|---|
| Usuarios objetivo | Admins, coordinadores | Técnicos de campo |
| Acceso | Navegador (cualquier OS) | APK instalado en Android |
| Funciones | Completo (facturación, SRI, Kanban, Caja) | Subset operativo |
| OLT | SSH completo, comandos, perfiles TR-069 | Ver ONUs, registrar ONU nueva |
| Facturación / SRI | Sí (comprobantes electrónicos XAdES) | No |
| WhatsApp / Correo | Sí | No |
| Mapas Leaflet | Sí | Sí (instalaciones en campo) |
| Build | `npm run build` → Vite → Node.js | `npx cap sync` → Gradle → APK |

---

## A.3 Configurar proyecto fsMk

### 3.1 Clonar y preparar

```bash
git clone https://github.com/TU-USUARIO/fsmk
cd fsmk
npm install
cp .env.example .env
```

Editar `.env`:

```env
VITE_SUPABASE_URL=https://XXXXXXXXXXXX.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Las variables deben empezar con `VITE_` para que Vite las exponga al frontend.

### 3.2 Estructura de carpetas relevante

```
fsmk/
├── src/
│   ├── views/
│   │   ├── olt/           # OltView.vue, OnuListView.vue, OnuRegisterView.vue
│   │   ├── tr069/         # Tr069View.vue
│   │   ├── instalaciones/ # InstalacionesView.vue
│   │   ├── mikrotik/
│   │   ├── clientes/
│   │   ├── portal/
│   │   └── soporte/
│   ├── stores/            # Pinia stores
│   ├── composables/       # Lógica reutilizable
│   └── lib/               # Supabase client
├── capacitor.config.ts
├── package.json
└── .github/
    └── workflows/
        └── build-apk.yml  # GitHub Actions workflow
```

---

## A.4 Desarrollo local (modo web)

```bash
npm run dev
# Servidor en http://localhost:5173
```

Durante el desarrollo diario no se necesita Android Studio. Vite sirve la app en el navegador. Cuando esté lista se compila a APK.

---

## A.5 Build APK — Método 1: GitHub Actions (recomendado)

Este método compila el APK en la nube de GitHub sin instalar Android Studio ni el SDK localmente.

### 5.1 Preparar el repositorio

```bash
git init
git add .
git commit -m "feat: proyecto fsMk inicial"
git remote add origin https://github.com/TU-USUARIO/fsmk.git
git push -u origin main
```

### 5.2 Agregar Secrets en GitHub

**GitHub repo → Settings → Secrets and variables → Actions → New repository secret**

| Secret | Valor |
|---|---|
| `VITE_SUPABASE_URL` | URL de Supabase |
| `VITE_SUPABASE_ANON_KEY` | Anon/public key de Supabase |

### 5.3 Archivo del workflow — `.github/workflows/build-apk.yml`

```yaml
name: Build APK Debug

on:
  push:
    branches: [main, master]
  workflow_dispatch:

jobs:
  build:
    name: Build Android APK
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Setup JDK 21
        uses: actions/setup-java@v4
        with:
          java-version: '21'
          distribution: 'temurin'

      - name: Install dependencies
        run: npm ci

      - name: Build Vue app
        run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}

      - name: Add Android platform (if not present)
        run: |
          if [ ! -d "android" ]; then
            npx cap add android
          fi

      - name: Sync Capacitor
        run: npx cap sync android

      - name: Grant execute permission for gradlew
        run: chmod +x android/gradlew

      - name: Build Debug APK
        run: cd android && ./gradlew assembleDebug --no-daemon

      - name: Upload APK artifact
        uses: actions/upload-artifact@v4
        with:
          name: fosmikro-debug
          path: android/app/build/outputs/apk/debug/app-debug.apk
          retention-days: 30
```

### 5.4 Descargar el APK

1. GitHub repo → pestaña **Actions**
2. Seleccionar el workflow `Build APK Debug` mas reciente
3. Sección **Artifacts** → clic en **fosmikro-debug**
4. Se descarga un `.zip` que contiene `app-debug.apk`

El build tarda ~5-8 minutos la primera vez. Las siguientes ejecuciones son mas rapidas gracias al cache de npm (~3-4 min).

---

## A.6 Build APK — Método 2: Local con Android Studio

### 6.1 Requisitos

- Android Studio (version Ladybug o superior)
- JDK 21 instalado
- Variable de entorno `ANDROID_HOME` apuntando al SDK

### 6.2 Pasos

```bash
npm run build        # Build de Vue con Vite → genera dist/
npx cap add android  # Solo la primera vez
npx cap sync android # Sincronizar dist/ hacia android/app/src/main/assets/
npx cap open android # Abrir Android Studio
```

En Android Studio:

```
Build → Build Bundle(s) / APK(s) → Build APK(s)
```

APK generado en:
```
android/app/build/outputs/apk/debug/app-debug.apk
```

### 6.3 Scripts de package.json

```bash
npm run cap:android   # Build + sync + abrir Android Studio
npm run cap:sync      # Solo build + sync
```

---

## A.7 Configurar allowMixedContent (HTTP en red local)

Los routers MikroTik y las OLT Huawei MA5800 responden por HTTP (no HTTPS) en la red local del ISP. Android bloquea HTTP por defecto.

### 7.1 capacitor.config.ts (ya configurado en fsMk)

```typescript
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId:   'com.szfibersystem.fsmk',
  appName: 'fosmikro',
  webDir:  'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true,  // Permite HTTP en red local del ISP
  },
}

export default config
```

### 7.2 network_security_config.xml

Crear en `android/app/src/main/res/xml/network_security_config.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
```

Referenciar en `android/app/src/main/AndroidManifest.xml`:

```xml
<application
    android:networkSecurityConfig="@xml/network_security_config"
    ...>
```

---

## A.8 Instalar APK en Android

### 8.1 Activar instalacion desde fuentes desconocidas

```
Ajustes → Aplicaciones → Instalar aplicaciones desconocidas
→ Seleccionar la app que usaras para instalar
→ Activar "Permitir de esta fuente"
```

### 8.2 Transferir el APK

| Metodo | Instrucciones |
|---|---|
| USB (mas rapido) | Conectar por USB en modo MTP, copiar APK, abrir desde gestor de archivos |
| WhatsApp (practico) | Enviar como archivo adjunto, descargar en el destino |
| Google Drive / Telegram | Subir el APK, compartir enlace, descargar en el telefono |

### 8.3 Instalar

1. Abrir el archivo `.apk`
2. Tocar **Instalar**
3. Esperar ~5-10 segundos
4. Tocar **Abrir**

En cada nueva version se puede instalar encima de la anterior. Los datos de sesion (Supabase auth) se conservan.

---

## A.9 Cambiar nombre e identidad de la app

### 9.1 capacitor.config.ts

```typescript
const config: CapacitorConfig = {
  appId:   'com.tuempresa.tuapp',   // Identificador unico en Google Play
  appName: 'Mi ISP Manager',        // Nombre bajo el icono
  // ...
}
```

Despues de cambiar: `npx cap sync android`

### 9.2 strings.xml

```
android/app/src/main/res/values/strings.xml
```

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">Mi ISP Manager</string>
    <string name="title_activity_main">Mi ISP Manager</string>
    <string name="package_name">com.tuempresa.tuapp</string>
    <string name="custom_url_scheme">com.tuempresa.tuapp</string>
</resources>
```

### 9.3 Icono de la app

| Carpeta | Resolucion | Uso |
|---|---|---|
| `mipmap-mdpi/` | 48x48 px | Baja densidad |
| `mipmap-hdpi/` | 72x72 px | HD |
| `mipmap-xhdpi/` | 96x96 px | FullHD |
| `mipmap-xxhdpi/` | 144x144 px | 2K |
| `mipmap-xxxhdpi/` | 192x192 px | Alta gama |

Generar todos los tamanos automaticamente (requiere `resources/icon.png` de 1024x1024):

```bash
npm install -g @capacitor/assets
npx capacitor-assets generate --android
```

---

## A.10 Prompt para crear fsMk personalizado con Claude

```
Eres un experto en Vue 3, TypeScript, Capacitor 8 y Supabase.

Crea un proyecto de app movil Android para un ISP llamado [NOMBRE DEL ISP].

Requisitos:
- Stack: Vue 3 + TypeScript + Vite 8 + Tailwind CSS 4 + Capacitor 8 + Supabase
- AppId: com.[empresa].[appname]
- Modulos:
  * Login con Supabase Auth (email + password)
  * Dashboard con estadisticas basicas (clientes activos, instalaciones pendientes)
  * Lista de ONUs (consulta tabla 'onus' en Supabase)
  * Registro de ONU nueva (serial, cliente, direccion)
  * Lista de instalaciones pendientes con estado
  * Perfil del tecnico

Estructura:
- src/views/ con subcarpeta por modulo
- src/stores/ con Pinia (auth, onus, instalaciones)
- src/composables/ para logica reutilizable
- src/lib/supabase.ts para el cliente

Convenciones:
- Componentes con <script setup lang="ts">
- Tailwind para estilos
- Manejo de errores con try/catch y vue-sonner
- Consultas a traves de Pinia stores

Generar tambien:
1. capacitor.config.ts con allowMixedContent: true
2. .env.example con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
3. .github/workflows/build-apk.yml completo (Node 22, JDK 21 temurin)
4. package.json con scripts cap:android y cap:sync

Supabase: [PEGAR URL Y ANON KEY]
```

---

## Referencia rapida de comandos

| Accion | Comando |
|---|---|
| Desarrollo web local | `npm run dev` |
| Build frontend | `npm run build` |
| Agregar plataforma Android | `npx cap add android` |
| Sincronizar hacia Android | `npx cap sync android` |
| Build + sync + abrir Android Studio | `npm run cap:android` |
| Solo build + sync | `npm run cap:sync` |
| Compilar APK desde terminal | `cd android && ./gradlew assembleDebug` |
| Generar iconos automaticos | `npx capacitor-assets generate --android` |

---

**Notas finales:**

- El APK generado es **debug** (no firmado para produccion). Para Google Play se requiere firmarlo con una keystore.
- La URL de Supabase y la anon key son seguras en el APK; la seguridad real la proveen las politicas RLS de la base de datos.
- Si se cambia el `appId` en `capacitor.config.ts` es necesario ejecutar `npx cap sync` y posiblemente borrar la carpeta `android/` y ejecutar `npx cap add android` de nuevo.
- GitHub Actions reutiliza el cache de npm entre ejecuciones, reduciendo el tiempo de build de ~8 min a ~3-4 min en builds posteriores.
