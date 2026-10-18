# Diagnóstico: reemplazo de ONT en Averías (18/10/2026)

Diagnóstico de solo lectura (código local + consultas agregadas en Cloud,
`REPEATABLE READ READ ONLY`). Ningún archivo de producción, migración, RPC
de escritura ni despliegue se tocó. Continúa
`docs/INVENTARIO-CONCILIACION-AVERIAS-LECTURA.md`.

## Hallazgo principal: el reemplazo SÍ se registra, por una vía distinta a `ont_serial`

`work_order_closures.ont_serial` (lo que comparaba `defe251`) **nunca se
llena para Averías por diseño del formulario**, no por falta de disciplina
del técnico. En `CampoTrabajoDetailView.vue` el campo "Serial de la ONT
nueva" solo existe dentro de `isTrasladoRoutine` (Rutina de traslado, Fase
159) — para un cierre de ticket normal, `ontSerial` se envía siempre `null`
(línea ~1702). Por eso la cuantificación de la sesión anterior dio 0: estaba
comparando contra una fuente que el propio flujo de Averías nunca escribe.

El reemplazo real de equipo en una Avería se registra por una vía **ya
existente, estructurada y verificada por FK** — no por texto libre:

1. **Equipo entrante** — el técnico elige la nueva ONT/equipo **desde su
   propia custodia** (o bodega libre) en el formulario "Equipo entrante"
   (`incomingForm`, `CampoTrabajoDetailView.vue` ~L1078-1177). Llama a
   `campo_inventory_operation(action='stage')`
   (`supabase/migrations/20261017030000_fase164_custodia_tecnicos.sql` L288+),
   que exige que la unidad esté `in_stock` sin vínculo previo, o
   `with_technician` con `custody_technician_id` = el propio técnico.
   La unidad pasa a `status='pending_approval'`, vinculada a
   `client_id`/`contract_id`/**`ticket_id`** de la avería (confirma el punto
   3 del alcance: sí puede elegir desde custodia).
2. **Equipo retirado** — el técnico registra el equipo viejo en "Equipo
   saliente" (`outgoingForm`, ~L1057-1076), que exige que la unidad esté
   `status='assigned'` y coincida con el mismo cliente/contrato de la
   avería. Llama a `campo_inventory_operation(action='return')` con una
   condición (`in_stock`/`damaged`/`in_repair`) — confirma el punto 4.
3. **Un técnico no puede autoaprobar**: el equipo entrante queda en
   `pending_approval` hasta que ADMIN/SUPERADMIN (la función también admite
   el rol `SOPORTE`, que el proyecto ya no usa — nota menor, no urgente)
   lo revisa en `TicketDetailView.vue` (`ticketApprovalsStore.approveEquipment`
   / `rejectEquipment` → RPC `inventory_ticket_review`,
   `20261016220000_inventario_contextual_rls_admin.sql` L143). Aprobar pasa
   el equipo a `'assigned'`; rechazar lo regresa a `'in_stock'`.
4. **Sin duplicados, aplicado por trigger (no por convención)**:
   `apply_inventory_unit_event()` (mismo archivo de Fase 164, L144-282)
   bloquea con error explícito intentar `stage`/`assign` una segunda
   ONT para el mismo `contract_id` o `installation_id` mientras exista otra
   en `'assigned'`/`'pending_approval'` — el técnico está obligado a
   retirar la anterior antes de poder registrar la entrante. Esto confirma
   el punto 5 del alcance (contrato/inventario coherente, sin duplicados)
   **ya garantizado a nivel de base de datos**, no solo de UI.
5. **Distinguir avería con/sin reemplazo (punto 6)**: no hay un campo
   explícito tipo `ontReplaced` en Averías (ese flag es exclusivo de
   Rutinas/Traslado). La distinción es derivable de forma verificable:
   una avería tuvo reemplazo si existen filas en `inventory_unit_events`
   con su `ticket_id`; si no hay ninguna, no se tocó equipo.

## Información histórica aprovechable (punto 7) — ya existe, sin inventar nada

`inventory_unit_events` (con `ticket_id`, `to_status`, `created_at`,
`reason`) ya es el Kardex verificado de estos movimientos — mismo patrón que
el historial de alertas OLT. Lectura agregada real (solo conteos, sin datos
de clientes):

| Unidades con `ticket_id` vigente hoy | Estado | Cantidad |
| --- | --- | --- |
| | `assigned` | 10 |

| Eventos históricos con `ticket_id` | `to_status` | Eventos | Averías distintas |
| --- | --- | ---: | ---: |
| | `assigned` | 11 | 10 |
| | `pending_approval` | 12 | 10 |
| | `in_repair` | 1 | 1 |

Lectura: **0 unidades quedan hoy atascadas en `pending_approval`** — no hay
una cola de revisiones olvidadas en este momento. El flujo sí se usa en
producción (10 averías con reemplazo histórico confirmado), con integridad
referencial completa (`ticket_id` real, no serial de texto).

## Riesgo operativo real identificado

No es un defecto del flujo de reemplazo (que ya es sólido), sino de **la
Conciliación de Inventario**: su consulta no lee `inventory_units.ticket_id`
(columna que ya existe, usada por el propio RPC) — por eso una unidad
`pending_approval`/`assigned` que vino de una Avería aparece en el reporte
sin enlace directo a su ticket, a diferencia de una de Alta (que sí enlaza a
`/soporte/instalaciones/:id` vía `installation_id`). Hoy esto no bloquea
nada (0 pendientes en este momento), pero si algún día una unidad queda
atascada en `pending_approval`, el administrador tendría que buscar
manualmente en Soporte cuál avería la originó — contra la regla de
usabilidad de `CLAUDE.md` (acceso directo a la ficha correspondiente).

## Corrección mínima recomendada (no aplicada en esta sesión)

Agregar `ticket_id` al SELECT de `readInventoryReconciliation`
(`src/lib/inventoryReconciliation.ts`) y un enlace "Avería vinculada" en
`InventarioConciliacionView.vue` hacia `/soporte/:id`, exactamente con el
mismo patrón ya usado para `installation_id` → "Orden vinculada". Sin
columnas nuevas (ya existe), sin RPC, sin RLS, sin migración — sólo lectura
adicional y una línea de enlace en la vista. Impacto bajo, cero riesgo de
escritura.

**Sobre `defe251`** (comparación contra `work_order_closures.ont_serial`
para Averías): confirmado que seguirá en 0 resultados de forma estructural,
porque el formulario de cierre de Avería no envía ese campo — no es un
problema de disciplina de campo que se resuelva pidiendo el dato. Se
mantiene la recomendación de no desplegarlo; no aporta valor por esta vía.
Si se quiere cuantificar reemplazos por Avería, la fuente correcta es
`inventory_unit_events.ticket_id` (ya verificado arriba), no el serial de
texto.

## Confirmación de alcance

Solo lectura (código local + 2 consultas `REPEATABLE READ READ ONLY` con
`ROLLBACK`, agregados sin identificadores de cliente). Sin
`INSERT`/`UPDATE`/`DELETE`, sin RPC de escritura, sin migraciones, sin
cambios de RLS/permisos, sin push ni despliegue, sin tocar OLT/MikroTik.
