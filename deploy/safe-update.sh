#!/usr/bin/env bash
# SmartRayco — despliegue seguro por commit explicito.
#
# Reemplaza (como alternativa, NO borra deploy/update.sh) el "git pull
# --ff-only" ciego por un flujo que exige el commit exacto a desplegar y
# bloquea antes de tocar nada si algo no esta en el estado esperado.
#
# Motivo: incidente del 18/10/2026 (ver
# docs/TECNICOS-ACTIVOS-ASIGNADO-INCIDENTE-ALCANCE.md) — un "git pull
# --ff-only" sobre una VM que estaba muchos commits detras de origin/main
# arrastro 4 fases completas nunca antes desplegadas, no solo el commit
# autorizado ese dia.
#
# Uso:
#   bash deploy/safe-update.sh <commit-sha-o-tag-a-desplegar>
#
# Variables de entorno opcionales:
#   DEPLOY_ALLOW_MULTI_COMMIT=1   permite desplegar mas de 1 commit entrante
#                                 (por defecto se bloquea: debe ser exactamente 1)
#   DEPLOY_YES=1                  omite la confirmacion interactiva ("si")
#   DEPLOY_SKIP_DOCKER=1          corre solo las validaciones de git (fetch,
#                                 bloqueos, preview) sin tocar Docker --
#                                 para pruebas en un entorno aislado
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE_FILE="docker-compose.onprem.yml"
SKIP_DOCKER="${DEPLOY_SKIP_DOCKER:-0}"
AUTO_CONFIRM="${DEPLOY_YES:-0}"
ALLOW_MULTI="${DEPLOY_ALLOW_MULTI_COMMIT:-0}"

usage() {
  cat >&2 <<'EOF'
Uso: bash deploy/safe-update.sh <commit-sha-o-tag-a-desplegar>

Despliega EXACTAMENTE el commit indicado -- nunca "lo que haya en main" en
ese momento. Antes de aplicar nada:
  1. git fetch origin
  2. muestra el commit actual, el commit solicitado y la lista de commits
     entrantes (con el diff de archivos)
  3. bloquea si hay cambios locales sin commitear en este checkout
  4. bloquea si el commit actual o el solicitado no estan en el historial
     de origin/main (divergencia)
  5. bloquea si el commit solicitado no es un avance (fast-forward) desde
     el commit actual
  6. bloquea si hay mas de 1 commit entrante, salvo DEPLOY_ALLOW_MULTI_COMMIT=1
  7. pide escribir "si" para confirmar, salvo DEPLOY_YES=1
Recien despues de todo eso: crea un tag de rollback + respalda las
imagenes Docker actuales, y aplica (fast-forward + build + up).

Variables de entorno:
  DEPLOY_ALLOW_MULTI_COMMIT=1   permite mas de 1 commit entrante
  DEPLOY_YES=1                  omite la confirmacion interactiva
  DEPLOY_SKIP_DOCKER=1          solo valida con git, no toca Docker (pruebas)
EOF
}

