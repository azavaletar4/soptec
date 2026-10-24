# Confirmación administrativa de puntos — implementación local

Continuación autorizada de `506b35a` y `33879cc`, 24/10/2026.
No se repiten creación obligatoria, consulta de líder/ayudantes ni retirada
de firma. No hay cambios de OLT, MikroTik, pagos, liquidaciones o asignación.
Sin órdenes reales modificadas, migraciones en producción, push ni despliegue.

## Flujo implementado

Los tres detalles reutilizan `WorkOrderPointsEditor`. Después de terminar
técnicamente la orden, ADMIN/SUPERADMIN puede ajustar puntos con motivo o
confirmarlos en una sola transacción. El diálogo muestra total definitivo,
líder y ayudantes, sus partes iguales y el motivo cuando cambia el puntaje.
Exige marcar que puntos y distribución son correctos antes de enviar.

| Hecho existente | Confirmación de puntos | Contabilización oficial |
| --- | --- | --- |
| Trabajo abierto | Aún no disponible; conserva ajuste administrativo previo | Ninguna |
| Avería `resolved`/`closed`, Alta/Rutina `completed` | Disponible si hay fecha de terminación y cuadrilla | Ninguna hasta confirmar |
| Confirmación vigente | Puntos bloqueados y cuadrilla revisada conservada | Un aporte por integrante, dividido como antes |
| Reasignación posterior | Conserva puntos y distribución confirmados | No mueve ni duplica aportes |
| Reapertura/cancelación | Invalida la confirmación y conserva su historial | Retira el aporte de esa confirmación |
| Nueva terminación tras reapertura | Requiere nueva revisión y confirmación | Solo la nueva confirmación vigente aporta |

No se agregan estados técnicos ni se modifica su cierre. Confirmar puntos
no cambia el estado del trabajo. Pasar una Avería de `resolved` a `closed`
no acredita de nuevo ni invalida una confirmación vigente. Elegir `closed`
por el selector existente tampoco sustituye la confirmación de puntos.

La App de Campo sigue mostrando el puntaje **asignado** y la parte según la
asignación actual, como consulta operativa. El aporte definitivo usa la
cuadrilla que administración confirmó. Un ayudante agregado posteriormente
no recibe retroactivamente puntos ya confirmados; su consulta operativa no
equivale a acreditación. El detalle administrativo identifica el reparto
confirmado, aunque la asignación haya cambiado.

## Corte de prueba y periodo oficial

Se usa `2026-11-01 00:00:00 America/Lima` (`05:00 UTC`).

- Hasta octubre y anteriores, la función histórica se conserva íntegra y
  privada: mismas reglas, estados, fechas, categorías, cuadrillas y valores.
  No hay backfill ni puntuaciones inventadas para históricos NULL/0.
- Criterio conservador para no trasladar pruebas: **una orden creada antes
  del corte permanece fuera del cálculo oficial**, aunque termine o se
  reabra en noviembre. También queda fuera si terminó técnicamente antes
  del corte o si se confirmó antes de este. Se guardan ambas fechas originales
  revisadas en la confirmación; una reasignación no las altera.
- Una orden histórica terminada puede registrar una confirmación de prueba
  de su valor actual positivo, pero no modificar su puntuación histórica ni
  producir un aporte oficial. NULL/0 históricos no se sustituyen por estimaciones.
- En órdenes elegibles, el periodo oficial corresponde a la fecha de
  confirmación administrativa. Completar técnicamente un Alta/Rutina no
  genera puntos oficiales automáticamente.
- El endpoint mensual antiguo usa Lima **solo desde noviembre**. Antes del
  corte conserva sus límites de sesión originales, evitando reescribir
  resultados históricos. Los otros endpoints de periodos ya usaban Lima.

La invalidación por reapertura/cancelación recalcula los totales oficiales
de la confirmación retirada. Al reconfirmar, el aporte corresponde a la nueva
fecha de confirmación y cuadrilla revisada. El historial permite explicar
ese cambio; no se modifica, revierte ni recalcula ninguna liquidación pagada.

## Datos, permisos y reintentos

`work_order_point_confirmations` registra el hecho administrativo, no un
segundo saldo o libro de acumulación: puntos revisados, cuadrilla, fechas,
responsable y token de revisión. Un índice único parcial garantiza una sola
confirmación vigente por `(job_type,job_id)`. Los ciclos anteriores conservan
fecha, responsable y motivo automático de invalidación por estado técnico.

Las RPC exigen ADMIN/SUPERADMIN activo consultando `profiles`, sin confiar
en un rol enviado por el navegador. Técnicos, ayudantes, soporte, anónimos e
inactivos no pueden confirmar ni editar puntuación. La tabla no concede
INSERT/UPDATE/DELETE a usuarios de aplicación; RLS permite consultar el
historial administrativo solo a administradores activos.

La confirmación bloquea la fila del trabajo. La revisión compara estado,
puntuación, datos del trabajo, cuadrilla y ciclos anteriores. Si cambian,
exige recargar. El token es control de concurrencia, no credencial de acceso.
Repetir el mismo envío devuelve la misma confirmación sin volver a modificar
puntos, auditar ni repartir. Una solicitud distinta no sobrescribe una
confirmación vigente.

