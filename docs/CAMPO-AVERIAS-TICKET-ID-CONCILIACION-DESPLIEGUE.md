# Corrección mínima: Conciliación enlaza la Avería vinculada (18/10/2026)

Implementa localmente la corrección mínima identificada en
`docs/CAMPO-AVERIAS-REEMPLAZO-ONT-DIAGNOSTICO.md`. Sin migraciones, RPC,
RLS ni escrituras — `inventory_units.ticket_id` ya existía, solo faltaba
leerlo y mostrarlo.

## Cambios

- `src/lib/inventoryReconciliation.ts`: suma `ticket_id` al `SELECT`
  existente de `inventory_units` (misma consulta ya usada por `defe251`,
  sin consulta nueva) y resuelve `ticket_id` contra el mismo arreglo
  `tickets` que ya se leía para los cierres de Avería — reutilización
  exacta, cero duplicación. Expone `row.ticket` (el registro de Avería,
  si existe) junto a una verificación `ticketVerified` (mismo cliente y,
  si ambos la tienen, mismo contrato). Nunca sube la clasificación a
  `'installed'` por sí solo: `ticket_id` entra al mismo criterio que ya
  usaba `installation_id` para decidir `'possible'` vs `'unknown'`. Si el
  vínculo no coincide en cliente/contrato, se agrega una razón explícita
  de advertencia ("vínculo documental sin confirmar") en vez de tratarlo
  como coincidencia.
- `src/views/inventario/InventarioConciliacionView.vue`: nueva línea
  "Avería vinculada" (enlace a `/soporte/:id`, mismo patrón que "Orden
  vinculada" → `/soporte/instalaciones/:id`) cuando el vínculo está
  verificado; si no lo está, un aviso en texto plano sin enlace.
- `src/lib/__tests__/inventoryReconciliation.test.ts`: 2 pruebas nuevas
  (12/12 en verde) cubriendo exactamente los casos pedidos: ONT vinculada
  a Avería con contrato coherente (pendiente de aprobación, nunca
  `'installed'`), ONT vinculada a Alta (sin cambios), ONT sin ticket,
  ticket de otro cliente (vínculo documental, nunca confirmado), ONT
  retirada (sin vínculo que mostrar porque el trigger real limpia
  `ticket_id`), y una prueba de regresión de que no se duplican consultas
  ni se alteran las unidades de entrada.

`vue-tsc -p tsconfig.app.json`: sin errores.

## Diferencias reales (lectura, mismo guion `inventory-reconciliation-cloud-readonly.ps1`)

Lectura `REPEATABLE READ READ ONLY`, 2026-10-18 03:18:13 UTC, agregados sin
identificadores de cliente:

| Categoría | Unidades con `ticket_id` vigente | Verificadas (cliente coincide) | Con conflicto | Pendientes de aprobación |
| --- | ---: | ---: | ---: | ---: |
| ONT | 5 | 5 | 0 | 0 |
| TV Box | 5 | 5 | 0 | 0 |
| Mesh | 0 | 0 | 0 | 0 |

**10 unidades reales (5 ONT + 5 TV Box) pasan a mostrar "Avería vinculada"
con enlace directo al ticket** — hoy en producción solo mostraban
cliente/contrato, sin indicar qué avería trajo ese equipo. Las 10 están
verificadas (mismo cliente que su avería) y 0 están pendientes de
aprobación en este momento — no hay casos ambiguos ni conflictivos que
mostrar todavía, pero la corrección queda lista para marcarlos
("vínculo documental sin confirmar") en cuanto aparezca uno.
Clasificaciones (`installed`/`custody`/`possible`/`unknown`) idénticas a la
lectura anterior — la corrección es puramente informativa, no reclasifica
nada.

Detalle completo: `docs/INVENTARIO-CONCILIACION-AVERIA-TICKET-LINK-RESUMEN.json`.

## Confirmación de alcance

Solo lectura (código local + 1 consulta `REPEATABLE READ READ ONLY` con
`ROLLBACK`, reutilizando el mismo guion ya autorizado). Sin
`INSERT`/`UPDATE`/`DELETE`, sin RPC, sin migraciones, sin cambios de
RLS/permisos, sin push ni despliegue. No se tocó el flujo de reemplazo
(`campo_inventory_operation`/`inventory_ticket_review`), Altas, Custodia,
TV Box ni Kardex.
