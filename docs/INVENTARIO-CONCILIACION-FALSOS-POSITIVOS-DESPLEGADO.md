# DESPLEGADO — Corrección de 3 falsos positivos en Conciliación (18/10/2026)

Commit fuente autorizado: `3bd62ddad8ddf17304cc01b713c0fa79b16e633d`. Base
real verificada antes de desplegar: `9b9993f5a09df03da96b51a9e58d77b5bcfa2289`,
imagen `sha256:6a490413d459520d1b5f2faf25a2d24b5c2db5c666a6f67fff041a23aafad37c`
— coincidía exactamente con lo que corría en producción, sin drift.

## Candidato aislado

Reconstruido en un worktree local separado (`git worktree add --detach
9b9993f`) + únicamente los 2 archivos de aplicación que afectan el
frontend compilado: `src/lib/inventoryReconciliation.ts` y
`src/lib/inventoryReconciliationReview.ts`. El `.md`, los `.test.ts` y el
guion `.ps1` del commit no forman parte del `dist` — se dejaron fuera del
candidato. `git diff --stat` contra la base confirmó exactamente esos 2
archivos — ningún cambio ajeno ni pendiente mezclado. Los 2 se verificaron
byte a byte contra el commit de origen antes de compilar.

## Pruebas y compilación (en el candidato aislado)

- 26/26 pruebas unitarias (los 3 archivos `.test.ts`, copiados
  temporalmente solo para correrlos y luego restaurados a su versión base
  antes de compilar — verificado con `git diff --stat` que el candidato
  volvió a quedar en exactamente los 2 archivos autorizados): PASS.
- `npm run build` (`vue-tsc -b && vite build`): PASS, sin errores de tipos.

## Despliegue

Mismo patrón ya usado en los despliegues anteriores de esta pantalla.
Precheck de base (revisión + imagen) antes de tocar nada, candado de
archivo, respaldo completo con manifiesto SHA-256 — **verificado tras el
despliegue, sin discrepancias**.

- Commit instalado: `3bd62ddad8ddf17304cc01b713c0fa79b16e633d`.
- Imagen nueva: `sha256:8947d847052c1a5b4dff895b59d9b19c72e5108c1f0c362dcb3153b124491f10`.
- `distSha256`: `4eda5b8d693c31146d900a0a81d00e7b92dfe3c689fb7c6c13d9b1e575bfc666`
  (idéntico al `dist.tar.gz` construido y verificado localmente antes de
  enviarlo).
- `backend`/`caddy`/`genieacs`/`mongo`: mismo `Id` **y** mismo
  `StartedAt` que antes (`backend` sigue en `2026-10-17T20:21:37Z`, sin
  reiniciarse) — sin interferencia con el registro de ONT/equipos en
  curso.
- Respaldo en
  `/opt/smartrayco-staging/inventory-conciliacion-falsos-3bd62dd/backup/`.
  Rollback preparado, no usado:

  ```sh
  docker compose --project-directory /opt/smartrayco \
    -f /opt/smartrayco/docker-compose.onprem.yml \
    -f /opt/smartrayco-staging/inventory-conciliacion-falsos-3bd62dd/rollback.override.yml \
    up -d --no-deps --no-build --pull never frontend
  ```

## Verificación posterior (los 4 puntos pedidos)

Se identificó el chunk realmente referenciado por el `index.html` servido
en vivo (`InventarioConciliacionView-BpSxf06u.js`, no uno antiguo sin
referenciar) y se confirmó que contiene el texto nuevo. Además se
reprocesaron los 3 casos reales con el clasificador ya desplegado, sobre
la misma lectura ya autorizada (sin nueva consulta a Cloud):

1. **Los dos Huawei (HG8145X6-13 y EG8145X6-10) ya no aparecen en
   "Necesitan revisión"**: ambos clasifican `installed` — motivo
   "Asignación vigente a cliente en Inventario con vínculos coherentes."
2. **El ZTE F670L sigue pendiente, sin insinuar instalación**: clasifica
   `possible`, pero el motivo ahora es "Tiene el contrato CTR-2026-00073
   registrado pero ningún cliente vinculado — probablemente un dato
   remanente de un movimiento anterior ya revertido... Revisar y limpiar
   el vínculo" — **no** aparece el texto "indicios de estar instalado"
   para este caso. (El bundle en vivo confirma que ese texto sigue
   existiendo en el código — para los casos que sí lo ameritan.)
3. **Los contratos realmente contradictorios siguen apareciendo para
   revisión**: probado explícitamente (`src/lib/__tests__/inventoryReconciliation.test.ts`)
   — una unidad cuyo `contract_id` propio difiere del contrato de su
   orden/Alta se mantiene en `possible`, nunca se reclasifica a
   `installed`.
4. **"Todo el inventario" conserva registros y conteos**: la corrección no
   toca `readInventoryReconciliation` (la consulta sigue trayendo las
   mismas unidades) ni el filtro de la vista completa — solo cambia a qué
   clasificación/motivo llega cada unidad ya leída.

## Confirmación de alcance

Sin migraciones, SQL de escritura, RPC ni cambios de RLS — solo el
contenedor `frontend` se recreó. Sin tocar existencias, equipos, contratos
ni movimientos reales (el `contract_id` remanente del ZTE sigue intacto,
tal como se documentó en el diagnóstico — su limpieza queda fuera de este
cambio). No se operó OLT/MikroTik. Sin push al repositorio remoto.
