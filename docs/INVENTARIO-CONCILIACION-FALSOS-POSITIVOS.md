# Corrección: 3 falsos positivos en Conciliación (18/10/2026)

Diagnóstico de solo lectura contra los 3 casos reales reportados (lectura
`REPEATABLE READ READ ONLY`, agregados/estructura sin exponer PII en este
documento) + corrección mínima en la lógica de clasificación existente.

## Causa exacta de cada caso

### 1. ZTE F670L, serie `ZTEGDCE0C3A4` — contrato huérfano de un movimiento ya revertido

Historial real de la unidad (`inventory_unit_events`):
1. Ingreso a bodega.
2. Asignación a cliente (`in_stock → assigned`), 2026-09-22.
3. **Devolución de cliente** (`assigned → in_stock`), 2026-10-03.

El registro vigente (`inventory_units`) hoy: `status='in_stock'`,
`client_id=NULL` (correctamente limpiado por la devolución), pero
**`contract_id` sigue apuntando al contrato de la asignación ya
revertida** — un remanente que esa devolución (procesada antes de que
existiera el trigger actual de Fase 164, que sí limpia los 4 campos
juntos) no limpió en su momento. El clasificador trataba cualquier
`contract_id` no nulo en un equipo `in_stock` como "indicio de estar
instalado" — sin notar que, sin `client_id` que lo respalde, ese contrato
no es un vínculo vigente real, es basura de datos.

### 2 y 3. HUAWEI HG8145X6-13 (Marcela Tomas Rodríguez) y HUAWEI EG8145X6-10 (Luis Avalos Alayo) — falta sincronizar `contract_id` a la unidad

Ambas unidades: `status='assigned'`, cliente correcto y verificado,
vinculadas a una Alta (`installation_id`) con `status='completed'` cuyo
`client_id` coincide. La Alta **sí** capturó el contrato
(`installations.contract_id`), pero ese dato nunca se copió al campo
`inventory_units.contract_id` de la propia unidad (quedó `NULL`). El
chequeo `orderVerified` exigía que `installation.contract_id` coincidiera
exactamente con `unit.contract_id` — al ser este último `NULL`, la
comparación fallaba aunque **no había ninguna contradicción real**, solo
un dato ausente en la unidad que la propia orden ya tenía resuelto.

## Corrección (mínima, en la lógica ya existente)

`src/lib/inventoryReconciliation.ts`:

- **`orderVerified`**: ahora acepta `unit.contract_id === null` como
  compatible con la orden (confía en el contrato de la Alta cuando la
  unidad todavía no lo sincronizó) — pero **si la unidad declara un
  contrato distinto**, sigue siendo una contradicción real y se mantiene
  en revisión (probado explícitamente).
- **`orphanContract`** (nuevo): un `contract_id` sin `client_id`,
  `installation_id` ni `ticket_id` ya no cuenta como "indicio de estar
  instalado" — se marca con un motivo específico y verificable
  ("Tiene el contrato *X* registrado pero ningún cliente vinculado —
  probablemente un dato remanente de un movimiento anterior ya
  revertido... Revisar y limpiar el vínculo"), en vez del mensaje
  genérico anterior.

`src/lib/inventoryReconciliationReview.ts`:

- `hasLocationSignal` (prioridad tier 1, "almacén con indicios de estar
  instalado") ya **no** cuenta un `contract_id` aislado — solo cuenta
  junto con `client_id`/`installation_id`/`ticket_id`/coincidencias de
  serie reales. Un contrato huérfano pasa a tier 4, con su motivo
  específico (`reviewReasonLabel` lo detecta y devuelve un texto propio,
  no el genérico de tier 4).

## Cantidad de falsos positivos corregidos

**3 de 3** casos reportados, verificados contra los datos reales (lectura
de solo lectura, sin cambios):

| Caso | Antes | Después |
| --- | --- | --- |
| ZTE `ZTEGDCE0C3A4` | `possible`, tier 1 "En almacén con indicios de estar instalado" | `possible`, tier 4, motivo específico de dato remanente — sigue en revisión (para limpiar el dato), pero ya no insinúa instalación |
| Huawei HG8145X6-13 (Marcela Tomas Rodríguez) | `possible`, tier 4 "Vínculos registrados por confirmar" | `installed` — sale de "Necesitan revisión" |
| Huawei EG8145X6-10 (Luis Avalos Alayo) | `possible`, tier 4 "Vínculos registrados por confirmar" | `installed` — sale de "Necesitan revisión" |

El ZTE se mantiene en revisión deliberadamente: su `contract_id`
remanente sigue siendo un dato real por limpiar, pero el motivo mostrado
ahora es honesto y específico en vez de sugerir una instalación
inexistente.

## Sin falta de evidencia pendiente

Los 3 casos quedaron resueltos con la información ya disponible en
`inventory_units`/`inventory_unit_events`/`installations` — no se
necesitó ningún dato adicional para explicarlos.

## Pruebas

- `src/lib/__tests__/inventoryReconciliation.test.ts` (2 pruebas nuevas):
  - Asignado con orden completada confirma `installed` aunque
    `unit.contract_id` sea `null` (reproduce el caso Huawei); si la unidad
    **sí** declara un contrato distinto al de la orden, sigue en
    `possible` (contradicción real preservada — equipo asignado sin
    contrato verificable vs. orden histórica frente a vínculo
    contradictorio, de la lista de pruebas pedida).
  - Contrato huérfano en almacén (reproduce el caso ZTE) → `possible`,
    motivo específico con "remanente"/"revertido", nunca el texto de
    "indicios de estar instalado"; un equipo devuelto sin remanente sigue
    `unknown` (caso normal, regresión); un contrato con cliente vinculado
    ya no se trata como huérfano (sigue su camino normal).
- `src/lib/__tests__/inventoryReconciliationReview.test.ts` (1 prueba
  nueva): el contrato huérfano nunca cae en tier 1, siempre tier 4, con el
  motivo específico exacto.
- Las 18 pruebas de conciliación + 5 de sesión existentes: sin cambios,
  siguen en verde. **26/26 en total.**
- `vue-tsc -p tsconfig.app.json`: sin errores.
- Verificación adicional contra los 3 casos **reales** (misma lectura de
  solo lectura ya hecha, reprocesada localmente con el clasificador
  corregido, sin nueva consulta a Cloud): confirma exactamente la tabla de
  arriba — evidencia en
  `scripts/inventory-auth-lab/runtime/inventory-false-positives-cloud-private.json`
  (privado, no comiteado, sin PII expuesta en este documento).

## Confirmación de alcance

Solo lectura (1 consulta `REPEATABLE READ READ ONLY` con `ROLLBACK`) +
corrección en la lógica de clasificación ya existente (`inventoryReconciliation.ts`/`inventoryReconciliationReview.ts`). Sin
escrituras, sin migraciones, RPC ni RLS. No se modificó ningún equipo,
existencia, movimiento, contrato ni orden real — el `contract_id`
remanente del ZTE **no se limpió**, queda documentado para que un
administrador lo revise manualmente (fuera del alcance de este cambio,
que es solo de presentación/clasificación). Commit local creado; **sin
push ni despliegue**.
