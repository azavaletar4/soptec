#!/usr/bin/env bash
# Prueba aislada de deploy/safe-update.sh -- NO toca el repo real, la VM de
# produccion, Supabase ni Docker. Crea un "origin" y una "VM" de juguete en
# un directorio temporal, con commits sinteticos, y corre el script real
# contra esa copia (DEPLOY_SKIP_DOCKER=1 siempre -- nunca se invoca Docker).
#
# Uso: bash scripts/tests/deploy-safe-update.test.sh
set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT_SRC="$REPO_ROOT/deploy/safe-update.sh"
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

# ---- construir origin (bare) + historia sintetica ----------------------
ORIGIN="$TMP/origin.git"
DEV="$TMP/dev"
git -c init.defaultBranch=main init -q --bare "$ORIGIN"
git -c init.defaultBranch=main init -q "$DEV"
(
  cd "$DEV"
  git config user.email test@test.local
  git config user.name "Test"
  git remote add origin "$ORIGIN"

  # El script real se commitea YA en C0 (parte del historial, igual en
  # C0..C3) para que clonar + resetear a cualquier commit deje el checkout
  # limpio -- si se copiara por fuera despues de clonar, quedaria como
  # archivo sin commitear y el propio script lo bloquearia (correctamente).
  mkdir -p deploy
  cp "$SCRIPT_SRC" deploy/safe-update.sh
  chmod +x deploy/safe-update.sh
  echo base >file0.txt
  git add -A && git commit -q -m "C0 base (incluye deploy/safe-update.sh)"
  git push -q origin main
  echo "$(git rev-parse HEAD)" >"$TMP/C0.sha"

  echo fix >fix.txt && git add fix.txt && git commit -q -m "C1 fix autorizado (tecnicos activos)"
  git push -q origin main
  echo "$(git rev-parse HEAD)" >"$TMP/C1.sha"

  echo extra1 >extra1.txt && git add extra1.txt && git commit -q -m "C2 fase NO autorizada 1"
  echo "$(git rev-parse HEAD)" >"$TMP/C2.sha"
  echo extra2 >extra2.txt && git add extra2.txt && git commit -q -m "C3 fase NO autorizada 2"
  git push -q origin main
  echo "$(git rev-parse HEAD)" >"$TMP/C3.sha"
)

C0="$(cat "$TMP/C0.sha")"
C1="$(cat "$TMP/C1.sha")"
C2="$(cat "$TMP/C2.sha")"
C3="$(cat "$TMP/C3.sha")"

# ---- helper: crear un clon "VM" fresco en el commit indicado ------------
make_vm() {
  local name="$1" sha="$2"
  local dir="$TMP/$name"
  git clone -q "$ORIGIN" "$dir" >/dev/null 2>&1
  (
    cd "$dir"
    git config user.email vm@test.local
    git config user.name "VM"
    git checkout -q main
    git reset -q --hard "$sha"
  )
  echo "$dir"
}

run() {
  # run <vmdir> <target> [env assignments...] -- devuelve el exit code real
  local dir="$1" target="$2"
  shift 2
  (cd "$dir" && env "$@" DEPLOY_SKIP_DOCKER=1 bash deploy/safe-update.sh "$target") >"$TMP/last_out.txt" 2>&1
}

echo "=== Escenario A: 1 commit autorizado (C0 -> C1) debe aplicarse ==="
VM="$(make_vm vmA "$C0")"
if run "$VM" "$C1" DEPLOY_YES=1; then
  head_now="$(cd "$VM" && git rev-parse HEAD)"
  if [ "$head_now" = "$C1" ]; then ok "fast-forward a C1 aplicado"; else bad "HEAD quedo en $head_now, esperaba $C1"; fi
else
  bad "deberia haber tenido exito (ver $TMP/last_out.txt)"; cat "$TMP/last_out.txt"
fi

echo "=== Escenario B: pedir C3 desde C0 (3 commits, incluye 2 NO autorizados) sin autorizacion explicita -> debe BLOQUEARSE ==="
VM="$(make_vm vmB "$C0")"
if run "$VM" "$C3" DEPLOY_YES=1; then
  bad "no debio tener exito -- dejo pasar commits no autorizados"
else
  head_now="$(cd "$VM" && git rev-parse HEAD)"
  if [ "$head_now" = "$C0" ] && grep -q "ERROR: hay 3 commits entrantes" "$TMP/last_out.txt"; then
    ok "bloqueado correctamente, HEAD intacto en C0"
  else
    bad "bloqueo con mensaje o estado inesperado"; cat "$TMP/last_out.txt"
  fi
fi

