# Cierre de puntos: un formulario y un clic

**Preparado para revisión. Sin push, despliegue, migraciones productivas ni modificaciones de datos reales.** Base desplegada: 397484cf1a4eeb88195bb74fed5df5a078e88709, con 20261026050000 aplicada.

## Seguridad comprobada antes de cambiar la interfaz

La RPC existente `confirm_work_order_points` ya garantiza el comportamiento necesario: permisos activos ADMIN/SUPERADMIN, bloqueo de fila, revisión/token de orden y cuadrilla, ajuste con motivo y auditoría, inserción de confirmación en la misma transacción y unicidad por orden. Un fallo al insertar la confirmación revierte ajuste y auditoría. Reintentar el mismo token y valor devuelve la confirmación existente.

Se reutiliza esa RPC sin modificar su SQL. Pulsar **Confirmar cierre** envía la confirmación explícita existente (`p_confirmed=true`). No hay llamada previa a `adjust_work_order_points`, segundo modal ni casilla de segunda confirmación.

## Interfaz preparada

Un único formulario compartido por Averías, Altas y Rutinas:

- **Puntos iniciales**, solo lectura.
- **¿Con cuántos puntos se cierra?**, precargado con la revisión vigente del servidor.
- **Motivo del cambio**, visible y obligatorio únicamente cuando cambia el puntaje.
- Técnicos asignados y reparto actualizado, conservando cualquier descuento existente.
- Un único botón principal: **Confirmar cierre**.

La orden debe estar terminada técnicamente, tener fecha y técnicos asignados. Los permisos de ajuste de la revisión se conservan. El técnico no recibe controles de cierre. No se cambian estados técnicos ni reglas históricas.

Una orden confirmada muestra **Estado: Cerrada**, puntos iniciales y finales, técnicos/reparto y fecha/hora de cierre en Perú. No contiene controles de edición o cierre. Auditoría, motivo, descuento, responsable y la información del piloto están en **Más información**. Se retiran de la vista principal las advertencias extensas y los identificadores de responsables.

## Puntos iniciales y nombres sin SQL nuevo

El valor inicial se obtiene del `old_points` del primer ajuste auditado, consultado de forma ascendente con límite 1; no se infiere del último bloque de 20 ajustes. Cuando no hay ajustes registrados se utiliza el puntaje vigente/final disponible. Un valor NULL se presenta como **Sin asignación** y el cero de Prospectos se conserva como cero. Si no puede consultarse el origen, se informa **No disponible** en lugar de inventarlo.

El responsable y autores de ajustes se resuelven mediante SELECT autenticado a `profiles`, únicamente `id,full_name` y únicamente los IDs recibidos de la confirmación/auditoría. Se conservan las RLS existentes, sin clave privilegiada, sin ampliar permisos y sin excluir exintegrantes inactivos. Consultas tardías se descartan si cambia orden/usuario/rol o se desmonta el componente. Si no hay nombre disponible, se muestra **Nombre no disponible**, nunca el UUID. Los nombres y mensajes visibles también evitan filtrar UUID como fallback.

## Reintentos y errores

- El envío en curso bloquea otro envío inmediato; el backend conserva la protección contra concurrencia y duplicados.
- Tras un error se consulta el estado con la RPC de lectura. Si el cierre ya se guardó y solo se perdió la respuesta, se muestra cerrado sin otra mutación automática.
- Si no se guardó, se conserva la propuesta/motivo para un nuevo clic. Una revisión obsoleta se actualiza antes del reintento.
- Si también falla la consulta, no se declara éxito ni se ejecuta una compensación parcial. Un reintento del mismo token/valor sigue protegido por la idempotencia existente.
- No se modifican confirmaciones anteriores para resolver su visualización.

## Archivos

| Archivo | Cambio |
| --- | --- |
| `src/components/soporte/WorkOrderPointsEditor.vue` | Único cambio de producto: formulario único, resumen cerrado, nombres seguros y reconciliación de errores. |
| `server/tests/pendingPointAdjustment.sql.test.ts` | Casos adicionales de cierre sin ajuste/motivo y fallo final con rollback/reintento, en los tres tipos. |
| `scripts/tests/single-point-closure-browser.html` | Fixture local del componente real; respuestas y nombres ficticios. |
| `scripts/tests/single-point-closure-browser.mjs` | Recorrido del cierre de un clic, errores y vistas cerradas. |
| Este informe | Alcance, pruebas y pendientes. |

No hay cambios en las vistas padre, Campo, Clientes, Prospectos, Deuda, Facturación, OLT ni MikroTik. No se modifica ningún archivo de migración ni backend Hono. Los informes locales previos y los helpers/evidencias privados no forman parte del commit.

## Validación final

- `node --import tsx --test server/tests/pendingPointAdjustment.sql.test.ts`: **20 PASS** (incluye test padre). PostgreSQL 17 sin red y datos ficticios, con las cinco migraciones existentes instaladas solo en la fixture aislada. Cierres con/sin ajuste, uno/cuadrilla, motivo, permisos, auditoría, congelación, reintento idempotente y fallo final que revierte todos los cambios. Históricos y confirmación previa idénticos; Prospecto cero y fuente oficial conservados.
- `node scripts/tests/single-point-closure-browser.mjs`: **208 comprobaciones PASS**, Chrome headless y Vite loopback, red externa bloqueada, componente Vue real y datos ficticios. Doce combinaciones de tipo/cuadrilla/cambio, ADMIN/SUPERADMIN, un botón sin checkbox ni modal, doble clic, fallo antes de guardar, respuesta perdida después de guardar, lectura indisponible/reintento, token obsoleto, orden cerrada con 21 ajustes, nombre legible, fallo de consulta de nombre sin UUID, técnico/soporte sin controles y Alta con cero inicial.
- `node --test server/tests/prospectConversion.ui.test.mjs`: **6 PASS**; compatibilidad de Prospectos y del permiso conservador del editor.
- `vue-tsc -b --pretty false`: PASS; `tsc -p tsconfig.server.json --pretty false`: PASS.

Los recorridos antiguos basados en “Guardar puntaje” y modal describen la versión anterior. La nueva prueba focalizada valida su sustitución por el formulario único; no se presentaron esos recorridos anteriores como prueba de esta interfaz.

## Entrega y pendientes

**No requiere cambios de backend/SQL ni una migración adicional.** La atomicidad ya está disponible en producción; solo se prepara la interfaz y sus pruebas. Octubre sigue excluido y la acreditación oficial comienza el 01/11/2026 00:00 America/Lima. Se mantienen el cero inicial exclusivo de Prospectos y el bloqueo definitivo existente.

Pendiente: revisar el commit local y autorizar su publicación/despliegue selectivo del componente. Hasta entonces producción sigue con 397484c y su interfaz actual. No se realizaron consultas ni escrituras de prueba sobre órdenes reales durante este trabajo. La prueba física y funcional productiva corresponde al propietario después de una publicación autorizada.

Sin ampliación funcional ni fases nuevas. Se conserva la auditoría en su sección desplegable y la protección de históricos previamente acordada.
