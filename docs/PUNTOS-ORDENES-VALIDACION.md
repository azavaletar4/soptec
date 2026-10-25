# Puntos obligatorios y ajuste administrativo — 24/10/2026

> Esta entrega describe `506b35a`. La continuación
> [PUNTOS-CAMPO-AJUSTE-FINAL.md](PUNTOS-CAMPO-AJUSTE-FINAL.md) sustituye sus
> cambios pendientes de contabilización/reportes: conserva históricos y detiene
> la acreditación oficial hasta resolver el cierre administrativo faltante.

Implementación local. Sin migraciones, escrituras ni despliegues en producción.
Referencia solicitada: `origin/main = f763d37b646a07ecbf70e354c8976ce96bae9d28`.
Se conservó el checkout recibido (`HEAD 84b9af7`), con sus cambios previos:
no se hizo reset, merge ni incorporación de archivos ajenos. Ambas ramas
divergen; este commit no pretende sincronizarlas ni está listo para push.

## Causa raíz y consulta histórica

Consulta acotada en una transacción `READ ONLY`, con
`default_transaction_read_only=on`, TLS verificado, timeout y rollback.
Solo conteos por categoría/estado y definición de las dos funciones de puntos.
No se exportaron clientes, nombres, órdenes ni credenciales al documento.

- 42 tickets: ninguno almacena 0; 38 tienen puntos NULL.
- 16 tickets resueltos pertenecen a categorías sin regla automática:
  15 `other` y 1 `installation`. Esas categorías aportaban 0 aun teniendo
  puntaje manual. Uno de esos 16 tiene puntuación manual positiva ignorada.
- El reporte de tickets usaba `points ?? 0`, de modo que también mostraba 0
  para NULL en averías con regla automática de 5/3 en el ranking.
- 77 rutinas: ninguna almacena 0; 8 completadas tienen puntos NULL y aportan 0.
- Altas no tiene columna de puntos: la fuente instalada asigna 10 fijos.

Los formularios/stores de tickets no exigían puntos. La BD aceptaba NULL y 0;
Rutinas únicamente exigía un valor positivo en el formulario (Fase 130).
El ranking respetaba el cero manual. No hay una única causa para todos los
ceros visibles y no corresponde asignar valores históricos por inferencia.

## Criterio y cierre operativo

Se reutiliza el criterio de Rutinas: puntuación positiva en la propia orden,
repartida por la fuente compartida `technician_point_contributions`.
No hay libro de puntos adicional ni sumas de eventos de auditoría.
Los valores 10/5/3, penalización de reincidencia y reparto de cuadrilla
conservan su escala y reglas. Pagos y bonificaciones no se modifican.

La App de Campo envía `resolved` para tickets y `completed` para Altas y
Rutinas. Ya son estados computables y bloquean la edición técnica; no existe
un cierre administrativo posterior separado. No se modificó ese flujo.

El ajuste se permite **antes de ese cierre**: `open`, `pending`, `scheduled`,
`in_progress` y `rescheduled` cuando el tipo los admite. Se bloquean
`resolved`, `closed`, `completed` y `cancelled`, incluso para SUPERADMIN.
El editor/RPC no reabre órdenes ni ofrece una aprobación nueva.
Las herramientas excepcionales de reapertura existentes no se modifican;
una orden reabierta vuelve a ser abierta para este criterio.

Si se pretende ajustar después de que el técnico termine, esa parte queda
detenida: requiere definir otro límite de congelación de puntos. La propuesta
mínima sería separar la finalización de puntos del estado técnico, conservando
el cierre actual. Eso implica una decisión operativa adicional y **no se ha
implementado** ni se ha introducido una etapa de aprobación.

## Cambios

- Creación manual de Averías y Altas: puntos obligatorios en formulario y
  store. La conversión automática de prospecto conserva explícitamente
  los 10 puntos que ya correspondían al Alta; solo se toca esa llamada de
  creación en Clientes, sin cambiar el resto de su módulo.
- Rutinas: se conserva la exigencia de creación. Al editar otros datos no se
  reenvía el puntaje; el ajuste con motivo se hace desde su detalle.
- Editor común para los tres detalles: solo ADMIN/SUPERADMIN antes del cierre,
  motivo obligatorio, errores visibles y últimos 20 ajustes auditados.
- Migración candidata: columna nullable de Altas sin backfill, validación de
  inserciones de los tres tipos y bloqueo de modificaciones directas sin
  rol/motivo. Las actualizaciones ajenas a puntos de históricos NULL/0 no se
  bloquean, incluido el cierre técnico.
- RPC transaccional con bloqueo de fila y comparación del valor anterior;
  rechaza un ajuste obsoleto y puntos no finitos. Tickets conserva enteros.