if [ "${1:-}" = "" ] || [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 1
fi
TARGET_INPUT="$1"

echo "== 1/6  git fetch =="
git fetch origin

if ! TARGET_SHA=$(git rev-parse --verify "${TARGET_INPUT}^{commit}" 2>/dev/null); then
  echo "ERROR: '$TARGET_INPUT' no es un commit valido (ni local ni en origin tras el fetch)." >&2
  exit 1
fi
CURRENT_SHA=$(git rev-parse HEAD)

echo "== 2/6  estado =="
echo "Commit actual (HEAD):   $CURRENT_SHA"
echo "Commit solicitado:      $TARGET_SHA"

echo "== 3/6  bloqueos de seguridad =="

if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: hay cambios locales sin commitear en este checkout -- se perderian. Revisalos antes de desplegar:" >&2
  git status --short >&2
  exit 1
fi
echo "OK: sin cambios locales pendientes."

if ! git merge-base --is-ancestor "$CURRENT_SHA" origin/main; then
  echo "ERROR: el commit actual ($CURRENT_SHA) no es ancestro de origin/main -- hay una divergencia (reset o commit local manual). Revisar a mano, no desplegar a ciegas." >&2
  exit 1
fi
echo "OK: commit actual es ancestro de origin/main (sin divergencia)."

if ! git merge-base --is-ancestor "$TARGET_SHA" origin/main; then
  echo "ERROR: el commit solicitado ($TARGET_SHA) no esta en el historial de origin/main. Abortando." >&2
  exit 1
fi
echo "OK: commit solicitado esta en el historial de origin/main."

if [ "$CURRENT_SHA" = "$TARGET_SHA" ]; then
  echo "El commit solicitado ya es el commit actual -- nada que desplegar." >&2
  exit 1
fi

if ! git merge-base --is-ancestor "$CURRENT_SHA" "$TARGET_SHA"; then
  echo "ERROR: el commit solicitado no es un avance (fast-forward) desde el commit actual -- esto no es un pull normal hacia adelante. Abortando." >&2
  exit 1
fi
echo "OK: el commit solicitado es un avance limpio desde el commit actual."

echo "== 4/6  commits y archivos entrantes ($CURRENT_SHA..$TARGET_SHA) =="
git log --oneline "${CURRENT_SHA}..${TARGET_SHA}"
INCOMING_COUNT=$(git rev-list --count "${CURRENT_SHA}..${TARGET_SHA}")
echo ""
echo "Total de commits entrantes: $INCOMING_COUNT"
echo ""
echo "-- Archivos que cambiarian --"
git diff --stat "$CURRENT_SHA" "$TARGET_SHA"
echo ""

if [ "$INCOMING_COUNT" -gt 1 ] && [ "$ALLOW_MULTI" != "1" ]; then
  echo "ERROR: hay $INCOMING_COUNT commits entrantes, no 1. Por seguridad esto se bloquea salvo que se indique explicitamente con DEPLOY_ALLOW_MULTI_COMMIT=1 (solo si de verdad se autorizo desplegar todos esos commits)." >&2
  exit 1
fi
if [ "$INCOMING_COUNT" -gt 1 ]; then
  echo "DEPLOY_ALLOW_MULTI_COMMIT=1 -- se continua con los $INCOMING_COUNT commits (autorizado explicitamente)."
fi

echo "== 5/6  confirmacion =="
if [ "$AUTO_CONFIRM" != "1" ]; then
  read -r -p "Desplegar $INCOMING_COUNT commit(s), de $CURRENT_SHA a $TARGET_SHA? Escribi 'si' para continuar: " REPLY
  if [ "$REPLY" != "si" ]; then
    echo "Cancelado por el usuario." >&2
    exit 1
  fi
else
  echo "DEPLOY_YES=1 -- se omite la confirmacion interactiva."
fi

echo "== 6/6  respaldo + aplicar =="
TS=$(date +%Y%m%d%H%M%S)
ROLLBACK_TAG="rollback-${TS}"
git tag "$ROLLBACK_TAG" "$CURRENT_SHA"
{
  echo "PREV_COMMIT=$(git rev-parse --short "$CURRENT_SHA")"
  echo "ROLLBACK_TAG=$ROLLBACK_TAG"
} > .last_rollback_tag
echo "Tag de rollback creado: $ROLLBACK_TAG -> commit previo $CURRENT_SHA"

if [ "$SKIP_DOCKER" != "1" ] && [ -f "$COMPOSE_FILE" ]; then
  for svc in frontend backend; do
    img="$(docker compose -f "$COMPOSE_FILE" images -q "$svc" 2>/dev/null || true)"
    if [ -n "$img" ]; then
      docker tag "$img" "smartrayco-${svc}:${ROLLBACK_TAG}" 2>/dev/null \
        && echo "Respaldada imagen actual de $svc como smartrayco-${svc}:${ROLLBACK_TAG}"
    fi
  done
fi

git merge --ff-only "$TARGET_SHA"
echo "git HEAD ahora en $(git rev-parse HEAD)"

if [ "$SKIP_DOCKER" = "1" ]; then
  echo "DEPLOY_SKIP_DOCKER=1 -- solo se aplico el fast-forward de git, sin tocar Docker."
  exit 0
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ERROR: no se encontro $COMPOSE_FILE en $(pwd) -- git ya avanzo a $TARGET_SHA pero no se tocara Docker." >&2
  exit 1
fi

docker compose -f "$COMPOSE_FILE" up -d --build
docker image prune -f
docker compose -f "$COMPOSE_FILE" ps
echo ""
echo "Desplegado $TARGET_SHA."
echo "Rollback si hace falta: bash deploy/rollback.sh $ROLLBACK_TAG"
