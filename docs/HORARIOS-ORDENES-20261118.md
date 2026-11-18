# Consistencia de programación de Averías, Altas y Rutinas

Implementación local del 18/11/2026. Rama `fix/horarios-ordenes-20261118`, base `aafd21f`. Sin merge, push, despliegues, migraciones remotas ni operaciones sobre órdenes reales.

## Diagnóstico específico

| Módulo | Formularios y almacenamiento real en PostgreSQL | Causa de la inconsistencia |
| --- | --- | --- |
| Averías | Alta: `OperacionesHoyView.vue`. Edición administrativa: `TicketDetailView.vue`, cronograma y formulario de reprogramación. `tickets.scheduled_start_at` / `scheduled_end_at`: `timestamptz`; `rescheduled_to`: `timestamptz`, con `reschedule_reason` para cliente ausente. No existen columnas `scheduled_date`, `scheduled_time` ni `turno` en tickets. | Los turnos de creación se guardaban, pero `campo.fromTicket()` elegía `created_at`. La tarjeta de Campo mostraba solo esa fecha; el detalle y el listado de Operaciones no presentaban la programación. La reprogramación tenía conversión dependiente del navegador y su timestamp independiente podía discrepar del turno original. |
| Altas | Alta: `InstalacionesView.vue`. El detalle `InstalacionDetailView.vue` tenía estado, notas y cuadrilla, sin un editor dedicado de programación. `installations.scheduled_date`: `date`; `scheduled_time`: `time without time zone`; además `scheduled_start_at` / `scheduled_end_at`: `timestamptz`. | Crear guardaba fecha/hora puntual, pero no los timestamps. El cronograma editaba timestamps y no actualizaba los campos anteriores. Administración y Campo podían leer representaciones diferentes; Campo omitía la hora. No existe un trigger que sincronice ambos modelos en las migraciones del repositorio. |
| Rutinas | Alta/edición: `RutinasView.vue`; detalle: `RoutineDetailView.vue`; edición de rango: cronograma. `routines.scheduled_date`: `date`; `scheduled_start_at` / `scheduled_end_at`: `timestamptz`. No existe columna persistida de turno ni `scheduled_time`. | La creación convertía el turno a timestamps correctamente si el navegador estaba en Perú. La edición inicializaba `schedule_turno: ''` y el guardado escribía ambos timestamps como `null`, incluso al editar otros datos. El listado mostraba solo fecha. Campo conservaba `raw`, pero omitía el rango en su tarjeta y detalle. |

Los turnos son opciones de interfaz en `src/lib/turnos.ts`: 08–10, 10–12, 12–14, 14–16 y 16–18. Su nombre no se almacena en una columna; se guardan los instantes de inicio y fin. Altas pide una hora puntual. La ventana de una hora usada para advertir conflictos es una estimación del chequeo; la solución no la transforma en una duración programada inventada.

Recorrido verificado en los tres módulos: formulario → store Pinia → Supabase JS → API PostgREST (`insert`/`update`) → columnas PostgreSQL → `.select('*', joins)` → store → adaptación a `TrabajoItem.raw` → tarjeta y detalle de Campo. No hay una ruta Hono intermedia que transforme estos campos. Las consultas de los tres stores ya recuperan todas las columnas de programación; no era necesario cambiar sus proyecciones ni la API.

El helper de conversión anterior dependía de la zona del navegador. El cronograma también comparaba días UTC recortando el ISO y usaba horas locales del dispositivo para colocar bloques. Los filtros de Altas y Rutinas calculaban «Hoy» en la zona del equipo. Se corrigieron estos puntos para la programación peruana.

`RUT-2026-00223` se utilizó únicamente como referencia suministrada: 18/11/2026, 10:00–12:00, sin técnico. No se consultó ni modificó su fila productiva. Se reprodujo el caso con una rutina sintética. Sin asignación, una rutina pendiente/programada corresponde a «Disponibles», no a las órdenes propias de un técnico. Los filtros de líder/apoyo y las reglas de toma de órdenes se conservan.

## Corrección

