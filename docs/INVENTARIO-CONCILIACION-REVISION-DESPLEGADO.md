# DESPLEGADO — Conciliación: vista de revisión por defecto (18/10/2026)

Commit fuente autorizado: `e34a3dc5f1e481dbe5914b052fd2816732f447b3`. Base
real verificada antes de desplegar: `5ef5e75aa9c3fd5a8fd4635eb221af34cba10f59`,
imagen `sha256:1f36cd9b949620868025f0f2bc8b5568f7064dac366a930ecc43d9cf454856f0`
— coincidía exactamente con lo que corría en producción, sin drift.

## Candidato aislado

Reconstruido en un worktree local separado (`git worktree add --detach
5ef5e75`) + únicamente los 2 archivos de aplicación que realmente afectan
el frontend compilado: `src/lib/inventoryReconciliationReview.ts` (nuevo) y
`src/views/inventario/InventarioConciliacionView.vue` (modificado). Los
demás archivos del commit (`docs/*`, capturas, el guion de prueba de
navegador y su `.test.ts`) no forman parte del `dist` — se dejaron fuera a
propósito del candidato de despliegue. `git diff --stat` contra la base
confirmó exactamente esos 2 archivos — ningún cambio ajeno incorporado. Los
2 se verificaron byte a byte contra el commit de origen antes de compilar.

## Pruebas y compilación (en el candidato aislado)

- 18/18 pruebas unitarias (`inventoryReconciliation.test.ts` +
  `inventoryReconciliationReview.test.ts`, copiada temporalmente solo para
  correrla — no forma parte del candidato de despliegue): PASS.
- `npm run build` (`vue-tsc -b && vite build`): PASS, sin errores de tipos.
- Verificación del bundle antes de enviarlo: URL de Supabase correcta y
  las cadenas nuevas ("Necesitan revisión", "Todo el inventario") presentes
  en el chunk `InventarioConciliacionView-*.js`.

## Despliegue

Mismo patrón ya usado en los despliegues anteriores de esta pantalla:
imagen nueva `FROM` el tag de rollback de la imagen que ya corría
(`--no-deps` deja intactos los demás servicios). Precheck de base
(revisión + imagen) antes de tocar nada, candado de archivo contra
ejecuciones concurrentes, respaldo completo con manifiesto SHA-256
— **verificado tras el despliegue, sin discrepancias**.

- Commit instalado: `e34a3dc5f1e481dbe5914b052fd2816732f447b3`.
- Imagen nueva: `sha256:855fb3a93f2d51b4bb0353fa98e3918f1a11d905f15d0e4b0ce7e1e1fbd15920`.
- `distSha256`: `a5e4956ea02dd7038b1886f889190a47340c0d1d0a1778ba79fcc35a2a1ece3c`
  (idéntico al `dist.tar.gz` construido y verificado localmente antes de
  enviarlo).
- Contenedores protegidos (`backend`, `caddy`, `genieacs`, `mongo`): mismos
  `Id` antes y después — ninguno se tocó.
- HTTPS verificado dentro del propio script de despliegue: `/`,
  `/inventario` y `/inventario/conciliacion` devuelven el mismo
  `index.html` que el `dist` construido; todos los assets responden.
  Verificación adicional manual tras el despliegue: se identificó el chunk
  realmente referenciado por el `index.html` servido en vivo
  (`InventarioConciliacionView-B_FiQbu9.js`, mismo hash que generó el build
  local) y se confirmó que contiene las cadenas "Necesitan revisión",
  "Todo el inventario", "Pendientes de revisión", "Documentalmente
  coherentes", "Motivo de revisión" y "Avería vinculada" — es decir, el
  bundle correcto es el que efectivamente se sirve, no uno de los chunks
  antiguos que quedan presentes (sin referenciarse) en capas previas de la
  imagen.
- Respaldo en
  `/opt/smartrayco-staging/inventory-conciliacion-revision-e34a3dc/backup/`.
  Imagen de rollback ya etiquetada y presente en el host:
  `smartrayco-frontend:rollback-inventory-conciliacion-revision-e34a3dc`
  (`sha256:1f36cd9b...`, idéntica a la base pre-despliegue). Rollback
  preparado, no usado:

  ```sh
  docker compose --project-directory /opt/smartrayco \
    -f /opt/smartrayco/docker-compose.onprem.yml \
    -f /opt/smartrayco-staging/inventory-conciliacion-revision-e34a3dc/rollback.override.yml \
    up -d --no-deps --no-build --pull never frontend
  ```

## Limitación pendiente (dejada explícita, como se pidió)

No se validó con una sesión administrativa real en el navegador — este
entorno no tiene credenciales de producción para iniciar sesión. Lo
verificado son las comprobaciones automáticas del propio script de
despliegue (HTML/assets idénticos al build) y la confirmación manual de
que el chunk realmente servido contiene el texto de ambas pestañas,
contadores, motivo de revisión y el enlace "Avería vinculada". El
comportamiento interactivo (click en pestañas, filtros, búsqueda, conteos
en vivo, navegación a una unidad) ya se validó antes de desplegar con
Chrome headless y datos sintéticos sobre el **mismo bundle exacto**
(`distSha256` idéntico), pero no con una sesión real contra producción. Se
recomienda que un administrador abra `/inventario/conciliacion`, confirme
que carga por defecto en "Necesitan revisión" y pruebe el cambio a "Todo el
inventario".

## Confirmación de alcance

Sin migraciones, RPC ni cambios de RLS/backend — solo el contenedor
`frontend` se recreó. Sin escrituras en Supabase. No se tocaron equipos,
existencias, movimientos, contratos ni órdenes reales — este cambio es
puramente de presentación y filtros sobre datos ya leídos; las
clasificaciones almacenadas (`installed`/`custody`/`possible`/`unknown`)
no cambiaron, solo cómo se muestran. No se operó OLT/MikroTik. Sin push al
repositorio remoto.