echo "=== Escenario B2: mismo caso, con DEPLOY_ALLOW_MULTI_COMMIT=1 -> debe permitirse explicitamente ==="
VM="$(make_vm vmB2 "$C0")"
if run "$VM" "$C3" DEPLOY_YES=1 DEPLOY_ALLOW_MULTI_COMMIT=1; then
  head_now="$(cd "$VM" && git rev-parse HEAD)"
  if [ "$head_now" = "$C3" ]; then ok "con autorizacion explicita, avanzo a C3"; else bad "HEAD quedo en $head_now, esperaba $C3"; fi
else
  bad "con DEPLOY_ALLOW_MULTI_COMMIT=1 deberia tener exito"; cat "$TMP/last_out.txt"
fi

echo "=== Escenario C: cambios locales sin commitear -> debe BLOQUEARSE ==="
VM="$(make_vm vmC "$C0")"
echo "cambio sin commitear" >>"$VM/file0.txt"
if run "$VM" "$C1" DEPLOY_YES=1; then
  bad "no debio tener exito con cambios locales sin commitear"
else
  head_now="$(cd "$VM" && git rev-parse HEAD)"
  if [ "$head_now" = "$C0" ] && grep -q "cambios locales sin commitear" "$TMP/last_out.txt"; then
    ok "bloqueado correctamente por cambios locales"
  else
    bad "bloqueo con mensaje o estado inesperado"; cat "$TMP/last_out.txt"
  fi
fi

echo "=== Escenario D: divergencia (commit local que nunca se pusheo a origin) -> debe BLOQUEARSE ==="
VM="$(make_vm vmD "$C0")"
(cd "$VM" && echo "manual" >local_only.txt && git add local_only.txt && git commit -q -m "cambio manual directo en la VM, nunca pusheado")
if run "$VM" "$C1" DEPLOY_YES=1; then
  bad "no debio tener exito con una divergencia respecto a origin/main"
else
  if grep -q "no es ancestro de origin/main" "$TMP/last_out.txt"; then
    ok "bloqueado correctamente por divergencia"
  else
    bad "bloqueo con mensaje inesperado"; cat "$TMP/last_out.txt"
  fi
fi

echo "=== Escenario E: SHA invalido -> debe BLOQUEARSE con error claro ==="
VM="$(make_vm vmE "$C0")"
if run "$VM" "no-existe-esta-rama" DEPLOY_YES=1; then
  bad "no debio tener exito con un commit invalido"
else
  if grep -q "no es un commit valido" "$TMP/last_out.txt"; then
    ok "bloqueado correctamente por SHA invalido"
  else
    bad "mensaje inesperado"; cat "$TMP/last_out.txt"
  fi
fi

echo "=== Escenario F: pedir un commit hacia ATRAS (C1 -> C0) -> debe BLOQUEARSE ==="
VM="$(make_vm vmF "$C1")"
if run "$VM" "$C0" DEPLOY_YES=1; then
  bad "no debio tener exito pidiendo retroceder"
else
  if grep -q "no es un avance" "$TMP/last_out.txt"; then
    ok "bloqueado correctamente por no ser un avance"
  else
    bad "mensaje inesperado"; cat "$TMP/last_out.txt"
  fi
fi

echo "=== Escenario G: confirmacion interactiva -- 'no' cancela, 'si' aplica ==="
VM="$(make_vm vmG "$C0")"
if (cd "$VM" && echo "no" | DEPLOY_SKIP_DOCKER=1 bash deploy/safe-update.sh "$C1") >"$TMP/last_out.txt" 2>&1; then
  bad "escribir 'no' no debio confirmar el despliegue"
else
  head_now="$(cd "$VM" && git rev-parse HEAD)"
  if [ "$head_now" = "$C0" ] && grep -q "Cancelado" "$TMP/last_out.txt"; then
    ok "'no' cancela correctamente, HEAD intacto"
  else
    bad "estado o mensaje inesperado tras 'no'"; cat "$TMP/last_out.txt"
  fi
fi
if (cd "$VM" && echo "si" | DEPLOY_SKIP_DOCKER=1 bash deploy/safe-update.sh "$C1") >"$TMP/last_out.txt" 2>&1; then
  head_now="$(cd "$VM" && git rev-parse HEAD)"
  if [ "$head_now" = "$C1" ]; then ok "'si' confirma y aplica correctamente"; else bad "HEAD quedo en $head_now, esperaba $C1"; fi
else
  bad "escribir 'si' deberia haber aplicado el despliegue"; cat "$TMP/last_out.txt"
fi

echo ""
echo "=== Resumen: $PASS OK, $FAIL FALLO ==="
if [ "$FAIL" -ne 0 ]; then
  exit 1
fi
