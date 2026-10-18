# Conciliación: vista de revisión por defecto (18/10/2026)

Cambio exclusivamente de presentación/filtros sobre la pantalla ya
desplegada — reutiliza `reconcileInventory` y `readInventoryReconciliation`
tal cual (`src/lib/inventoryReconciliation.ts` sin tocar). No se
reclasifica nada: un equipo con contrato/orden coherente sigue
`'installed'`/`'custody'`, nunca se asume instalación física por tener
contrato.

## Qué cambia

- **`src/lib/inventoryReconciliationReview.ts`** (nuevo, puro, sin red):
  `needsReview(row)` = `classification` es `'possible'` o `'unknown'`
  (`'installed'`/`'custody'` nunca necesitan revisión). `reviewTier(row)`
  prioriza en el orden pedido — 1) almacén con indicio real de ubicación
  (serie coincidente, cliente/contrato/orden/avería vinculados), 2) serie o
  MAC duplicada, 3) ubicación sin verificar, 4) el resto de "posibles"
  (ej. custodia con técnico no coincidente). `sortByReviewPriority`
  reordena solo para mostrar, nunca cambia ni oculta nada en la consulta
  completa.
- **`InventarioConciliacionView.vue`**: dos pestañas — "Necesitan revisión"
  (predeterminada) y "Todo el inventario". Tres contadores claros
  (pendientes de revisión / total registrado / documentalmente coherentes).
  Tarjeta simplificada: modelo, serie, estado, **un** motivo de revisión
  (o "Sin alertas — vínculo documental coherente." si no aplica), con el
  detalle técnico completo (`row.reasons`) debajo en texto secundario, no
  como lista principal. Cliente/contrato/orden/avería/técnico vinculados se
  conservan exactamente igual, incluido el enlace "Avería vinculada" de la
  mejora anterior. El filtro "Resultado" se acota a `possible`/`unknown`
  dentro de "Necesitan revisión" (en "Todo el inventario" sigue ofreciendo
  las 4 opciones). Comportamiento de error/sesión sin cambios: una lectura
  fallida sigue sin mostrar resultados parciales y conserva "Actualizar
  lectura" para reintentar; un cambio de sesión sigue limpiando el reporte.

## Pruebas

- `src/lib/__tests__/inventoryReconciliationReview.test.ts` (nuevo, 6
  pruebas): coherentes nunca en revisión, prioridad 1-4 en el orden
  pedido, el reordenamiento no reclasifica ni pierde unidades.
- `src/lib/__tests__/inventoryReconciliation.test.ts`: sin cambios, 12/12
  siguen en verde (la lógica de conciliación no se tocó).
- `vue-tsc -p tsconfig.app.json` y `npm run build`: sin errores.
- `scripts/tests/inventory-reconciliation-browser.mjs` (actualizado,
  Chrome headless local, datos sintéticos, sin red real ni escrituras):
  valida que por defecto solo aparecen 2 de 4 unidades (las que necesitan
  revisión), que "Todo el inventario" sigue dando acceso a las 4 sin que
  ninguna desaparezca, filtros de categoría/estado/búsqueda, navegación al
  detalle/Kardex de una unidad y el regreso, que una lectura fallida sigue
  sin mostrar datos parciales, y que al volver a entrar (montaje nuevo) la
  vista predeterminada vuelve a ser "Necesitan revisión". Capturas en
  `docs/INVENTARIO-CONCILIACION-REVISION-LOCAL.png` (pestaña por defecto)
  y `docs/INVENTARIO-CONCILIACION-TODO-LOCAL.png` (consulta completa).
  *Nota:* ambas capturas muestran un modal residual "Cambiar categoría del
  modelo" de un paso previo del mismo guion de prueba — es un artefacto ya
  presente desde antes en este guion sintético (confirmado comparando con
  la captura anterior ya comiteada), ajeno a la pantalla de Conciliación,
  no un defecto de esta mejora.

No se probó "renovación de sesión" con un cambio real de usuario en esta
sesión — ese comportamiento es código ya existente, sin modificar por este
cambio (`watch(() => [auth.user?.id, auth.role], ...)` en
`InventarioConciliacionView.vue`, intacto).

## Confirmación de alcance

Solo presentación/filtros locales. Sin tocar backend, RPC, RLS, migraciones
ni Supabase Cloud. Sin escrituras, sin modificar existencias/equipos/
contratos/órdenes/movimientos reales. Commit local creado; **sin push ni
despliegue**, pendiente de autorización.
