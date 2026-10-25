# Cierre administrativo definitivo y puntos oficiales — 25/10/2026

Continuación de `bd4a567`. Esta entrega sustituye su invalidación/reconfirmación
por cierre administrativo **definitivo**. Estado: código y pruebas locales;
no aplicado ni desplegado. Ninguna orden o cliente real fue modificado.

## Decisiones vigentes para continuar la próxima sesión

- Una confirmación administrativa cierra definitivamente la orden. No permite
  reapertura, cancelación, eliminación, cambio de categoría, fechas, datos o
  cuadrilla por flujos ordinarios, tampoco a SUPERADMIN.
- La finalización técnica sigue siendo `resolved` en Averías y `completed`
  en Altas/Rutinas. Una Avería heredada en `closed` tampoco sustituye por sí
  sola la confirmación administrativa. No se crean estados técnicos nuevos.
- Antes de confirmar se conservan correcciones, ajustes auditados y la
  edición excepcional existente de SUPERADMIN. Una nueva incidencia después
  del cierre requiere **otra orden**.
- Se conserva el registro de confirmación existente. No hay otra tabla de
  acumulación ni otro estado de aprobación. La unicidad pasa a ser por orden
  para siempre, no únicamente mientras una confirmación sea vigente.
- Se guardan total, categoría, cuadrilla, descuento existente y partes
  individuales brutas/netas. La fuente oficial lee esos importes guardados;
  no vuelve a dividir ni a buscar incidencias posteriores para recalcularlos.

## Revisión acotada de flujos y permisos

| Acceso real | Pendiente de confirmación | Después del cierre administrativo |
| --- | --- | --- |
| Selectores de estado de Averías/Altas y modal de Rutinas | Conservan permisos previos | Frontend bloqueado y UPDATE rechazado en datos |
| Edición excepcional de SUPERADMIN en Altas | Disponible como antes | No puede habilitarse para una orden definitiva |
| `adjust_work_order_points` | ADMIN/SUPERADMIN, motivo y auditoría existentes | Rechazo por guarda común |
| `return_ticket` (Fase 99, SECURITY DEFINER) | Conserva el comportamiento previo | Bloquea liberar cuadrilla/reabrir; se revierte también la nota del intento |
| `return_routine` / `postpone_installation` | Técnicos asignados en progreso, como antes | Rechazo; tampoco pueden forzarse a `in_progress` previamente |
| Escritura directa por API en las tres órdenes | RLS y permisos anteriores | Triggers rechazan UPDATE y DELETE incluso desde una RPC SECURITY DEFINER |
| `job_assignees`, incluyendo mover filas entre órdenes | Sin cambios de permisos | INSERT/UPDATE/DELETE rechazados si cualquiera de las órdenes afectadas es definitiva |
| Borrado de tickets pendientes | Conserva devolución Fase 59 | DELETE se rechaza antes de ejecutar devoluciones |

Las guardas no dependen de un formulario ni de una bandera enviada por el
cliente. Bloquean también cambios parciales, cambios sin diferencia y fechas
que pudieran trasladar el periodo. La cuadrilla bloquea la misma fila de orden
que usa la confirmación, evitando que una escritura concurrente la cambie
después de quedar revisada.

No se encontró una operación legítima que requiriese reabrir una orden **ya
confirmada definitivamente**. Las correcciones pendientes siguen disponibles
y se probaron. Las aprobaciones de fotos actúan sobre sus propias tablas;
no se modificaron sus permisos ni los archivos históricos. No se añadieron
guardas generales a fotos, inventario, clientes, contratos o evidencias.

Los stores comprueban el cierre antes de enviar cambios. Campo también lo
comprueba antes de contratos/GPS/subidas, de modo que un reintento de una
orden ya definitiva no empieza esa cadena de escrituras. Las colas y firmas
históricas no se eliminan. Si otro cliente confirma mientras una vista está
abierta, la guarda en datos sigue siendo la autoridad final.

### Eliminación y materiales

