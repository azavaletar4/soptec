#!/usr/bin/env bash
# Prueba aislada de deploy/rollback.sh -- NO toca el repo real, la VM de
# produccion, Supabase ni Docker. Usa DEPLOY_SKIP_DOCKER=1 siempre, asi que
# solo valida la parte de git (revertir al commit del tag, bloqueos); la
# logica de reusar imagenes Docker respaldadas con --no-build se revisa por
# lectura de codigo (no hay daemon Docker garantizado en este entorno de
# pruebas), igual que el respaldo de imagenes en deploy/safe-update.sh.
#
# Uso: bash scripts/tests/deploy-rollback.test.sh
set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT_SRC="$REPO_ROOT/deploy/rollback.sh"
if [ ! -f "$SCRIPT_SRC" ]; then
  echo "ERROR: no se encontro $SCRIPT_SRC" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "  OK  - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "  FALLO - $1"; }

REPO="$TMP/repo"
git -c init.defaultBranch=main init -q "$REPO"
(
  cd "$REPO"
  git config user.email test@test.local
  git config user.name "Test"
  mkdir -p deploy
  cp "$SCRIPT_SRC" deploy/rollback.sh
  chmod +x deploy/rollback.sh
  printf '/.last_rollback_tag\n' >.gitignore
  echo base >file0.txt
  git add -A && git commit -q -m "C0 base"
  echo "$(git rev-parse HEAD)" >"$TMP/C0.sha"

  echo cambio >fix.txt && git add fix.txt && git commit -q -m "C1 deploy posterior"
  echo "$(git rev-parse HEAD)" >"$TMP/C1.sha"
)
C0="$(cat "$TMP/C0.sha")"
C1="$(cat "$TMP/C1.sha")"

(cd "$REPO" && git tag "rollback-test-tag" "$C0")

run() {
  (cd "$REPO" && env "$@" DEPLOY_SKIP_DOCKER=1 bash deploy/rollback.sh "${TARGET_TAG:-}") >"$TMP/last_out.txt" 2>&1
}

echo "=== Escenario 1: rollback con arbol limpio -> vuelve exactamente a C0 ==="
(cd "$REPO" && git reset -q --hard "$C1")
TARGET_TAG="rollback-test-tag"
if run; then
  head_now="$(cd "$REPO" && git rev-parse HEAD)"
  if [ "$head_now" = "$C0" ]; then ok "codigo revertido a $C0"; else bad "HEAD quedo en $head_now, esperaba $C0"; fi
else
  bad "deberia haber tenido exito"; cat "$TMP/last_out.txt"
fi

echo "=== Escenario 2: rollback con cambios locales sin commitear -> debe BLOQUEARSE ==="
(cd "$REPO" && git reset -q --hard "$C1")
echo "cambio sin commitear" >>"$REPO/fix.txt"
TARGET_TAG="rollback-test-tag"
if run; then
  bad "no debio tener exito con cambios locales sin commitear"
else
  head_now="$(cd "$REPO" && git rev-parse HEAD)"
  if [ "$head_now" = "$C1" ] && grep -q "cambios locales sin commitear" "$TMP/last_out.txt"; then
    ok "bloqueado correctamente, HEAD intacto"
  else
    bad "bloqueo con mensaje o estado inesperado"; cat "$TMP/last_out.txt"
  fi
fi
(cd "$REPO" && git checkout -q -- fix.txt)

echo "=== Escenario 3: tag/commit inexistente -> debe BLOQUEARSE con error claro ==="
(cd "$REPO" && git reset -q --hard "$C1")
TARGET_TAG="rollback-que-no-existe"
if run; then
  bad "no debio tener exito con un tag inexistente"
else
  head_now="$(cd "$REPO" && git rev-parse HEAD)"
  if [ "$head_now" = "$C1" ] && grep -q "no existe como commit/tag" "$TMP/last_out.txt"; then
    ok "bloqueado correctamente por tag inexistente"
  else
    bad "mensaje o estado inesperado"; cat "$TMP/last_out.txt"
  fi
fi

echo "=== Escenario 4: sin argumento, toma el tag de .last_rollback_tag ==="
(cd "$REPO" && git reset -q --hard "$C1")
printf 'PREV_COMMIT=%s\nROLLBACK_TAG=rollback-test-tag\n' "$(cd "$REPO" && git rev-parse --short "$C0")" >"$REPO/.last_rollback_tag"
TARGET_TAG=""
if run; then
  head_now="$(cd "$REPO" && git rev-parse HEAD)"
  if [ "$head_now" = "$C0" ]; then ok "tomo el tag de .last_rollback_tag y revirtio a $C0"; else bad "HEAD quedo en $head_now, esperaba $C0"; fi
else
  bad "deberia haber tenido exito leyendo .last_rollback_tag"; cat "$TMP/last_out.txt"
fi

echo ""
echo "=== Resumen: $PASS OK, $FAIL FALLO ==="
if [ "$FAIL" -ne 0 ]; then
  exit 1
fi
