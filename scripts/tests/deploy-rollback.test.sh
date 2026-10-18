#!/usr/bin/env bash
# Prueba aislada de deploy/rollback.sh -- NO toca el repo real, la VM de
# produccion, Supabase ni Docker. Usa DEPLOY_SKIP_DOCKER=1 siempre.
#
# Incluye, en particular, la reproduccion exacta del incidente real del
# 18/10/2026 (ver ESTADO_DESARROLLO.md): invocar el script sin argumentos
# (o via un canal no interactivo) NUNCA debe ejecutar un rollback real.
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

reset_to_c1() { (cd "$REPO" && git reset -q --hard "$C1"); }

# run_noinput: simula un canal sin terminal interactiva Y sin nada que leer
# en stdin (como ssh host "cmd" sin -t y sin pipear nada) -- </dev/null.
run_noinput() {
  (cd "$REPO" && env "$@" DEPLOY_SKIP_DOCKER=1 bash deploy/rollback.sh "${TARGET_ARGS[@]}" </dev/null) >"$TMP/last_out.txt" 2>&1
}
# run_piped: simula pasar una respuesta por un pipe (equivalente a que
# alguien la escriba, interactiva o no -- read no distingue el origen).
run_piped() {
  local answer="$1"
  shift
  (cd "$REPO" && echo "$answer" | env "$@" DEPLOY_SKIP_DOCKER=1 bash deploy/rollback.sh "${TARGET_ARGS[@]}") >"$TMP/last_out.txt" 2>&1
}

echo "=== Escenario 1 (incidente real): SIN argumentos -> debe mostrar ayuda y NO modificar nada ==="
reset_to_c1
TARGET_ARGS=()
if run_noinput; then
  bad "sin argumentos no debio tener exito"
else
  head_now="$(cd "$REPO" && git rev-parse HEAD)"
  if [ "$head_now" = "$C1" ] && grep -q "^Uso: bash deploy/rollback.sh" "$TMP/last_out.txt"; then
    ok "mostro ayuda y no modifico nada (HEAD intacto en C1)"
  else
    bad "comportamiento inesperado"; cat "$TMP/last_out.txt"
  fi
fi

echo "=== Escenario 2: --help -> debe mostrar ayuda y NO modificar nada ==="
reset_to_c1
TARGET_ARGS=(--help)
if run_noinput; then
  bad "--help no debio tener exito (solo debe mostrar ayuda)"
else
  head_now="$(cd "$REPO" && git rev-parse HEAD)"
  if [ "$head_now" = "$C1" ] && grep -q "^Uso: bash deploy/rollback.sh" "$TMP/last_out.txt"; then
    ok "--help mostro ayuda sin modificar nada"
  else
    bad "comportamiento inesperado"; cat "$TMP/last_out.txt"
  fi
fi

echo "=== Escenario 3 (incidente real): tag valido via canal SIN terminal interactiva y SIN DEPLOY_YES -> debe BLOQUEARSE ==="
reset_to_c1
TARGET_ARGS=(rollback-test-tag)
if run_noinput; then
  bad "no debio tener exito sin confirmacion y sin entrada en stdin"
else
  head_now="$(cd "$REPO" && git rev-parse HEAD)"
  if [ "$head_now" = "$C1" ]; then
    ok "bloqueado sin confirmacion posible, HEAD intacto (nada se modifico)"
  else
    bad "HEAD cambio sin confirmacion -- riesgo critico"; cat "$TMP/last_out.txt"
  fi
fi

echo "=== Escenario 4: argumentos incompletos/invalidos -> debe BLOQUEARSE sin modificar nada ==="
reset_to_c1
TARGET_ARGS=(--flag-desconocido)
if run_noinput; then
  bad "una opcion desconocida no debio tener exito"
else
  head_now="$(cd "$REPO" && git rev-parse HEAD)"
  if [ "$head_now" = "$C1" ] && grep -q "opcion desconocida" "$TMP/last_out.txt"; then
    ok "opcion desconocida bloqueada, HEAD intacto"
  else
    bad "comportamiento inesperado"; cat "$TMP/last_out.txt"
  fi
fi
reset_to_c1
TARGET_ARGS=(rollback-test-tag otro-argumento-de-mas)
if run_noinput; then
  bad "2 argumentos no debio tener exito"
else
  head_now="$(cd "$REPO" && git rev-parse HEAD)"
  if [ "$head_now" = "$C1" ] && grep -q "argumentos de mas" "$TMP/last_out.txt"; then
    ok "argumentos de mas bloqueados, HEAD intacto"
  else
    bad "comportamiento inesperado"; cat "$TMP/last_out.txt"
  fi
fi

echo "=== Escenario 5: --use-last-rollback sin .last_rollback_tag -> debe BLOQUEARSE ==="
reset_to_c1
rm -f "$REPO/.last_rollback_tag"
TARGET_ARGS=(--use-last-rollback)
if run_noinput; then
  bad "no debio tener exito sin .last_rollback_tag"
