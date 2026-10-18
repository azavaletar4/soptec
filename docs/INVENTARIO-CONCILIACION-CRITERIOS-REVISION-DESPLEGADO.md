# DESPLEGADO — Corrección de criterios de «Necesitan revisión» (18/10/2026)

Commit fuente autorizado: `88366848f0345c83da5b17e0ebf612ccf122249f`. Base
real verificada antes de desplegar: `3bd62ddad8ddf17304cc01b713c0fa79b16e633d`,
imagen `sha256:8947d847052c1a5b4dff895b59d9b19c72e5108c1f0c362dcb3153b124491f10`
— coincidía exactamente con lo que corría en producción, sin drift ni
cambios ajenos.

## Candidato aislado

Reconstruido en un worktree local separado (`git worktree add --detach
3bd62dd`) + únicamente los 3 archivos de aplicación que afectan el
frontend compilado: `src/lib/inventoryReconciliation.ts`,
`src/lib/inventoryReconciliationReview.ts` y
`src/views/inventario/InventarioConciliacionView.vue`. Los `.md`, las
capturas, el `.test.ts` y el guion de navegador del commit no forman
parte del `dist` — se dejaron fuera del candidato. `git diff --stat`
contra la base confirmó exactamente esos 3 archivos. Los 3 se
verificaron byte a byte contra el commit de origen antes de compilar.

## Pruebas y compilación (en el candidato aislado)

- 32/32 pruebas unitarias (los 3 `.test.ts`, copiados temporalmente solo
  para correrlos y restaurados a su versión base antes de compilar —
  verificado con `git diff --stat` que el candidato volvió a quedar en
  exactamente los 3 archivos autorizados): PASS.
- `npm run build` (`vue-tsc -b && vite build`): PASS, sin errores.

## Despliegue

Mismo patrón ya usado en despliegues anteriores. Precheck de base
(revisión + imagen) antes de tocar nada, candado de archivo, respaldo
completo con manifiesto SHA-256 — **verificado tras el despliegue, sin
discrepancias**.

- Commit instalado: `88366848f0345c83da5b17e0ebf612ccf122249f`.
- Imagen nueva: `sha256:e238d689b0b8afe163129ca50573484658925a6216bf62676b5d17da1033abb2`.
- `distSha256`: `c810600afe6b84da981c7d6fd7ace85e2ef06d92540d42cd49590a0ad1bca98a`
  (idéntico al `dist.tar.gz` construido y verificado localmente).
- `backend`/`caddy`/`genieacs`/`mongo`: mismo `Id` **y** mismo
  `StartedAt` que antes (`backend` sigue en `2026-10-17T20:21:37Z`, sin
  reiniciarse).
- Respaldo en
  `/opt/smartrayco-staging/inventory-conciliacion-criterios-8836684/backup/`.
  Rollback preparado, no usado:

  ```sh
  docker compose --project-directory /opt/smartrayco \
    -f /opt/smartrayco/docker-compose.onprem.yml \
    -f /opt/smartrayco-staging/inventory-conciliacion-criterios-8836684/rollback.override.yml \
    up -d --no-deps --no-build --pull never frontend
  ```

## Verificación posterior (los 5 puntos pedidos)

1. **HTTPS de Conciliación**: `/`, `/inventario`, `/inventario/conciliacion`
   devuelven el mismo `index.html` que el `dist` construido (verificado
   por el propio script de despliegue); todos los assets responden.
2. **"Necesitan revisión" excluye equipos sin indicios contradictorios**:
   se identificó el chunk realmente referenciado
   (`InventarioConciliacionView-D_TyCzJD.js`, no uno antiguo sin
   referenciar) y se confirmó que contiene "Sin vínculos ni coincidencias
   registradas" y "no se cuentan como pendientes" — el texto nuevo que
   reemplaza el falso positivo reportado. Cuantificado antes de
   desplegar contra datos reales: 55→2 pendientes (ver
   `docs/INVENTARIO-CONCILIACION-CRITERIOS-REVISION.md`).
3. **"Todo el inventario" conserva todas las unidades**: la corrección no
   toca `readInventoryReconciliation` ni el filtro de la vista completa
   — mismos registros y conteos.
4. **Los 2 casos con contradicciones reales conservan su explicación y
   enlaces**: confirmado en el bundle ("Contrato registrado sin cliente
   vinculado" para el ZTE; el motivo genérico de vínculos por confirmar
   para el MITRASTAR `en_recupero`) — mismo código ya verificado
   localmente contra esos 2 casos reales antes de desplegar
   (`distSha256` idéntico).
5. **Inventario/Custodia/Soporte/Campo siguen funcionando**: `/inventario`,
   `/inventario/custodia`, `/campo`, `/soporte` responden HTTP 200 tras el
   despliegue (shell de la SPA; el Kardex vive dentro de
   `InventarioProductoView.vue`, archivo no tocado por este commit).

## Limitación

No se validó con una sesión administrativa real en el navegador (sin
credenciales de producción en este entorno). Lo validado fue: (a) las
comprobaciones automáticas del script de despliegue, (b) la confirmación
de que el chunk realmente servido contiene el texto correcto, y (c) la
cuantificación real (55→2) y el comportamiento headless con datos
sintéticos, ambos corridos sobre el **mismo código exacto** ya desplegado
(`distSha256` idéntico) antes de enviarlo. Se recomienda que un
administrador abra `/inventario/conciliacion` y confirme visualmente que
la cola de revisión ya no incluye equipos en almacén sin novedad.

## Confirmación de alcance

Sin migraciones, RPC ni cambios de RLS/backend — solo el contenedor
`frontend` se recreó. Sin escrituras en Supabase. No se tocaron equipos,
existencias, contratos, órdenes ni movimientos reales; no se operó
OLT/MikroTik. Sin push al repositorio remoto.
