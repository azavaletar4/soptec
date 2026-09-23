#!/usr/bin/env bash
# SmartRayco — empaqueta un instalador limpio (sin datos/config de ESTE ISP)
# para distribuir a otros proveedores. Corre en la maquina de desarrollo
# (o CI), NO en el servidor destino — eso lo hace install.sh.
#
# Que hace:
#   1. Copia a /tmp/smartrayco_build SOLO el codigo/esquema/deploy (whitelist
#      explicita — nunca ".env", node_modules, dist, ni la documentacion
#      interna que menciona datos reales de este ISP: curso/, docs/,
#      README.md, 07-infraestructura.md, REPLICA-TR069-GENIEACS.md,
#      ecosystem*.cjs de PM2/Cloudflare Tunnel de este despliegue).
#   2. Sanitiza: regenera un .env.example limpio y reemplaza en el codigo
#      copiado las pocas referencias reales que quedaban solo en
#      COMENTARIOS/placeholders (IP de la OLT real, panel XUI real, IP de
#      ejemplo de ACS) — ver README-INSTALADOR.md generado dentro del paquete.
#   3. Empaqueta deploy/install.sh en la RAIZ del paquete y arma el .tar.gz.
#
# Uso:
#   ./deploy/build_package.sh [version]
#   ./deploy/build_package.sh v1.0
#
# Salida: smartrayco_installer_<version>.tar.gz en el directorio actual.
set -euo pipefail

# --- Config ------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION="${1:-v1.0}"
PKG_NAME="smartrayco"
BUILD_ROOT="/tmp/smartrayco_build"
PKG_DIR="$BUILD_ROOT/$PKG_NAME"
OUT_FILE="$SRC_DIR/smartrayco_installer_${VERSION}.tar.gz"

log() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$1"; }

log "Fuente: $SRC_DIR"
log "Build:  $BUILD_ROOT"

# --- 1) Directorio de build limpio --------------------------------------
rm -rf "$BUILD_ROOT"
mkdir -p "$PKG_DIR"

# --- 2) Copia por LISTA BLANCA (nunca "copiar todo y luego borrar") -----
# Solo lo que un ISP receptor necesita para correr el sistema: codigo,
# esquema de BD (DDL puro, ya verificado sin datos de clientes) y deploy.
COPY_DIRS=(src server supabase deploy)
COPY_FILES=(
  package.json
  package-lock.json
  index.html
  vite.config.ts
  tsconfig.json
  tsconfig.app.json
  tsconfig.node.json
  tsconfig.server.json
  docker-compose.yml
  docker-compose.onprem.yml
)

for d in "${COPY_DIRS[@]}"; do
  if [ -d "$SRC_DIR/$d" ]; then
    log "Copiando $d/"
    cp -r "$SRC_DIR/$d" "$PKG_DIR/$d"
  fi
done

for f in "${COPY_FILES[@]}"; do
  if [ -f "$SRC_DIR/$f" ]; then
    cp "$SRC_DIR/$f" "$PKG_DIR/$f"
  fi
done

# Limpieza de artefactos que no deben viajar aunque hayan quedado dentro
# de los directorios copiados (node_modules no deberia estar ahi, pero por
# si el build corre con node_modules/ hermano de src/ symlinkeado, etc.)
find "$PKG_DIR" -type d \( -name node_modules -o -name dist -o -name '.git' \) -prune -exec rm -rf {} + 2>/dev/null || true
find "$PKG_DIR" -type f \( -name '*.log' -o -name '*.tsbuildinfo' -o -name '.env' -o -name '.env.*' \) -delete 2>/dev/null || true
rm -rf "$PKG_DIR/supabase/.temp" "$PKG_DIR/supabase/.branches"

# NO se incluyen (a proposito): curso/, docs/, README.md, 07-infraestructura.md,
# REPLICA-TR069-GENIEACS.md (documentacion interna que menciona la OLT real,
# el conteo real de ONTs importadas, etc.), ni ecosystem.config.cjs /
# ecosystem.production.config.cjs (PM2 + Cloudflare Tunnel de ESTE ISP en
# Windows — el instalador Linux usa Docker Compose, no esos archivos).

# --- 3) Sanitizacion -----------------------------------------------------
log "Sanitizando configuracion..."

# .env.example: se regenera completo (no se confia en editar el real por
# si alguna vez se agrega ahi un valor real sin querer).
cat > "$PKG_DIR/.env.example" <<'ENVEOF'
# =============================================
# SUPABASE - Settings > API en app.supabase.com
# =============================================
# Crea un proyecto en https://supabase.com (gratis para empezar) y copia
# aqui sus datos. install.sh te los pide interactivamente y genera este
# archivo por ti — normalmente no hace falta editarlo a mano.

VITE_SUPABASE_URL=https://TU_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Cadena de conexion directa a Postgres (Settings > Database > Connection
# string > URI), usada SOLO por install.sh para aplicar las migraciones.
# No la necesita la app en si (no se lee en el codigo).
SUPABASE_DB_URL=postgresql://postgres:TU_PASSWORD@db.TU_PROJECT_REF.supabase.co:5432/postgres

