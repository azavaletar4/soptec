#!/usr/bin/env bash
# SmartRayco — instalador para el servidor del ISP receptor.
# Objetivo: Ubuntu 22.04/24.04 o Debian 12. Requiere sudo/root.
#
# Que hace:
#   1. Valida permisos, distro, disco y RAM.
#   2. Pide (interactivo o por flags) dominio, credenciales de Supabase y
#      el email del primer administrador.
#   3. Instala Docker Engine + plugin de Compose, cliente de PostgreSQL
#      (psql), curl, jq.
#   4. Copia el proyecto a /opt/smartrayco (o --install-dir), genera .env
#      y el Caddyfile (HTTPS automatico si diste dominio; HTTP plano si no).
#   5. Aplica el esquema (supabase/migrations/*.sql) contra TU proyecto de
#      Supabase, levanta los contenedores (Caddy, frontend, backend,
#      GenieACS+MongoDB) y crea el primer usuario SUPERADMIN.
#   6. Muestra la URL y las credenciales temporales.
#
# Uso:
#   sudo ./install.sh                    # wizard interactivo
#   sudo ./install.sh --non-interactive --domain panel.tuisp.com \
#     --email tu@correo.com --supabase-url https://xxx.supabase.co \
#     --supabase-anon-key ... --supabase-service-key ... \
#     --supabase-db-url postgresql://... --admin-email admin@tuisp.com
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Valores por defecto / flags ----------------------------------------
INSTALL_DIR="/opt/smartrayco"
DOMAIN=""
EMAIL=""
SUPABASE_URL=""
SUPABASE_ANON_KEY=""
SUPABASE_SERVICE_KEY=""
SUPABASE_DB_URL=""
ADMIN_EMAIL=""
NON_INTERACTIVE=0

log()  { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$1" >&2; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }

usage() {
  cat <<'EOF'
Uso: sudo ./install.sh [opciones]

  --install-dir DIR           Carpeta destino (default: /opt/smartrayco)
  --domain DOMINIO             Dominio publico (vacio = HTTP/IP sin HTTPS)
  --email EMAIL                Email para Let's Encrypt (si diste --domain)
  --supabase-url URL           https://xxx.supabase.co
  --supabase-anon-key KEY      Supabase anon key
  --supabase-service-key KEY   Supabase service_role key (privada)
  --supabase-db-url URL        postgresql://postgres:...@db.xxx.supabase.co:5432/postgres
  --admin-email EMAIL          Email del primer usuario SUPERADMIN
  --non-interactive            No preguntar nada; falla si falta un flag requerido
  -h, --help                   Esta ayuda
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    --supabase-url) SUPABASE_URL="$2"; shift 2 ;;
    --supabase-anon-key) SUPABASE_ANON_KEY="$2"; shift 2 ;;
    --supabase-service-key) SUPABASE_SERVICE_KEY="$2"; shift 2 ;;
    --supabase-db-url) SUPABASE_DB_URL="$2"; shift 2 ;;
    --admin-email) ADMIN_EMAIL="$2"; shift 2 ;;
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) warn "Opcion desconocida: $1"; usage; exit 1 ;;
  esac
done

# --- 1) Validacion inicial ------------------------------------------------
[ "$(id -u)" -eq 0 ] || die "Corre este script con sudo/root: sudo ./install.sh"

DISTRO_ID="unknown"
DISTRO_VERSION=""
if [ -f /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  DISTRO_ID="${ID:-unknown}"
  DISTRO_VERSION="${VERSION_ID:-}"
fi
case "$DISTRO_ID-$DISTRO_VERSION" in
  ubuntu-22.04|ubuntu-24.04|debian-12) log "Distribucion: $DISTRO_ID $DISTRO_VERSION (soportada)" ;;
  *) warn "Distribucion '$DISTRO_ID $DISTRO_VERSION' no esta probada (se probo Ubuntu 22.04/24.04 y Debian 12) — continuo de todas formas." ;;
esac

AVAIL_GB=$(( $(df --output=avail -k / | tail -1) / 1024 / 1024 ))
[ "$AVAIL_GB" -ge 5 ] || warn "Menos de 5GB libres en disco ($AVAIL_GB GB) — puede no alcanzar para las imagenes Docker."

TOTAL_MEM_MB=$(free -m | awk '/^Mem:/{print $2}')
[ "$TOTAL_MEM_MB" -ge 2048 ] || warn "Menos de 2GB de RAM (${TOTAL_MEM_MB}MB) — se recomiendan 4GB+ para correr todos los contenedores comodo."