- `workOrderSchedule.ts` concentra lectura, presentación y payloads de programación. Timestamps con zona se muestran en `America/Lima`; fecha/hora de los formularios se convierten usando el offset peruano explícito `-05:00`. No se usa `created_at` como cita.
- `WorkOrderSchedule.vue` muestra la misma fecha y hora/rango en Operaciones, listados de Altas y Rutinas, detalles administrativos, tarjeta y detalle de Campo. Una orden sin programación lo indica; con fecha pero sin hora, muestra «Sin horario programado».
- `WorkOrderScheduleEditor.vue` permite editar la programación de Averías y Altas desde sus detalles con las restricciones de edición existentes y la comprobación de cierre del store. Solo escribe campos de programación. Altas conserva hora puntual; si ya había un rango explícito del cronograma, se conserva y presenta ese rango.
- Rutinas precarga «Conservar» con su programación actual. Guardar sin cambiar la programación mantiene exactamente sus timestamps, incluidos rangos personalizados, incompletos y nocturnos. Cambiar solo la fecha traslada el rango conservando horas y duración. Elegir un nuevo turno reemplaza la programación; «Sin agendar» permite quitarla explícitamente.
- Nuevas Altas y cambios desde el cronograma sincronizan fecha/hora legadas con timestamps. Para órdenes históricas, un timestamp explícito tiene prioridad y, si falta, se leen fecha/hora legadas. No se modifica masivamente ninguna fila.
- En una Avería con estado `rescheduled`, prima `rescheduled_to`. No se mezcla el fin del turno anterior con una cita posterior independiente. Los editores de reprogramación sincronizan la nueva cita con `scheduled_start_at` y dejan fin vacío cuando solo se eligió una hora. Así la cita no retrocede al iniciar nuevamente la atención. Un rango explícito alineado con esa cita se muestra completo.
- El cronograma muestra fecha/rango también en las reservas sin técnico. Su sección se denomina «Programación o asignación por completar», evitando describir una reserva con horario como si careciera de él.
- Los filtros de Altas y Rutinas reciben explícitamente `America/Lima`. El comportamiento de otros consumidores de `DateRangeFilter` no cambia.

No se cambiaron reglas de estados, asignación, materiales, fotos, inventario, validaciones de cierre ni exclusividad de trabajos activos. La transición ya existente de «Cliente Ausente» conserva sus cambios de estado/prioridad; solo se sincronizan sus campos de cita.

## Pruebas y resultados

| Prueba | Resultado y límite |
| --- | --- |
| `node --import tsx --test src/lib/__tests__/workOrderSchedule.test.ts` | 7/7. Conversión/presentación en Lima, UTC, Tokio y Los Ángeles; mañana/tarde; edición de rutinas, rangos nocturnos y personalizados; prioridad de campos; citas ausentes; validación de rangos. |
| `node scripts/tests/work-order-schedule-browser.mjs` | 91 comprobaciones. Chrome real, escritorio y móvil; vistas, formularios, router y stores reales; REST sintético persistido en `sessionStorage`, con red externa bloqueada. Navegador en Tokio y reloj fijado cuando en Tokio ya es 19 y en Perú aún es 18. |
| `node --import tsx --test server/tests/workOrderSchedule.sql.test.ts` | 11/11. PostgreSQL 17 efímero, `--network none`, datos sintéticos. Creación, edición y relectura de los tres tipos, con y sin técnico; mañana/tarde; históricas; hora puntual legada y rango nocturno. Usa declaraciones de columnas extraídas de las migraciones del repositorio. |
| `node --import tsx --test server/tests/singleActiveJob.sql.test.ts server/tests/closedOrders.sql.test.ts server/tests/workOrderPhotoApproval.sql.test.ts` | 41/41 regresiones existentes, en PostgreSQL aislado. Exclusividad cruzada y concurrente, cuadrillas, permisos sobre estados/cierres, inventario asociado y aprobación de fotos. Se ejecutan las migraciones/fixtures de esas suites; no equivalen a una auditoría de todas las políticas productivas. |
| `npm.cmd run build` | TypeScript y compilación Vite correctos. Advertencia existente de chunks de más de 500 kB. |
| `git diff --check` | Sin errores de whitespace. |

