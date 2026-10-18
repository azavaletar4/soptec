#!/usr/bin/env bash
# SmartRayco — rollback a partir de un tag creado por deploy/safe-update.sh.
#
# Prioriza REUSAR las imagenes Docker ya respaldadas con ese tag (sin
# reconstruir, docker compose up -d --no-build) -- solo reconstruye el/los
# servicios para los que no encuentre una imagen respaldada.
#
# Uso:
#   bash deploy/rollback.sh <rollback-tag>
#   bash deploy/rollback.sh            (toma el tag de .last_rollback_tag)
#
# Variables de entorno opcionales:
#   DEPLOY_SKIP_DOCKER=1   solo revierte el codigo (git reset), no toca Docker
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE_FILE="docker-compose.onprem.yml"
SKIP_DOCKER="${DEPLOY_SKIP_DOCKER:-0}"

ROLLBACK_TAG="${1:-}"
if [ -z "$ROLLBACK_TAG" ] && [ -f .last_rollback_tag ]; then
  ROLLBACK_TAG="$(grep '^ROLLBACK_TAG=' .last_rollback_tag | cut -d= -f2)"
fi
if [ -z "$ROLLBACK_TAG" ]; then
  echo "Uso: bash deploy/rollback.sh <rollback-tag>" >&2
  echo "(o dejar que lo tome de .last_rollback_tag si existe uno reciente)" >&2
  exit 1
fi

if ! PREV_SHA=$(git rev-parse --verify "${ROLLBACK_TAG}^{commit}" 2>/dev/null); then
  echo "ERROR: '$ROLLBACK_TAG' no existe como commit/tag en este repo." >&2
  exit 1
fi

echo "== 1/3  volver el codigo a $ROLLBACK_TAG ($PREV_SHA) =="
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: hay cambios locales sin commitear -- se perderian con el rollback. Revisalos antes de continuar:" >&2
  git status --short >&2
  exit 1
fi
git reset --hard "$PREV_SHA"
echo "git HEAD ahora en $(git rev-parse HEAD)"

if [ "$SKIP_DOCKER" = "1" ]; then
  echo "DEPLOY_SKIP_DOCKER=1 -- solo se revirtio git, sin tocar Docker."
  exit 0
fi
if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ERROR: no se encontro $COMPOSE_FILE en $(pwd) -- git ya volvio a $PREV_SHA pero no se tocara Docker." >&2
  exit 1
fi

echo "== 2/3  priorizar imagenes respaldadas (sin reconstruir) =="
NEED_BUILD_SERVICES=()
for svc in frontend backend; do
  if docker image inspect "smartrayco-${svc}:${ROLLBACK_TAG}" >/dev/null 2>&1; then
    docker tag "smartrayco-${svc}:${ROLLBACK_TAG}" "smartrayco-${svc}:latest"
    echo "OK: $svc revertido a la imagen respaldada (smartrayco-${svc}:${ROLLBACK_TAG}), sin reconstruir."
  else
    echo "AVISO: no hay imagen respaldada smartrayco-${svc}:${ROLLBACK_TAG} -- $svc se reconstruira desde el codigo." >&2
    NEED_BUILD_SERVICES+=("$svc")
  fi
done

echo "== 3/3  aplicar =="
if [ "${#NEED_BUILD_SERVICES[@]}" -eq 0 ]; then
  docker compose -f "$COMPOSE_FILE" up -d --no-build
else
  echo "Reconstruyendo solo: ${NEED_BUILD_SERVICES[*]}"
  docker compose -f "$COMPOSE_FILE" up -d --build "${NEED_BUILD_SERVICES[@]}"
  docker compose -f "$COMPOSE_FILE" up -d --no-build
fi
docker compose -f "$COMPOSE_FILE" ps
echo "Rollback aplicado: codigo y contenedores en $PREV_SHA ($ROLLBACK_TAG)."
