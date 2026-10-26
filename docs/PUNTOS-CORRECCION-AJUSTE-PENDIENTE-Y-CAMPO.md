# Corrección puntual: ajuste pendiente y tarjeta única de Campo

**Preparado para revisión; sin push, migración productiva ni despliegue.** Base: b6e27803b8c02c976b43c98c61019051b76a5def, con las cuatro migraciones originales ya aplicadas. No se modificó ninguna orden real. La única consulta productiva fue la lectura acotada del caso comunicado por el propietario.

## Causa raíz comprobada

Lectura de TCK-2026-00066: puntaje 2, status `resolved`, creada el 26/10 04:29:03 UTC y resuelta el 26/10 04:32:23 UTC; sin registro en `work_order_point_confirmations`. La fila de `work_order_closures` corresponde a la terminación técnica de Campo, no a la confirmación definitiva de puntos. Es una prueba posterior al fin de la activación, 26/10 04:22:51 UTC (25/10 23:22:51 Lima).

Dos defectos se combinaban:

1. `work_order_point_review` marca `historical=true` si creación o terminación son anteriores al inicio oficial de noviembre. El editor usaba ese indicador para ocultar el formulario de ajuste, incluso en una orden nueva del piloto ya terminada técnicamente.
2. La guarda SQL utilizaba el mismo corte del 01/11/2026 para rechazar el ajuste. Añadir un input en frontend por sí solo habría seguido fallando en el backend. Además, el modal no tenía input ni motivo editable: únicamente imprimía el valor de `draft`.

La corrección distingue **período sin acreditación oficial** de **terminación histórica protegida**. No se cambia el inicio oficial ni el cálculo compartido de reportes/ranking.

## Comportamiento preparado

- ADMIN/SUPERADMIN activos pueden ajustar una Avería resuelta/cerrada técnicamente o Alta/Rutina completada, siempre pendiente de confirmación definitiva y no cancelada.
- La nueva guarda conserva protegidas las terminaciones previas al fin documentado de la activación: **2026-10-26 04:22:51 UTC**. Una terminación sin fecha tampoco abre edición. Las órdenes que ya estaban abiertas y se terminan después pueden revisarse aunque su creación sea anterior. No se actualizan filas para reclasificarlas.
- Se conserva la excepción privada de Prospectos con cero inicial y su asignación positiva. No se abre cero para Altas directas ni se permite volver de positivo a cero.
- La RPC de revisión añade `canAdjustPoints`, calculado en servidor según las mismas condiciones de la guarda. `historical` conserva su significado anterior para la información del piloto. El frontend mantiene un fallback conservador si la candidata todavía no está instalada.
- El modal muestra los puntos vigentes y permite proponer el valor definitivo y motivo. Recalcula el reparto en pantalla; si hay cambio, exige motivo y una nueva confirmación explícita. La RPC existente realiza cambio, auditoría y confirmación de forma atómica. También permanece la vía de guardar el ajuste primero y confirmar después.
- Guardar separadamente usa el valor recibido de la revisión como `p_expected_points`, corrigiendo el uso de una prop del padre que podía estar desactualizada.
- Las confirmaciones existentes, sus importes/repartos y guardas posteriores permanecen intactos. No se modifican `confirm_work_order_points`, `adjust_work_order_points`, las guardas definitivas, sus ACL/RLS ni las funciones de acreditación/ranking.
- Campo monta solo `CampoJobPoints`: total de la orden y parte del técnico asignado, líder o ayudante. Se retira el montaje de “Mi aporte en puntos” y los textos administrativos de la tarjeta operativa. No se borra su componente, registros, RPC compartida ni cálculos de reportes. Realtime, refresco cada 15 segundos y eventos de foco/conexión se conservan.

## Archivos de esta corrección

| Archivo | Cambio |
| --- | --- |
| `supabase/migrations/20261026050000_work_order_points_pending_adjustment.sql` | Candidata adicional: sustituye únicamente guarda y revisión de puntos; sin backfill, tablas nuevas ni DML sobre órdenes. |
| `src/components/soporte/WorkOrderPointsEditor.vue` | Edición en modal, motivo condicionado al cambio, reparto reactivo, permiso servidor y valor esperado de la revisión. |
| `src/lib/workOrderPoints.ts` | Tipo opcional `canAdjustPoints`. |
| `src/components/campo/CampoJobPoints.vue` | Una presentación de total/parte asignada sin mensajes administrativos. |
| `src/views/campo/CampoTrabajoDetailView.vue` | Retira únicamente import y montaje de la tarjeta duplicada. |
| `server/tests/pendingPointAdjustment.sql.test.ts` | Casos PostgreSQL reales en contenedor aislado, datos ficticios. |
| `scripts/tests/pending-point-adjustment-browser.html` | Montaje local de los componentes Vue reales con estado ficticio. |
| `scripts/tests/pending-point-adjustment-browser.mjs` | Recorrido real del modal y tarjeta Campo; red externa bloqueada. |
| Este informe | Causa raíz, alcance, validaciones y pendientes. |