else
  head_now="$(cd "$REPO" && git rev-parse HEAD)"
  if [ "$head_now" = "$C1" ] && grep -q "no existe .last_rollback_tag" "$TMP/last_out.txt"; then
    ok "bloqueado correctamente, HEAD intacto"
  else
    bad "comportamiento inesperado"; cat "$TMP/last_out.txt"
  fi
fi

echo "=== Escenario 6: --use-last-rollback CON .last_rollback_tag + DEPLOY_YES=1 -> debe aplicar el tag correcto ==="
reset_to_c1
printf 'PREV_COMMIT=%s\nROLLBACK_TAG=rollback-test-tag\n' "$(cd "$REPO" && git rev-parse --short "$C0")" >"$REPO/.last_rollback_tag"
TARGET_ARGS=(--use-last-rollback)
if run_noinput DEPLOY_YES=1; then
  head_now="$(cd "$REPO" && git rev-parse HEAD)"
  if [ "$head_now" = "$C0" ]; then ok "uso el tag de .last_rollback_tag y revirtio a C0"; else bad "HEAD quedo en $head_now, esperaba $C0"; fi
else
  bad "deberia haber tenido exito con DEPLOY_YES=1"; cat "$TMP/last_out.txt"
fi
rm -f "$REPO/.last_rollback_tag"

echo "=== Escenario 7: tag valido + cambios locales sin commitear -> debe BLOQUEARSE ==="
reset_to_c1
echo "cambio sin commitear" >>"$REPO/fix.txt"
TARGET_ARGS=(rollback-test-tag)
if run_noinput DEPLOY_YES=1; then
  bad "no debio tener exito con cambios locales sin commitear"
else
  head_now="$(cd "$REPO" && git rev-parse HEAD)"
  if [ "$head_now" = "$C1" ] && grep -q "cambios locales sin commitear" "$TMP/last_out.txt"; then
    ok "bloqueado correctamente, HEAD intacto"
  else
    bad "comportamiento inesperado"; cat "$TMP/last_out.txt"
  fi
fi
(cd "$REPO" && git checkout -q -- fix.txt)

echo "=== Escenario 8: tag/commit inexistente -> debe BLOQUEARSE con error claro ==="
reset_to_c1
TARGET_ARGS=(rollback-que-no-existe)
if run_noinput DEPLOY_YES=1; then
  bad "no debio tener exito con un tag inexistente"
else
  head_now="$(cd "$REPO" && git rev-parse HEAD)"
  if [ "$head_now" = "$C1" ] && grep -q "no existe como commit/tag" "$TMP/last_out.txt"; then
    ok "bloqueado correctamente por tag inexistente"
  else
    bad "comportamiento inesperado"; cat "$TMP/last_out.txt"
  fi
fi

echo "=== Escenario 9: tag valido + arbol limpio + DEPLOY_YES=1 -> debe aplicarse ==="
reset_to_c1
TARGET_ARGS=(rollback-test-tag)
if run_noinput DEPLOY_YES=1; then
  head_now="$(cd "$REPO" && git rev-parse HEAD)"
  if [ "$head_now" = "$C0" ]; then ok "revertido a C0 con DEPLOY_YES=1"; else bad "HEAD quedo en $head_now, esperaba $C0"; fi
else
  bad "deberia haber tenido exito"; cat "$TMP/last_out.txt"
fi

echo "=== Escenario 10: confirmacion interactiva -- 'si' por stdin aplica, sin DEPLOY_YES ==="
reset_to_c1
TARGET_ARGS=(rollback-test-tag)
if run_piped "si"; then
  head_now="$(cd "$REPO" && git rev-parse HEAD)"
  if [ "$head_now" = "$C0" ]; then ok "'si' confirmo y aplico correctamente"; else bad "HEAD quedo en $head_now, esperaba $C0"; fi
else
  bad "escribir 'si' deberia haber aplicado el rollback"; cat "$TMP/last_out.txt"
fi

echo "=== Escenario 11: confirmacion interactiva -- 'no' por stdin cancela, sin modificar nada ==="
reset_to_c1
TARGET_ARGS=(rollback-test-tag)
if run_piped "no"; then
  bad "escribir 'no' no debio confirmar el rollback"
else
  head_now="$(cd "$REPO" && git rev-parse HEAD)"
  if [ "$head_now" = "$C1" ] && grep -q "Cancelado" "$TMP/last_out.txt"; then
    ok "'no' cancelo correctamente, HEAD intacto"
  else
    bad "estado o mensaje inesperado"; cat "$TMP/last_out.txt"
  fi
fi

echo ""
echo "=== Resumen: $PASS OK, $FAIL FALLO ==="
if [ "$FAIL" -ne 0 ]; then
  exit 1
fi