# --- 2) Wizard interactivo (se omite por completo con --non-interactive: ---
#        ahi todo debe venir por flags: DOMAIN/EMAIL son opcionales de por
#        si — vacios es un valor valido ("sin HTTPS") — los demas son
#        obligatorios y se validan aparte, abajo, en los dos modos por igual.
prompt() {
  local __var="$1" __text="$2" __default="${3:-}"
  local __current="${!__var}"
  [ -n "$__current" ] && return 0
  read -rp "$__text${__default:+ [$__default]}: " __value
  printf -v "$__var" '%s' "${__value:-$__default}"
}

prompt_secret() {
  local __var="$1" __text="$2"
  local __current="${!__var}"
  [ -n "$__current" ] && return 0
  read -rsp "$__text: " __value; echo
  printf -v "$__var" '%s' "$__value"
}

if [ "$NON_INTERACTIVE" -eq 0 ]; then
  echo
  echo "=============================================="
  echo " SmartRayco — instalacion"
  echo "=============================================="
  echo "Antes de continuar, crea un proyecto en https://supabase.com (plan"
  echo "gratuito sirve para empezar) y ten a mano su URL, anon key,"
  echo "service_role key y cadena de conexion Postgres (Settings > API y"
  echo "Settings > Database > Connection string > URI)."
  echo

  prompt DOMAIN "Dominio (ej. panel.tuisp.com — vacio para usar HTTP/IP sin HTTPS)" ""
  if [ -n "$DOMAIN" ]; then
    prompt EMAIL "Email para el certificado HTTPS (Let's Encrypt)" "admin@$DOMAIN"
  fi
  prompt SUPABASE_URL "URL de tu proyecto Supabase (https://xxx.supabase.co)" ""
  prompt_secret SUPABASE_ANON_KEY "Supabase anon key"
  prompt_secret SUPABASE_SERVICE_KEY "Supabase service_role key (PRIVADA)"
  prompt_secret SUPABASE_DB_URL "Cadena de conexion Postgres (postgresql://...)"
  prompt ADMIN_EMAIL "Email del primer usuario SUPERADMIN" ""
fi

# Validacion final (aplica igual en modo interactivo y --non-interactive).
[ -n "$SUPABASE_URL" ] || die "Falta la URL de Supabase (--supabase-url)"
[ -n "$SUPABASE_ANON_KEY" ] || die "Falta la anon key de Supabase (--supabase-anon-key)"
[ -n "$SUPABASE_SERVICE_KEY" ] || die "Falta la service_role key de Supabase (--supabase-service-key)"
[ -n "$SUPABASE_DB_URL" ] || die "Falta la cadena de conexion a Postgres (--supabase-db-url)"
[ -n "$ADMIN_EMAIL" ] || die "Falta el email del administrador (--admin-email)"
[ -n "$DOMAIN" ] && [ -z "$EMAIL" ] && EMAIL="admin@$DOMAIN"