Se detectó una secuencia insegura en `tickets.ts`: insertaba devoluciones
desde JS antes del DELETE. La base ya tiene la devolución transaccional
Fase 59 (`reverse_inventory_on_ticket_delete` / `reverse_egreso_movements`).
Se retiran únicamente esas inserciones anticipadas del store: el DELETE usa
el mecanismo existente. Así una eliminación rechazada no deja compensaciones
aplicadas ni duplica las que ya genera el trigger. No se modifica el módulo
de inventario ni sus funciones. Se prueba el código SQL real de Fase 59.

## Puntos congelados y reincidencias

`bd4a567` guardaba el total y la cuadrilla, pero la fuente aún calculaba una
penalización al aparecer después otra avería. Eso contradice el congelamiento
definitivo ahora solicitado.

La regla de 5 puntos por reincidencia se evalúa **al revisar/confirmar**. Si
ya corresponde, el diálogo muestra descuento, neto y reparto antes de exigir
la confirmación expresa. Si aparece entre revisión y envío, cambia el token
y obliga a revisar otra vez. Su importe queda guardado en
`recurrence_penalty` y en las partes de cada integrante dentro del JSON ya
existente `crew`. Una incidencia posterior, o una corrección de la otra orden,
no modifica ese descuento ni el aporte anterior. No se cambian pagos.

Los puntos brutos, el descuento y los netos se leen de la instantánea de la
confirmación; categorías/asignaciones actuales ya no intervienen en el aporte
oficial. No se crean movimientos de crédito paralelos. Se conserva
`technician_point_contributions` como única fuente de ranking y Mi avance.

## Fecha real del periodo y corte

Se contrastaron las definiciones y consumidores existentes, no solo las
etiquetas de estado:

- Histórico de ranking/Mi avance: finalización técnica, con
  `coalesce(resolved_at,closed_at)` para tickets y `completed_at` para Altas/Rutinas.
- Reporte histórico de tickets: cohorte por `created_at` y suma manual del
  líder, que ya difería del ranking. Se conserva esa base histórica.
- Oficial: `confirmed_at`, generado por la base al confirmar administrativamente.
  Los límites oficiales son de America/Lima.

El corte es `01/11/2026 00:00 America/Lima = 01/11/2026 05:00 UTC`.
Se conserva el criterio conservador de `bd4a567`: creación, finalización
técnica y confirmación deben estar desde el corte para aportar oficialmente.
Las órdenes de prueba de octubre no se trasladan al oficial por confirmarse
después. Ni se reabren para cambiarles las fechas después de confirmar.

No hay backfill, borrado de puntos ni corrección masiva. La fórmula histórica
de prueba anterior al corte se conserva en la función privada heredada,
incluidas sus diferencias previas; no se declara congelado ni reescribe ese
reporte de prueba como si fuera contabilidad oficial. El endpoint mensual
solo usa el nuevo límite Lima desde noviembre; los históricos mantienen su
interpretación anterior. Los conteos operativos del reporte conservan creación.

## Compatibilidad: siguen siendo tres migraciones pendientes

1. `20261024180000_work_order_points.sql`: columna de Altas, creación obligatoria,
   auditoría y guardas iniciales. No se repite ni se reescribe su implementación.
2. `20261024190000_field_order_points_readonly.sql`: lectura para líder y ayudantes,
   independiente de la acreditación oficial. No se altera.
3. `20261024200000_work_order_point_confirmations.sql`: candidata **revisada aquí**.
   Confirmación definitiva, unicidad permanente, guardas de orden/cuadrilla,
   instantánea de importes y lectura oficial. Ya no instala invalidación automática.

No se agrega una cuarta migración, tabla o estado técnico. Estas candidatas
siguen sin ejecutarse en Supabase productivo. La revisión sustituye un SQL
pendiente; **no** debe aplicarse encima de una variante anterior de 20261024200000
ya instalada. Si otro entorno la aplicó, debe resolverse ese historial antes.

La tercera requiere la fuente/consumidores de Mi avance de la arquitectura
actual y verifica su hash esperado, abortando ante deriva. No es un bootstrap
independiente de una base vacía. Las tres se instalaron en ese orden en la
prueba aislada. El borrado de tickets depende además del trigger Fase 59 ya
existente; comprobar su instalación real antes de una futura activación.

