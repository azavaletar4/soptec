#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1/4  git pull =="
git pull --ff-only

echo "== 2/4  build + up (solo recrea lo que cambio) =="
docker compose -f docker-compose.onprem.yml up -d --build

echo "== 3/4  limpieza de imagenes viejas =="
docker image prune -f

echo "== 4/4  estado =="
docker compose -f docker-compose.onprem.yml ps
