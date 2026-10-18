#!/usr/bin/env bash
# SmartRayco — rollback a partir de un tag creado por deploy/safe-update.sh.
#
# Corregido tras un incidente real (18/10/2026, ver ESTADO_DESARROLLO.md):
# la version anterior, sin argumentos, leia .last_rollback_tag EN SILENCIO
# y ejecutaba un git reset --hard de inmediato, sin ningun paso de
# confirmacion. Esta version NUNCA actua sin que se le diga explicitamente
# que tag usar, y NUNCA aplica nada sin confirmacion.
#
# Uso:
#   bash deploy/rollback.sh <rollback-tag>
#   bash deploy/rollback.sh --use-last-rollback   (opcion explicita, no el
#                                                   comportamiento por defecto)
#
# Variables de entorno:
#   DEPLOY_YES=1          omite la confirmacion interactiva (ya autorizado
#                         de antemano por quien invoca el script)
#   DEPLOY_SKIP_DOCKER=1  solo revierte el codigo (git reset), no toca Docker
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE_FILE="docker-compose.onprem.yml"
SKIP_DOCKER="${DEPLOY_SKIP_DOCKER:-0}"
AUTO_CONFIRM="${DEPLOY_YES:-0}"

usage() {
  cat >&2 <<'EOF'
Uso: bash deploy/rollback.sh <rollback-tag>
     bash deploy/rollback.sh --use-last-rollback

Revierte el codigo al commit del tag indicado y, si es posible, reusa
(sin reconstruir) las imagenes Docker ya respaldadas con ese mismo tag.

NUNCA actua sin un tag explicito ni sin confirmacion -- no hay un modo
"sin argumentos" que adivine o actue solo.

  <rollback-tag>        tag exacto a usar (ej: rollback-20261018174723)
  --use-last-rollback   usar el tag mas reciente de .last_rollback_tag --
                        opcion explicita, nunca el comportamiento por defecto

Variables de entorno:
  DEPLOY_YES=1           omite la confirmacion interactiva ("si")
  DEPLOY_SKIP_DOCKER=1   solo revierte el codigo (git reset), sin tocar Docker
EOF
}

# ---- 1) sin argumentos, -h o --help: mostrar ayuda y salir, sin tocar nada ----
if [ "$#" -eq 0 ] || [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 1
fi

if [ "$#" -gt 1 ]; then
  echo "ERROR: argumentos de mas ($#) -- se espera exactamente uno." >&2
  usage
  exit 1
fi

ARG="$1"
ROLLBACK_TAG=""
if [ "$ARG" = "--use-last-rollback" ]; then
  # ---- 2) opcion EXPLICITA para usar el ultimo respaldo ----
  if [ ! -f .last_rollback_tag ]; then
    echo "ERROR: se pidio --use-last-rollback pero no existe .last_rollback_tag en este checkout." >&2
    exit 1
  fi
  ROLLBACK_TAG="$(grep '^ROLLBACK_TAG=' .last_rollback_tag | cut -d= -f2)"
  if [ -z "$ROLLBACK_TAG" ]; then
    echo "ERROR: .last_rollback_tag no tiene una linea ROLLBACK_TAG= valida." >&2
    exit 1
  fi
  echo "Usando el ultimo respaldo registrado en .last_rollback_tag: $ROLLBACK_TAG"
elif [ "${ARG#-}" != "$ARG" ]; then
  echo "ERROR: opcion desconocida '$ARG'." >&2
  usage
  exit 1
else
  ROLLBACK_TAG="$ARG"
fi

# ---- 4) verificar TODO antes de actuar: commit objetivo, estado de git ----
echo "== 1/4  verificar el commit objetivo =="
if ! PREV_SHA=$(git rev-parse --verify "${ROLLBACK_TAG}^{commit}" 2>/dev/null); then
  echo "ERROR: '$ROLLBACK_TAG' no existe como commit/tag en este repo. Nada se modifico." >&2
  exit 1
fi
echo "OK: $ROLLBACK_TAG -> commit $PREV_SHA"

echo "== 2/4  verificar estado de git (archivos locales) =="
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: hay cambios locales sin commitear -- se perderian con el rollback. Nada se modifico. Revisalos antes de continuar:" >&2
  git status --short >&2
  exit 1
fi
echo "OK: sin cambios locales pendientes."

echo "== 3/4  verificar disponibilidad de imagenes Docker respaldadas =="
HAVE_BUILD_SERVICES=()
NEED_BUILD_SERVICES=()
if [ "$SKIP_DOCKER" != "1" ]; then
  for svc in frontend backend; do
    if docker image inspect "smartrayco-${svc}:${ROLLBACK_TAG}" >/dev/null 2>&1; then
      HAVE_BUILD_SERVICES+=("$svc")
      echo "OK: imagen respaldada disponible para $svc (smartrayco-${svc}:${ROLLBACK_TAG})."
    else
      NEED_BUILD_SERVICES+=("$svc")
      echo "AVISO: no hay imagen respaldada para $svc -- si se continua, se reconstruiria desde el codigo." >&2
    fi
  done
fi

echo "== 4/4  confirmacion =="
echo "Esto va a:"
echo "  - revertir el codigo (git reset --hard) a $PREV_SHA ($ROLLBACK_TAG)"
if [ "$SKIP_DOCKER" = "1" ]; then
  echo "  - DEPLOY_SKIP_DOCKER=1: NO tocar Docker"
elif [ "${#NEED_BUILD_SERVICES[@]}" -eq 0 ]; then
  echo "  - reusar las imagenes ya respaldadas de: ${HAVE_BUILD_SERVICES[*]} (sin reconstruir)"
else
  echo "  - reusar imagenes respaldadas de: ${HAVE_BUILD_SERVICES[*]:-ninguno}"
  echo "  - RECONSTRUIR (docker build) para: ${NEED_BUILD_SERVICES[*]} (no tienen imagen respaldada)"
fi

# ---- 3) exigir confirmacion explicita antes de CUALQUIER operacion ----
if [ "$AUTO_CONFIRM" != "1" ]; then
  read -r -p "Confirmar este rollback? Escribi 'si' para continuar: " REPLY
  if [ "$REPLY" != "si" ]; then
    echo "Cancelado. Nada se modifico." >&2
    exit 1
  fi
else
  echo "DEPLOY_YES=1 -- se omite la confirmacion interactiva."
fi

echo "== Aplicando =="
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

for svc in "${HAVE_BUILD_SERVICES[@]:-}"; do
  [ -n "$svc" ] && docker tag "smartrayco-${svc}:${ROLLBACK_TAG}" "smartrayco-${svc}:latest"
done

if [ "${#NEED_BUILD_SERVICES[@]}" -eq 0 ]; then
  docker compose -f "$COMPOSE_FILE" up -d --no-build
else
  echo "Reconstruyendo solo: ${NEED_BUILD_SERVICES[*]}"
  docker compose -f "$COMPOSE_FILE" up -d --build "${NEED_BUILD_SERVICES[@]}"
  docker compose -f "$COMPOSE_FILE" up -d --no-build
fi
docker compose -f "$COMPOSE_FILE" ps
echo "Rollback aplicado: codigo y contenedores en $PREV_SHA ($ROLLBACK_TAG)."