# --- 3) Dependencias --------------------------------------------------------
log "Instalando dependencias del sistema..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg postgresql-client jq openssl

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  log "Docker ya esta instalado, se omite."
else
  log "Instalando Docker Engine + Compose plugin..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${DISTRO_ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  CODENAME="$(. /etc/os-release && echo "$VERSION_CODENAME")"
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${DISTRO_ID} ${CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi

# --- 4) Despliegue del proyecto ---------------------------------------------
mkdir -p "$INSTALL_DIR"
if [ "$(cd "$SCRIPT_DIR" && pwd)" != "$(cd "$INSTALL_DIR" && pwd)" ]; then
  log "Copiando SmartRayco a $INSTALL_DIR..."
  cp -a "$SCRIPT_DIR"/. "$INSTALL_DIR"/
fi
cd "$INSTALL_DIR"

log "Generando .env..."
GENIEACS_SECRET="$(openssl rand -hex 32)"
{
  printf 'VITE_SUPABASE_URL=%s\n' "$SUPABASE_URL"
  printf 'VITE_SUPABASE_ANON_KEY=%s\n' "$SUPABASE_ANON_KEY"
  printf 'SUPABASE_SERVICE_ROLE_KEY=%s\n' "$SUPABASE_SERVICE_KEY"
  printf 'SUPABASE_DB_URL=%s\n' "$SUPABASE_DB_URL"
  printf 'PORT=3000\n'
  printf 'NODE_ENV=production\n'
  printf 'GENIEACS_NBI=http://genieacs:7557\n'
  printf 'GENIEACS_UI_JWT_SECRET=%s\n' "$GENIEACS_SECRET"
  printf 'TR069_SCHEDULER_ENABLED=true\n'
  printf 'TR069_SYNC_INTERVAL_MINUTES=15\n'
  printf 'TR069_METRICS_INTERVAL_MINUTES=10\n'
  printf 'XUI_BASE_URL=\n'
  printf 'XUI_USERNAME=\n'
  printf 'XUI_PASSWORD=\n'
  printf 'DEBT_HOLD_SCHEDULER_ENABLED=true\n'
  printf 'DEBT_HOLD_GRACE_DAYS=7\n'
  printf 'DEBT_HOLD_SCAN_INTERVAL_MINUTES=360\n'
} > .env
chmod 600 .env

log "Generando deploy/Caddyfile..."
if [ -n "$DOMAIN" ]; then
  cat > deploy/Caddyfile <<EOF
{
    email $EMAIL
}

$DOMAIN {
    encode gzip zstd
    reverse_proxy frontend:80
}
EOF
else
  warn "Sin dominio: se sirve por HTTP plano en el puerto 80 (sin HTTPS). Puedes configurar el dominio despues editando deploy/Caddyfile y corriendo 'docker compose -f docker-compose.onprem.yml up -d'."
  cat > deploy/Caddyfile <<'EOF'
:80 {
    encode gzip zstd
    reverse_proxy frontend:80
}
EOF
fi

# --- 5) Servicios ------------------------------------------------------------
log "Aplicando el esquema de base de datos a tu proyecto Supabase..."
for f in supabase/migrations/*.sql; do
  echo "   -> $(basename "$f")"
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

log "Levantando contenedores (Caddy, frontend, backend, GenieACS+MongoDB)... puede tardar varios minutos la primera vez."
docker compose -f docker-compose.onprem.yml up -d --build

log "Creando el primer usuario SUPERADMIN..."
ADMIN_PASSWORD="$(openssl rand -base64 18)"
CREATE_RESPONSE="$(curl -sS -X POST "${SUPABASE_URL%/}/auth/v1/admin/users" \
  -H "apikey: $SUPABASE_SERVICE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg email "$ADMIN_EMAIL" --arg pass "$ADMIN_PASSWORD" '{email:$email, password:$pass, email_confirm:true}')")"

ADMIN_ID="$(echo "$CREATE_RESPONSE" | jq -r '.id // empty')"
ADMIN_USERNAME=""
if [ -z "$ADMIN_ID" ]; then
  warn "No se pudo crear el usuario automaticamente. Respuesta de Supabase:"
  warn "$CREATE_RESPONSE"
  warn "Crealo a mano desde el Dashboard de Supabase (Authentication > Users) y luego corre:"
  warn "  psql \"\$SUPABASE_DB_URL\" -c \"update public.profiles set role='SUPERADMIN' where email='$ADMIN_EMAIL';\""
else
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -c "update public.profiles set role='SUPERADMIN' where id='$ADMIN_ID';"
  ADMIN_USERNAME="$(psql "$SUPABASE_DB_URL" -tA -c "select username from public.profiles where id='$ADMIN_ID';")"
fi

# --- 6) Mensaje final --------------------------------------------------------
if [ -n "$DOMAIN" ]; then
  URL="https://$DOMAIN"
else
  SERVER_IP="$(curl -s -4 --max-time 3 ifconfig.me || hostname -I | awk '{print $1}')"
  URL="http://$SERVER_IP"
fi

echo
echo "================================================================"
echo " SmartRayco quedo instalado."
echo "================================================================"
echo " URL:      $URL"
if [ -n "$ADMIN_ID" ]; then
  echo " Usuario:  ${ADMIN_USERNAME:-$ADMIN_EMAIL}"
  echo " Clave:    $ADMIN_PASSWORD"
  echo
  echo " Guarda esta clave AHORA (no se vuelve a mostrar) y cambiala apenas"
  echo " inicies sesion."
fi
echo
echo " El resto (OLT, MikroTik, GenieACS, planes, zonas) se configura desde"
echo " la propia interfaz web con el usuario SUPERADMIN."
echo
echo " Para actualizar mas adelante: sudo $INSTALL_DIR/deploy/update.sh"
echo " (requiere que $INSTALL_DIR sea un clon git, no solo el .tar.gz extraido)."
echo "================================================================"