- No se encontró auditoría genérica para puntos. Se reutiliza el patrón
  append-only/RLS de `routine_returns` e `installation_postponements` en
  `work_order_point_changes`: anterior, nuevo, responsable, fecha y motivo.
  El registro y la actualización se revierten juntos ante error.
- La fuente compartida usa el valor de Altas con fallback histórico 10 y
  respeta puntos manuales en categorías de ticket sin regla automática.
  Mantiene NULL histórico como 0 en esas categorías y en Rutinas.
- Reporte de tickets: reutiliza esa misma fuente y su reparto/penalización;
  conserva la selección por fecha de creación del reporte y solo puntúa
  tickets terminados. Ranking y Mi avance mantienen su selección por cierre.
  La diferencia de cohortes se hace explícita en el reporte.

## Archivos del cambio

Producción candidata:

- `supabase/migrations/20261024180000_work_order_points.sql`
- `src/lib/workOrderPoints.ts`
- `src/components/soporte/WorkOrderPointsEditor.vue`
- `src/types/domain.ts`
- `src/stores/tickets.ts`, `installations.ts`, `routines.ts`, `reports.ts`
- `src/views/soporte/OperacionesHoyView.vue`, `TicketDetailView.vue`,
  `RutinasView.vue`, `RoutineDetailView.vue`
- `src/views/instalaciones/InstalacionesView.vue`, `InstalacionDetailView.vue`
- `src/views/clientes/ClientesView.vue` (solo creación de Alta de conversión)
- `src/views/reportes/ReportesView.vue`

Validación/documentación:

- `server/tests/workOrderPoints.sql.test.ts`
- `server/tests/workOrderPointsContributionBaseline.sql` (definición SQL sin datos)
- `src/lib/__tests__/workOrderPoints.test.ts`
- `scripts/tests/work-order-points-readonly.sql`
- `scripts/work-order-points-readonly.ps1`
- `scripts/tests/work-order-points-browser.html`, `work-order-points-browser.mjs`
- Este documento.

## Pruebas y límites

59 pruebas aprobadas con:

```text
node --import tsx --test server/tests/workOrderPoints.sql.test.ts src/lib/__tests__/workOrderPoints.test.ts server/tests/closedOrders.sql.test.ts server/tests/routineReturns.sql.test.ts
```

PostgreSQL efímero Docker, sin red ni datos reales. Se prueban creación sin
puntos/NULL/0/negativos, valores válidos, ajustes de ambos roles administrativos,
rechazos de técnico/soporte/otros/sin sesión/inactivos, motivo, auditoría,
valor obsoleto, no-op sin duplicado, estados terminales, históricos intactos,
reparto, valor final tras dos ediciones y no duplicación al pasar de resolved
a closed. Las suites previas de cierres y devolución de Rutinas pasan sin cambios.
El primer ensayo falló solo por comparar representaciones textuales de numeric;
se corrigió la expectativa a comparación numérica y se repitió con éxito.

`vue-tsc -b --pretty false` y `vite build` aprobados. Vite advierte por tamaño
de chunks existentes. Chrome headless: 19 comprobaciones aprobadas sobre el
editor Vue real: los tres tipos aceptan enteros válidos, motivo obligatorio,
envío de valor anterior y tipo correcto, ocultación para técnico/soporte y
estados terminales, sin excepciones JavaScript. Datos ficticios, Vite loopback
y bloqueo de toda red externa. Comando: `node scripts/tests/work-order-points-browser.mjs`.
No se certifica WebView Android real.

## Riesgos antes de una eventual activación

- Migración candidata **no aplicada**: frontend y funciones nuevas deben
  activarse de forma coordinada. Este trabajo no está activo en producción.
- La migración verifica el hash de la fuente compartida observada en solo
  lectura y aborta ante deriva o ausencia, sin dejar cambios parciales.
- El ticket histórico con puntos positivos ignorados pasará a aportarlos al
  respetar el puntaje manual. No cambia su fila; sí cambia el cálculo de su
  periodo. Los 15 tickets NULL de esas categorías y las 8 rutinas NULL
  conservan su aporte cero; no se ha inventado ningún valor.
- El reporte de tickets dejará de sumar órdenes abiertas y de atribuir todo
  al líder: usa la fuente existente para reparto y reincidencias. Es una
  corrección del reporte, sin cambios en asignación de técnicos/cuadrillas.
- Una edición administrativa y un cierre usan el bloqueo transaccional de la
  misma fila: el ajuste solo puede ganar mientras la orden siga abierta.
- No hubo corrección masiva, modificación de órdenes reales, migración en
  producción, push ni despliegue. Los cambios previos quedan fuera del commit.
