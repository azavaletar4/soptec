#!/usr/bin/env bash
# Run only in the explicitly authorized production window. Never runs SQL.
set -euo pipefail
action="${1:?prepare, switch or recover}"
stage="$(cd "$(dirname "$0")" && pwd)"
test "$stage" = /opt/smartrayco-staging/inventario-4e967d0 || { echo WRONG_STAGE_DIRECTORY; exit 9; }
test -f "$stage/window-authorized.ok" || { echo WINDOW_NOT_AUTHORIZED; exit 10; }
revision=4e967d08559a566ea0605087bd0778361bd835ec
short=4e967d0
frontend_before=sha256:e8e14d309e1f7bf6b77baafc6fdbdd92020f89fc25238032bc18ebb286aeeaa6
backend_before=sha256:2689e00e112fa34d090abe23ff5c27e0363c7c9215d9c4064b68e7b434c54b02
compose=(docker compose --project-directory /opt/smartrayco -f /opt/smartrayco/docker-compose.onprem.yml)
case "$action" in
 prepare)
  test "$(docker inspect --format '{{.Image}}' smartrayco-frontend-1)" = "$frontend_before"
  test "$(docker inspect --format '{{.Image}}' smartrayco-backend-1)" = "$backend_before"
  printf '%s  %s\n' c0e43443b1ca8eb082366a1fa767146870c47c59fb444601afe62e7a6fb8c98c "$stage/source.tar.gz" | sha256sum -c -
  test ! -e "$stage/source/package.json"
  mkdir -p "$stage/source"
  tar -xzf "$stage/source.tar.gz" -C "$stage/source"
  docker image tag "$frontend_before" "smartrayco-frontend:rollback-inventario-$short"
  docker image tag "$backend_before" "smartrayco-backend:rollback-inventario-$short"
  "${compose[@]}" -f "$stage/inventory-production.override.yml" config --quiet
  "${compose[@]}" -f "$stage/inventory-production.override.yml" build frontend backend
  for service in frontend backend; do
   test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "smartrayco-$service:inventario-$short")" = "$revision"
  done
  test "$(docker inspect --format '{{.Image}}' smartrayco-frontend-1)" = "$frontend_before"
  test "$(docker inspect --format '{{.Image}}' smartrayco-backend-1)" = "$backend_before"
  echo IMAGES_PREPARED_SERVICES_UNCHANGED
  ;;
 switch)
  test -f "$stage/schema-committed.ok" || { echo SCHEMA_NOT_CONFIRMED; exit 11; }
  "${compose[@]}" -f "$stage/inventory-production.override.yml" up -d --no-deps --no-build --pull never frontend backend
  echo SERVICES_SWITCHED_REQUIRES_FUNCTIONAL_VALIDATION
  ;;
 recover)
  test -f "$stage/recovery-authorized.ok" || { echo RECOVERY_NOT_AUTHORIZED; exit 12; }
  # Invoke only after the authorized SQL rollback has restored prior RLS/RPC.
  test -f "$stage/rls-rollback-confirmed.ok" || { echo RLS_ROLLBACK_NOT_CONFIRMED; exit 13; }
  "${compose[@]}" -f "$stage/inventory-production-rollback.override.yml" up -d --no-deps --no-build --pull never frontend backend
  test "$(docker inspect --format '{{.Image}}' smartrayco-frontend-1)" = "$frontend_before"
  test "$(docker inspect --format '{{.Image}}' smartrayco-backend-1)" = "$backend_before"
  echo PREVIOUS_IMAGES_RESTORED
  ;;
 *) echo UNKNOWN_ACTION; exit 14 ;;
esac