Para cada tipo, el navegador comprobó: crear mañana con técnico y tarde sin técnico; payload de programación; recargar recreando stores; listado administrativo; editar horario; detalle administrativo; tarjeta y detalle de Campo del asignado; detalle disponible del no asignado; histórica sin horario. Altas y Rutinas incluyen fecha sola. Averías no dispone de una columna para guardar una fecha sola sin hora.

También se comprobaron el bloqueo de edición administrativa del técnico, rechazo de guardado tras cierre administrativo sin emitir PATCH, conservación de Rutina al editar descripción, sincronización de los tres tipos desde el cronograma, reserva sin técnico y edición de reprogramación en Perú. «Cliente Ausente» mantiene técnico y prioridad/estado previstos, propone mañana a las 08:00 de Perú y conserva la nueva cita al retomar la atención.

La prueba del navegador simula PostgREST; la persistencia PostgreSQL se verifica por separado en un contenedor. No se ejecutó una validación integral contra la instalación productiva de Supabase ni contra dispositivos reales.

## Archivos

Código de producto:

- `src/lib/workOrderSchedule.ts` (nuevo), `src/lib/turnos.ts`, `src/lib/scheduleConflict.ts`.
- `src/components/soporte/WorkOrderSchedule.vue` y `WorkOrderScheduleEditor.vue` (nuevos), `DateRangeFilter.vue`.
- `src/stores/campo.ts`, `src/composables/useUnifiedJobs.ts`.
- `src/views/soporte/OperacionesHoyView.vue`, `TicketDetailView.vue`, `RutinasView.vue`, `RoutineDetailView.vue`, `DispatchBoardView.vue`.
- `src/views/instalaciones/InstalacionesView.vue`, `InstalacionDetailView.vue`.
- `src/views/campo/CampoDashboardView.vue`, `CampoTrabajoDetailView.vue`.

Pruebas nuevas:

- `src/lib/__tests__/workOrderSchedule.test.ts`.
- `server/tests/workOrderSchedule.sql.test.ts`.
- `scripts/tests/work-order-schedule-browser.mjs`, `work-order-schedule.fixture.mjs`, `work-order-schedule.html`.

Este informe: `docs/HORARIOS-ORDENES-20261118.md`.

## Git, compatibilidad y producción

Se creó una rama/worktree desde el commit local `aafd21f`; no se incorporaron cambios ajenos. Al iniciar, el checkout principal estaba en `fix/altas-exigir-contrato-20261113`, con `scripts/consolidation-release-contract.py` modificado y `deploy/altas-contrato-obligatorio-20261113/` sin seguimiento. Esos trabajos se conservan. El worktree del balanceador se verificó limpio y no fue modificado.

Worktree final: `D:/SmartRayco/scripts/inventory-auth-lab/runtime/horarios-ordenes-worktree`, dentro de la carpeta de trabajo ya ignorada. Commit local específico de esta rama: contiene código, pruebas e informe; su identificador se informa al entregar.

No se requieren migraciones ni campos nuevos. Compatibilidad: fecha/hora legadas en Altas, valores nulos e históricos, y rangos de cronograma en los tres tipos. No puede reconstruirse un turno que una edición anterior ya borró ni inferirse la intención de registros históricos contradictorios. La prioridad de timestamps es explícita y solo futuras ediciones sincronizan representaciones.

Los mecanismos existentes que autocompletan horario de una Avería al iniciar/atender sin cita permanecen intactos; preservan el inicio ya programado. El esquema no registra la procedencia administrativa o automática del timestamp histórico. No se hace una inferencia adicional sobre su origen ni se usa la fecha de creación como alternativa.

Estado: corrección y aceptación local verificadas para los tres módulos. Producción pendiente: revisar el commit e integrarlo con las demás fases; construir/publicar el frontend mediante el procedimiento autorizado y validar lectura en administración y Campo. No se realizó merge ni push, ni se publicó ningún artefacto.