Los ajustes reutilizan `adjust_work_order_points`, su guarda en datos y
`work_order_point_changes`: anterior, nuevo, usuario, fecha y motivo. Se
amplía la elegibilidad a terminadas pendientes de confirmación, sin permitir
editar canceladas, puntuaciones históricas o confirmadas. Si falla el
registro final, se revierten también la edición y su auditoría.

Los cambios de asignación ya sincronizan la orden mediante los triggers
existentes. La confirmación no modifica esos triggers ni sus permisos. Su
bloqueo y lectura transaccional fijan la cuadrilla revisada; cambios posteriores
se conservan como asignaciones operativas sin transferir créditos anteriores.

## Fuente de puntos y reportes

Se mantiene `technician_point_contributions` como fuente única de aportes:
su tramo histórico llama a una copia privada de su definición previa y el
tramo oficial lee solo confirmaciones vigentes elegibles. No hay movimientos
de crédito adicionales ni sumas de eventos de auditoría.

Ranking, «Mi avance» y detalle personal siguen consumiendo esa fuente. Se
conservan reparto igualitario, conteos por integrante y la regla existente
de reincidencia: una penalización de 5 por avería original con otra avería
imputable dentro de siete días, repartida por la cuadrilla confirmada. No
se divide el conteo de trabajos. Los puntos manuales de una orden elegible
son el valor que administración confirma, incluida Alta o categoría «Otro».

Solo el apartado de puntos del reporte de tickets pasa a una RPC de lectura:

- Hasta octubre replica la suma manual/cohorte por creación/líder anterior,
  incluidos NULL/0 y estados abiertos. No corrige diferencias históricas
  que ese reporte ya tenía respecto al ranking.
- Desde noviembre utiliza aportes oficiales por fecha de confirmación.
  Las fechas sin zona del selector se interpretan en Lima para puntos oficiales;
  los demás agregados y consultas financieras quedan intactos.
- Una ventana mixta no suma una misma orden como prueba y oficial a la vez:
  si tiene aporte oficial en esa ventana, excluye su fila de prueba del
  apartado de puntos. Por ello mezclar prueba y oficial no equivale siempre
  a sumar ambos reportes separados; el texto de la vista explica sus bases.

## Archivos

- `supabase/migrations/20261024200000_work_order_point_confirmations.sql`
- `src/components/soporte/WorkOrderPointsEditor.vue`
- `src/lib/workOrderPoints.ts`, `src/lib/__tests__/workOrderPoints.test.ts`
- `src/stores/reports.ts`, `src/views/reportes/ReportesView.vue` (solo puntos)
- `server/tests/workOrderPointConfirmations.sql.test.ts`
- `server/tests/pointConfirmationRankingBaseline.sql` (consumidores SQL existentes, sin datos)
- `scripts/tests/point-confirmations-browser.mjs`
- `scripts/tests/work-order-points-browser.mjs` (adaptar fixtures a confirmaciones vigentes)
- Documentación de esta entrega y enlace desde la entrega anterior.

## Validación local

La batería focalizada combina confirmaciones nuevas, obligatoriedad y permisos
previos, cierres técnicos, devolución de Rutinas e idempotencia de evidencias:

```text
node --import tsx --test server/tests/workOrderPointConfirmations.sql.test.ts server/tests/workOrderPoints.sql.test.ts server/tests/closedOrders.sql.test.ts server/tests/routineReturns.sql.test.ts src/lib/__tests__/workOrderPoints.test.ts src/lib/__tests__/jobClosureIdempotency.test.ts
```

**95 pruebas aprobadas.** PostgreSQL efímero Docker sin red ni
datos reales. Los tiempos oficiales futuros de las fixtures se fijan únicamente
con el propietario del contenedor: la API no permite elegir la fecha de
confirmación ni escribir directamente esa tabla.

Chrome headless, red externa bloqueada y respuestas ficticias:

- 53 comprobaciones del editor real: ambos roles, tres clases, total/reparto,
  motivo, casilla obligatoria, doble clic y revisión obsoleta.
- 19 comprobaciones de regresión del editor previo con órdenes abiertas y
  confirmaciones vigentes.
- 35 comprobaciones de consulta para líder/ayudantes y canalización del store
  de cierre sin firma, conservando evidencias históricas.

Tipos y compilación local aprobados en los ensayos. Queda solo el aviso
existente de tamaño de chunks. No se certifica WebView Android ni funcionamiento
en producción; los mocks de navegador no sustituyen una prueba real de Supabase.

## Migraciones pendientes y riesgos de activación

Pendientes, en orden: `20261024180000` (obligatoriedad/auditoría),
`20261024190000` (lectura en Campo) y `20261024200000` (esta confirmación).
Ninguna se ejecutó en producción. La nueva candidata verifica el hash de la
fuente compartida observada previamente y aborta con rollback ante deriva;
requiere los consumidores de Mi avance ya instalados en la arquitectura actual.
No es una instalación independiente sobre una base vacía.

Una eventual activación debe coordinar DB y frontend: desde noviembre, una
orden sin confirmar deja de aportar. No activar únicamente el cálculo sin
poner disponible la revisión administrativa. Antes de autorizarla faltan
verificar el catálogo/ACL real contra el candidato, las tres clases con
sesiones reales, la entrega realtime y el formulario móvil completo en Android.
No se hizo ninguna de esas escrituras o validaciones funcionales en producción.