No se tocaron Clientes, Contratos, Deuda, Facturación, OLT, MikroTik ni las cuatro fuentes SQL originales. Los informes locales anteriores y los helpers/evidencias privados quedan fuera del commit.

## Pruebas y resultados

- `node --import tsx --test server/tests/pendingPointAdjustment.sql.test.ts`: **14 PASS**, incluido el test padre. PostgreSQL 17, enums reales relevantes, roles/RLS/RPC, contenedor sin red y datos ficticios. Reproduce primero el rechazo original de la Avería nueva de octubre; instala la candidata únicamente en ese laboratorio.
  - Avería resuelta, Alta y Rutina completadas: ADMIN guarda 2 → 5 con auditoría, líder y ayudante consultan 2,5 cada uno; confirma después sin duplicar auditoría.
  - SUPERADMIN cambia 2 → 5 y confirma atómicamente; ausencia de motivo rechazada y sin cambios parciales.
  - Técnico, ayudante, soporte, inactivo y anon sin permisos de mutación/confirmación. Escritura directa sin motivo rechazada. Revisión/valor esperado obsoletos rechazados.
  - Tras confirmar: bloqueados ajuste, reapertura/cambio de estado, borrado y cambios de cuadrilla; reintento idempotente conserva la confirmación.
  - Históricos de los tres tipos y confirmación ya existente conservan su contenido exacto. Frontera anterior a la activación y terminaciones sin fecha bloqueadas. Fuente oficial de puntos sin cambios.
  - Cero privado de Prospecto y rechazo del cero directo conservados.
- `node scripts/tests/pending-point-adjustment-browser.mjs`: **59 comprobaciones PASS**. Chrome headless, Vite exclusivamente loopback, respuestas ficticias y solicitudes externas bloqueadas. Componentes Vue reales:
  - ADMIN/SUPERADMIN y tres tipos de orden: modal con valor vigente 2, edición a 5, motivo obligatorio, reparto vivo, confirmación única y campos bloqueados después.
  - Alta inicial cero: modal permite asignar valor positivo, pero no confirmar cero.
  - Guardado separado con prop obsoleta usa el valor revisado del servidor.
  - Técnico/soporte sin controles de edición. Histórico protegido no abre input.
  - Se verifica que el detalle monta una sola tarjeta y no monta la duplicada; se prueba la tarjeta real para líder/ayudante, consulta y actualización 2 → 5 mediante evento, sin invocar mutaciones ni la RPC de la tarjeta retirada. No se monta el detalle completo con todos los módulos en esta prueba.
- `node --test server/tests/prospectConversion.ui.test.mjs`: **6 PASS**, compatibilidad de la excepción previa y del fallback conservador del editor.
- `vue-tsc -b --pretty false`: PASS. `tsc -p tsconfig.server.json --pretty false`: PASS. `git diff --check`: PASS. Las cuatro migraciones originales sin diferencias.

Durante el desarrollo se corrigieron expectativas del laboratorio: el caso histórico debe llevar motivo válido para alcanzar la guarda; el formato es-PE del navegador usa `2.5`. Se agregó timeout de diagnóstico al navegador local. Los resultados anteriores corresponden a las ejecuciones finales satisfactorias; no se trasladaron fallos de test a producción.

## Migración necesaria y pendientes

**No basta corregir solo frontend.** La guarda productiva aún rechaza los ajustes terminados de octubre. Se requiere revisar y autorizar la nueva candidata `20261026050000`, posterior a las cuatro originales, y preparar/publicar un artefacto acotado actualizado de frontend. No requiere cambios ni reconstrucción del backend Hono. La imagen productiva anterior no contiene este arreglo.

El corte histórico usa la hora real documentada de fin de la activación. Revisarlo expresamente al aprobar la candidata; no sustituirlo por la fecha del siguiente despliegue, porque volvería a bloquear las pruebas nuevas ya terminadas. Octubre sigue sin acreditación oficial y noviembre empieza el **01/11/2026 00:00 America/Lima**. Se conserva el riesgo histórico de reapertura ya aceptado; no se corrige en este trabajo.

Pendiente: revisión del commit local, autorización separada para push y para migración/despliegue, comprobación acotada del destino y nueva verificación del propietario tras publicar. No se ejecutó la candidata productiva, no se desplegó ni se repitieron auditorías generales. TCK-2026-00066 y el resto de datos reales no fueron modificados por esta intervención.