El frontend exige la marca `definitiveClosure` de la RPC revisada. Si falta o
no puede consultar el cierre, no ofrece edición/confirmación contra una
versión anterior que todavía permitiera reabrir. Deben coordinarse DB y UI.

## Archivos de esta entrega

- `supabase/migrations/20261024200000_work_order_point_confirmations.sql`
- `src/lib/workOrderFinality.ts`, `src/composables/useWorkOrderFinality.ts`
- `src/components/soporte/WorkOrderPointsEditor.vue`, `src/lib/workOrderPoints.ts`
- `src/stores/tickets.ts`, `installations.ts`, `routines.ts`, `campo.ts`
- `src/views/soporte/TicketDetailView.vue`, `RutinasView.vue`
- `src/views/instalaciones/InstalacionDetailView.vue`
- `server/tests/workOrderPointConfirmations.sql.test.ts`
- `scripts/tests/point-confirmations-browser.mjs`, `work-order-points-browser.mjs`
- `scripts/tests/field-order-points-browser.html`, `field-order-points-browser.mjs`
- Este documento y referencia desde `docs/CONFIRMACION-ADMINISTRATIVA-PUNTOS.md`.

## Pruebas y límites

**99 pruebas aprobadas** en PostgreSQL efímero sin red ni datos reales:

```text
node --import tsx --test server/tests/workOrderPointConfirmations.sql.test.ts server/tests/workOrderPoints.sql.test.ts server/tests/closedOrders.sql.test.ts server/tests/routineReturns.sql.test.ts src/lib/__tests__/workOrderPoints.test.ts src/lib/__tests__/jobClosureIdempotency.test.ts
```

Incluyen las tres clases, ADMIN/SUPERADMIN/líder/ayudante, cierre técnico sin
aporte automático, ajuste auditado, casilla explícita, cierre único concurrente,
intentos directos y SECURITY DEFINER, bloqueo de fechas/categoría/cuadrilla,
correcciones pendientes, RPCs reales de devolución/postergación, reparto de
dos/tres integrantes, corte Lima, NULL/0 históricos, nueva avería sin recálculo
y devolución transaccional Fase 59 sin efectos al rechazar un DELETE.

Los relojes oficiales de fixtures se preparan solo como propietario del
contenedor: la API no recibe una fecha de confirmación elegida por el cliente.
No se deshabilitan guardas de producción ni se utiliza una orden real.

La suite anterior valida también las etapas 18/19 aisladas; la suite de
confirmación instala las tres candidatas y verifica el resultado definitivo.
La última ejecución específica de esta suite pasó sus 25 pruebas.

Navegador: **133 comprobaciones aprobadas** (64 de confirmación definitiva,
50 de Campo/stores y 19 de regresión del editor). Incluyen netos con descuento,
bloqueo de versiones antiguas, rechazo previo a PATCH/DELETE, consulta para
líder/ayudante y conservación de firma histórica. El primer ensayo de netos
requirió corregir la expectativa decimal del test a `es-PE` (`3.5`); se repitió
con éxito. Se usan componentes/stores reales con API ficticia y red externa
bloqueada; no sustituyen Supabase ni el formulario Android entero.

Tipos (`vue-tsc -b --pretty false`) y `vite build` aprobados. Permanece el aviso
preexistente de tamaño de chunks.

## Estado y siguiente paso

Implementación local recogida en el commit de esta entrega; sin push/despliegue/migración.
El trabajo previo ajeno al alcance queda fuera del commit. No se tocaron
MikroTik, OLT, facturación, liquidaciones ni evidencias históricas.

Antes de una activación autorizada siguen pendientes: verificar catálogo,
hash y ACL reales; disponer rollback coherente de DB/UI; probar con sesiones
reales los tres tipos, los controles de reapertura, el transporte realtime,
una orden pendiente y un cierre definitivo, sin mezclar pruebas de octubre
con el periodo oficial. No declarar esas comprobaciones como realizadas aquí.