# =============================================
# BACKEND (Hono - Node.js)
# =============================================
PORT=3000
NODE_ENV=production

# =============================================
# TR-069 / GenieACS (opcional — gestion remota de ONTs/CPEs)
# =============================================
GENIEACS_NBI=http://genieacs:7557
GENIEACS_UI_JWT_SECRET=
TR069_SCHEDULER_ENABLED=true
TR069_SYNC_INTERVAL_MINUTES=15
TR069_METRICS_INTERVAL_MINUTES=10

# =============================================
# XUI.one (panel IPTV) - integracion opcional
# =============================================
# Ruta base del panel, incluyendo el subdirectorio del reseller si aplica.
XUI_BASE_URL=http://TU-SERVIDOR-XUI/TU-RESELLER
XUI_USERNAME=
XUI_PASSWORD=

# =============================================
# Corte por deuda (opcional)
# =============================================
DEBT_HOLD_SCHEDULER_ENABLED=true
DEBT_HOLD_GRACE_DAYS=7
DEBT_HOLD_SCAN_INTERVAL_MINUTES=360
ENVEOF

# Reemplazos en el CODIGO copiado: solo aparecian en comentarios/placeholders
# (nunca en logica ejecutable — confirmado antes de armar este script), pero
# igual se genericizan para no distribuir identificadores de este ISP.
REPLACEMENTS=(
  "10\.15\.15\.2|TU-IP-OLT"
  "172\.168\.1\.253/RaycoAlex|TU-SERVIDOR-XUI/TU-RESELLER"
  "172\.168\.1\.253|TU-SERVIDOR-XUI"
  "192\.168\.100\.136|192.168.1.50"
)
for pair in "${REPLACEMENTS[@]}"; do
  search="${pair%%|*}"
  replace="${pair##*|}"
  grep -rlIZ -E "$search" "$PKG_DIR" 2>/dev/null | xargs -0 -r sed -i -E "s|$search|$replace|g" || true
done

# Red de seguridad: si por lo que sea quedo algun .env real, se aborta.
if find "$PKG_DIR" -type f -name '.env' | grep -q .; then
  warn "Se encontro un .env real dentro del paquete — abortando."
  exit 1
fi

# --- 4) install.sh a la raiz del paquete --------------------------------
mv "$PKG_DIR/deploy/install.sh" "$PKG_DIR/install.sh"
rm -f "$PKG_DIR/deploy/build_package.sh"  # solo lo necesita quien arma el paquete, no quien lo instala
chmod +x "$PKG_DIR/install.sh" "$PKG_DIR/deploy/update.sh"

cat > "$PKG_DIR/README-INSTALADOR.md" <<'MDEOF'
# SmartRayco — paquete de instalación

Sistema de gestión para ISP (clientes, contratos, facturación, OLT/GPON,
MikroTik, TR-069/CPE, mapa de red de fibra). Este paquete NO trae datos de
ningún cliente ni configuración de un ISP en particular — es la base limpia
para que instales tu propia operación.

## Requisitos

- Ubuntu 22.04/24.04 o Debian 12, con acceso `sudo`.
- Un dominio que apunte a este servidor (o su IP pública) si quieres HTTPS
  automático. Sin dominio, igual funciona por HTTP/IP para pruebas.
- Una cuenta en https://supabase.com (el plan gratuito alcanza para
  empezar) — ahí vive la base de datos, la autenticación y el storage.
  Crea un proyecto ANTES de correr el instalador y ten a mano: la URL del
  proyecto, la "anon key", la "service_role key" y la cadena de conexión a
  Postgres (las cuatro están en Settings > API y Settings > Database).

## Instalación

```bash
tar xzf smartrayco_installer_*.tar.gz
cd smartrayco
sudo ./install.sh
```

El instalador es interactivo (o usa flags — `./install.sh --help`). Al
final te muestra la URL de acceso y las credenciales temporales del primer
usuario SUPERADMIN.

## Después de instalar

Todo lo demás (zonas, planes, OLT, MikroTik, GenieACS, XUI) se configura
desde la propia interfaz web, con el usuario SUPERADMIN — no hace falta
tocar archivos ni la base de datos a mano.

Para actualizar más adelante: `sudo ./deploy/update.sh` (hace `git pull` +
reconstruye los contenedores) — requiere que hayas clonado desde git en vez
de solo extraer el .tar.gz, o adaptalo a tu flujo.
MDEOF

# --- 5) Empaquetar ---------------------------------------------------------
log "Empaquetando..."
tar -czf "$OUT_FILE" -C "$BUILD_ROOT" "$PKG_NAME"

SIZE=$(du -h "$OUT_FILE" | cut -f1)
SHA=$(sha256sum "$OUT_FILE" | cut -d' ' -f1)

echo
log "Listo: $OUT_FILE ($SIZE)"
echo "    sha256: $SHA"
echo
warn "Antes de distribuirlo: revisa a mano el contenido una vez (tar tzf \"$OUT_FILE\") —"
warn "este script cubre lo que se detecto en esta revision, pero no reemplaza una lectura humana."
