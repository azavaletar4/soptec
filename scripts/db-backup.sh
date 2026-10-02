#!/usr/bin/env bash
# SmartRayco — respaldo diario de la base de datos (Postgres de Supabase).
#
# Requiere SUPABASE_DB_URL en el entorno: la cadena de conexion DIRECTA a
# Postgres, CON password (Supabase Dashboard > Project Settings > Database
# > Connection string > "URI", algo como
# postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres).
# Las llaves VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY que ya usa el
# panel son para la API REST (PostgREST) — no sirven aqui, pg_dump habla el
# protocolo wire de Postgres directo.
#
# Uso:
#   scripts/db-backup.sh
#   SMARTRAYCO_ENV_FILE=/ruta/a/.env SMARTRAYCO_BACKUP_DIR=/otra/ruta scripts/db-backup.sh
#
# Pensado para correr por cron todos los dias a las 11:59pm (ver
# scripts/db-backup.cron.example).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SMARTRAYCO_ENV_FILE:-$SCRIPT_DIR/../.env}"
BACKUP_DIR="${SMARTRAYCO_BACKUP_DIR:-/backups/smartrayco}"
RETENTION_DAYS="${SMARTRAYCO_BACKUP_RETENTION_DAYS:-30}"

log() { echo "[db-backup] $(date '+%Y-%m-%d %H:%M:%S') - $*"; }

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  log "ERROR: falta SUPABASE_DB_URL (no esta en $ENV_FILE ni en el entorno)."
  log "Se obtiene en Supabase Dashboard > Project Settings > Database > Connection string."
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  log "ERROR: pg_dump no esta instalado. En Debian/Ubuntu: apt install -y postgresql-client"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUT_FILE="$BACKUP_DIR/smartrayco_${TIMESTAMP}.sql.gz"
TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT

log "Iniciando respaldo de la base de datos -> $OUT_FILE"

# --schema=public: solo el esquema de negocio de SmartRayco (clientes,
# contratos, inventario, etc.) — se deja fuera el esquema interno "auth" de
# Supabase (lo administra Supabase mismo, y trae hashes de password que no
# hace falta duplicar en un backup local).
if ! pg_dump "$SUPABASE_DB_URL" --schema=public --no-owner --no-acl -f "$TMP_FILE"; then
  log "ERROR: pg_dump fallo, no se genero el respaldo de hoy."
  exit 1
fi

gzip -c "$TMP_FILE" > "$OUT_FILE"
log "OK: respaldo escrito ($(du -h "$OUT_FILE" | cut -f1))"

log "Eliminando respaldos con mas de $RETENTION_DAYS dias en $BACKUP_DIR..."
find "$BACKUP_DIR" -maxdepth 1 -name 'smartrayco_*.sql.gz' -type f -mtime "+$RETENTION_DAYS" -print -delete

log "Listo."
