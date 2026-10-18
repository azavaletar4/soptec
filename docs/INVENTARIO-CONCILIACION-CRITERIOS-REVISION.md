# Corrección: criterios de «Necesitan revisión» en Conciliación (18/10/2026)

Diagnóstico y corrección mínima sobre la lógica de clasificación ya
existente (`src/lib/inventoryReconciliation.ts`,
`src/lib/inventoryReconciliationReview.ts`) — sin auditoría general.

## Causa raíz

`needsReview` (`inventoryReconciliationReview.ts`) incluía
`classification === 'unknown'` como pendiente. Por construcción de
`reconcileInventory`, **'unknown' es exactamente el caso de un equipo sin
ningún vínculo, duplicado, ni coincidencia de serie** — ya era, desde
antes de hoy, el equivalente exacto al `pendienteVinculacion` que
`ontZoneDiscrepancy.ts` (Fase B OLT) ya trata como "normal durante la
migración, nunca una discrepancia" (mismo criterio, mismo proyecto, ya
validado). Un equipo "En almacén" sin ninguna evidencia contradictoria
caía en 'unknown' y, por tanto, en la cola de revisión — sin aportar
ningún motivo real que administración pudiera corregir.

## Corrección

- **`needsReview`**: ahora solo `classification === 'possible'`.
  `'unknown'` deja de contar como pendiente — sigue visible en "Todo el
  inventario", nunca se oculta.
- **`InventarioConciliacionView.vue`**: `coherentCount` ahora cuenta
  explícitamente `installed`+`custody` (antes era una resta que habría
  mezclado 'unknown' en "Documentalmente coherentes", etiqueta
  incorrecta). Nuevo contador/leyenda informando cuántos equipos "sin
  ningún vínculo ni coincidencia" no se cuentan como pendientes. Mensaje
  distinto en "Todo el inventario" para 'unknown' ("Sin vínculos ni
  coincidencias registradas — no requiere revisión.") en vez de reusar el
  texto de "coherente", que habría sido engañoso.

## Nueva detección conservadora de posible error de digitación

Reutiliza exactamente los cierres de Alta/Avería ya leídos (sin consulta
nueva a Cloud) — nunca mezcla con `olt_onts` ni ninguna fuente no
disponible ya en este módulo. Solo para la categoría **ONU** (nunca TV
Box). Compara la serie de cada cierre verificado (orden
completada/resuelta, mismo cliente) que **no tenga ninguna coincidencia
exacta** en Inventario, contra las series de unidades ONU, con distancia
de edición acotada a **exactamente 1 carácter** (sustitución, inserción o
eliminación — determinista, sin aproximación difusa) y un mínimo de 6
caracteres para evitar falsos positivos sobre series muy cortas.

- Si hay **un único** candidato a esa distancia: se marca como `possible`
  con el motivo específico, mostrando ambas series, cliente/contrato del
  cierre (verificados) y enlaces a su ficha/orden — nunca se asume que es
  el mismo equipo.
- Si hay **2 o más** candidatos empatados: se marca como ambiguo en
  ambos, con un motivo que explica la ambigüedad — nunca se elige uno al
  azar.
- Si ya existe una coincidencia exacta para esa serie en Inventario, no
  se busca ningún candidato por similitud (la coincidencia exacta ya la
  explica).

**Limitación informada**: no existe en este módulo una fuente fiable
adicional para comparar series de TV Box (no hay un registro paralelo de
"serie esperada" para esa categoría) — por diseño, la detección no se
extiende a TV Box en vez de inventar una comparación sin fuente confiable.

## Cuantificación real (lectura de solo lectura, autorizada para esta entrega)

Reconstruido con la misma consulta ya usada en sesiones anteriores
(`scripts/inventory-reconciliation-cloud-readonly.ps1`, sin cambios),
reprocesada con el clasificador corregido:

| | Antes (needsReview incluía 'unknown') | Después |
| --- | ---: | ---: |
| Pendientes de revisión | **55** | **2** |
| Total de unidades serializadas | 142 | 142 |

**53 falsos positivos eliminados** (96% de la cola de revisión anterior
no tenía ningún motivo real). Los 2 casos que permanecen pendientes son
genuinos:

1. ZTE `ZTEGDCE0C3A4` — contrato residual de un movimiento ya revertido
   (mismo caso del diagnóstico anterior, `docs/INVENTARIO-CONCILIACION-FALSOS-POSITIVOS.md`;
   su limpieza sigue fuera de alcance de este cambio de clasificación).
2. Un equipo MITRASTAR en estado `en_recupero` con un vínculo registrado
   que no termina de verificarse — caso nuevo, legítimamente ambiguo,
   queda para revisión administrativa (no se investigó más a fondo; fuera
   del alcance de esta corrección de criterios).

0 candidatos de posible error de digitación en esta lectura (no hay
cierres de Alta/Avería sin coincidencia exacta en este momento, mismo
hallazgo de sesiones anteriores sobre el uso real de ese campo) — la
capacidad queda lista para cuando sí existan.

## Pruebas

- `src/lib/__tests__/inventoryReconciliation.test.ts`: 6 pruebas nuevas
  cubren exactamente los casos pedidos — equipo nuevo en almacén/devolución
  válida, serie similar (candidato único), series ambiguas, exclusión
  cuando ya hay coincidencia exacta, exclusión de TV Box, y el límite
  mínimo de longitud. 20/20 en el archivo.
- `src/lib/__tests__/inventoryReconciliationReview.test.ts`: actualizadas
  las pruebas de tier/orden para reflejar que `'unknown'` ya no es
  pendiente (`needsReview` lo confirma explícitamente); 7/7.
- Las 5 pruebas de `reconciliationSessionGuard.test.ts`: sin cambios,
  siguen en verde. **32/32 en total.**
- `vue-tsc -p tsconfig.app.json` y `npm run build`: sin errores.
- `scripts/tests/inventory-reconciliation-browser.mjs` (Chrome headless
  local, datos sintéticos, sin red real): actualizado para reflejar que,
  de las 4 unidades del fixture, solo 1 (con coincidencia de serie real)
  queda pendiente — antes eran 2 (la de serie coincidente + la unidad sin
  ningún vínculo, que generaba el falso positivo reportado); confirma
  además el nuevo mensaje distinto para 'unknown' en "Todo el inventario".
  Capturas actualizadas.

## Confirmación de alcance

Solo lectura (1 consulta `REPEATABLE READ READ ONLY` ya autorizada,
reutilizada para esta cuantificación) + corrección en la lógica de
clasificación/presentación ya existente. Sin escrituras, sin asignaciones
ni correcciones automáticas, sin migraciones, RLS, RPC ni operaciones de
red (OLT/MikroTik). No se inventó ninguna coincidencia ni relación — el
detector de posible error de digitación nunca afirma que sea el mismo
equipo, solo señala la diferencia encontrada para revisión manual.
Commit local creado; **sin push ni despliegue**.
