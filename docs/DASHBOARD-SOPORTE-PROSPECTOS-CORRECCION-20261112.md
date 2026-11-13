# Dashboard: soporte operativo y prospectos pendientes de instalación

Estado: **LISTO para revisión local. Sin aplicar SQL ni publicar en producción.**
Base: `b67e31a`. Diagnóstico del 12/11/2026, 23:30–23:53 Perú; pruebas locales terminadas el 13/11.

## Causas y contraste de solo lectura

| Indicador | Criterio anterior | Criterio corregido / evidencia |
|---|---|---|
| Soporte | Solo `tickets`: open/in_progress y urgentes no cerrados | La misma población de Soporte / Todas: averías, rutinas y Altas activas, con `ACTIVE_STATUS` compartido |
| Pendientes | 1 avería | **12**: 1 avería abierta + 10 rutinas programadas + 1 Alta programada |
| En progreso / urgentes | 0 / 0 | **0 / 0**; los urgentes terminales no entran |
| Prospectos | `countClientLifecycles().prospect`: 4 contrataciones canceladas nunca instaladas | **1 ficha en Pendientes de instalación: Manuel Romero Collantes**, Alta scheduled |

La aclaración del usuario fija el significado de Prospectos: Clientes → Pendientes de instalación. El CRM comercial `prospects` es otro modelo y se conserva íntegro. Las cuatro fichas del contador anterior están en No instalados; tres tienen estado crudo `prospect` y una `retired`, todas con contrato e instalación cancelados. Manuel tiene una Alta abierta: se cuenta una vez aunque haya varios contratos/Altas. No se ha descartado ni editado ninguna ficha real.

El error no proviene de fechas o asignaciones: el Dashboard omitía las otras dos tablas operativas y el estado `rescheduled`. Se leen filas base, sin joins a devoluciones/fotos/cuadrillas; las órdenes se deduplican por tipo + ID, igual que las identidades operativas. “Pendientes” excluye en progreso; “urgentes” es un subconjunto de ambos. Los recientes incluyen los tres tipos y conservan sus rutas reales.

## Implementación y archivos

- `src/stores/dashboard.ts`, `src/lib/dashboardSupport.ts`, `src/lib/dashboardClients.ts`: lecturas paginadas de `tickets`, `routines`, `installations`, con RLS del usuario; agregado operativo y contador de fichas pendientes. Sin filtro de técnico/fecha añadido. Se conserva el último resumen completo y su fecha si falla cualquier fuente de soporte.
- `src/views/DashboardView.vue`: etiquetas “pendientes” / “Órdenes recientes”, enlace por tipo de orden; Prospectos enlaza a `/clientes?section=pending_install`. Sin rediseño ni CSS cambiado.
- `src/stores/clients.ts`, `src/types/domain.ts`, `src/lib/unfulfilledProspect.ts`, `src/components/clientes/UnfulfilledProspectDiscardDialog.vue`, `src/views/clientes/ClientesView.vue`: acción ADMIN/SUPERADMIN en No instalados, motivo de 5–1000 caracteres, confirmación, control de doble envío, conflicto que exige actualizar, consulta de fecha/autor/motivo y conservación de la ficha. El técnico conserva su redirección a Campo.
- `docs/sql/unfulfilled-prospect-discard-*.sql`: propuesta puntual y dos procedimientos de reversión; **no instalados en Supabase**.
- Pruebas: `src/lib/__tests__/dashboardOperationalCounts.test.ts`, `server/tests/unfulfilledProspectDiscard.sql.test.ts`; extensiones acotadas de `scripts/tests/dashboard-v2-browser.mjs`, `dashboard-v2-contract.mjs` y `clientes-lifecycle-browser.mjs` (`--discard --static`).
- Diagnóstico: `scripts/dashboard-support-prospects-readonly.ps1`, tres SQL fijos en `scripts/diagnostics/dashboard-*-readonly.sql`, `scripts/summarize-dashboard-support-prospects.mjs` e informe JSON sin datos personales. Evidencia privada en runtime ignorado por Git.

No se cambian el clasificador global de Clientes, conversión comercial, órdenes operativas, permisos/rutas existentes, puntos, facturación, OLT, MikroTik, PPPoE ni su caché RAM. No cambia el servidor Hono. No hay dependencias añadidas.

## Descarte: migración puntual necesaria

Los estados existentes no contienen motivo/autor/fecha de descarte de estas fichas. Se reutiliza `clients.status = retired` y se añaden **tres columnas nullable**, una restricción de coherencia y una FK a `profiles`. No se crean tablas, muestras, históricos periódicos ni cron jobs; no hay backfill ni modificación de filas al instalar la propuesta.

`public.discard_unfulfilled_client_prospect(uuid,timestamptz,text,boolean)` es la única acción nueva. Comprueba JWT y perfil activo ADMIN/SUPERADMIN en PostgreSQL, confirmación, motivo y versión de la ficha; bloquea ficha y relaciones, y actualiza únicamente el estado y tres campos de trazabilidad de `clients`. Tiene reintento idempotente. `anon` y `service_role` carecen de EXECUTE. RLS existente, propietarios y ACL de objetos anteriores permanecen iguales.

Las guardas rechazan la fabricación/alteración de trazabilidad y el borrado de la ficha descartada, incluso por API directa o con GUC fabricado. Guardas de contratos/Altas serializan creaciones/activaciones con el descarte; nunca actualizan relaciones. Una ficha descartada no puede recibir contratos o instalaciones activos sin un futuro flujo de reapertura expresamente autorizado. El contacto sigue editable. Se muestra “No concretado / Descartado” y “Ver descarte” en **No instalados**; no se mezcla con exabonados reales.

Solo se permite descartar una contratación nunca completada, con contratos ya cancelados y sin Alta abierta. **Manuel no es elegible mientras su instalación esté pendiente.** Cancelar una contratación pendiente debe seguir su flujo autorizado existente antes de descartar; esta acción no cancela contratos ni órdenes automáticamente. La corrección de los dos contadores es independiente de que se descarte alguna ficha.

## Respaldo, hashes y rollback preparados

Respaldo privado de catálogo exacto de `clients`, `service_contracts` e `installations`: columnas, defaults, constraints, índices, propietarios, ACL, RLS, políticas, triggers y definiciones de sus funciones. Sin filas de negocio. Archivo:

`scripts/inventory-auth-lab/runtime/dashboard-prospect-discard-schema-private.json`

SHA-256: `2bda26cf8b1a660a3354df365c7c0099f6afde60b5c40a0c0d4cbfb8c787ef0d`.

Los tres nombres de función nuevos no existen en el catálogo respaldado. El diagnóstico JSON conserva hashes por tabla y el instante del respaldo. No se reemplaza ninguna función anterior. Este respaldo privado debe conservarse con acceso restringido y actualizarse con nueva lectura antes de una aplicación futura; no es una copia de recuperación de datos de negocio.

| Script local | SHA-256 (bytes LF preparados) |
|---|---|
| `docs/sql/unfulfilled-prospect-discard-proposal.sql` | `89e3d0f8d11634dc60f65d8c7ae9d91c7ca99e907db3df24e47f424aeaf26ce6` |
| `docs/sql/unfulfilled-prospect-discard-rollback-unused.sql` | `9d940eb3cb2e6a1127509a3b123cce41f3c61c80d15933ff7b18fc6184b22d3a` |
| `docs/sql/unfulfilled-prospect-discard-disable-used.sql` | `acc48833309e3571a51f78ffe92cd83fd6344ab23ce914363f7cc472718e7a41` |

Antes del primer descarte, rollback elimina únicamente los objetos nuevos y falla si encuentra cualquier trazabilidad. Tras uso, revertir frontend y revocar EXECUTE con `disable-used.sql`, conservando columnas y guardas para no perder evidencia ni reactivar fichas. No se restauran estados con UPDATE masivos ni se borran registros. Ambos caminos se probaron localmente.

No se preparó un nuevo despliegue ni se modificó el paquete aprobado de Dashboard V2. Una futura publicación necesita autorización separada, reconfirmación del catálogo y copia íntegra de la imagen frontend vigente; no reutilizar automáticamente imágenes de otras tareas. No hace falta publicar backend.

## Validación local

- `npm.cmd run build`: PASS (vue-tsc + Vite). Advertencia preexistente por chunks grandes; sin nuevas dependencias.
- `node --import tsx --test src/lib/__tests__/*.test.ts server/tests/clientRetirement.sql.test.ts server/tests/prospectConversionPoints.sql.test.ts server/tests/prospectConversion.ui.test.mjs`: **604 PASS**. Incluye seis pruebas nuevas de contadores; conversión real atómica/idempotente y baja existentes conservadas.
- `node --import tsx --test server/tests/unfulfilledProspectDiscard.sql.test.ts`: **13 PASS** (12 escenarios y test contenedor). PostgreSQL 17 efímero, `--network none`, datos sintéticos: roles/inactivos/anon/service_role, API directa, GUC fabricado, versión/motivo/confirmación, reversión ante fallo, conservación exacta de contratos/órdenes/historial, doble solicitud, inserciones y activaciones concurrentes, ficha no descartada y ambos rollbacks.
- `node scripts/tests/dashboard-v2-contract.mjs`: PASS. Compara consultas y cálculo de facturación, errores/fechas/actualización, PPPoE, backend, permisos y rutas con las referencias; solo permite el cambio operativo solicitado.
- `node scripts/tests/dashboard-v2-browser.mjs --output-dir docs/dashboard-support-prospects-local`: **34 PASS + 16 PPPoE PASS**. Build real en localhost, API simuladas, cero escrituras/tráfico externo, 17 anchos (320–1920), tablet/escritorio/móvil, fuente fallida sin ceros falsos, filtros/enlaces y refrescos conservados.
- `node scripts/tests/clientes-lifecycle-browser.mjs --discard --static`: **10 comprobaciones PASS**, sin excepciones. Formulario real sobre build, RPC simulada, confirmación/cancelación/conflicto/doble clic/roles/historial y fecha Perú desde Tokio. Los intentos iniciales con Vite terminaron por timeout; se validó finalmente el build estático. Se corrigieron esperas y fixtures del test, sin tocar componentes ajenos.
- Lecturas productivas: transacciones REPEATABLE READ READ ONLY + ROLLBACK, SSL verify-full, credenciales privadas no impresas. Comparación offline con los helpers reales: **12 / 0 / 0 y 1 prospecto operativo**.

Capturas y resultados: `docs/dashboard-support-prospects-local/` (desktop, tablet, tablet-landscape, mobile, estados de error y formulario de descarte). Todos los datos de las capturas son sintéticos; esos fixtures viven únicamente en scripts de pruebas, no en el bundle productivo.

## Riesgos y condición de publicación

La propuesta DDL adquiere bloqueos breves y tiene lock_timeout; las carreras con activaciones pueden devolver conflicto/deadlock y revierten completas. La interfaz obliga a actualizar antes de reintentar. Las cifras son del instante de diagnóstico, sujetas al trabajo posterior. Compararlas nuevamente bajo una sesión del mismo rol al publicar.

**LISTO para revisión local; requiere aprobación explícita de la migración puntual y del despliegue frontend antes de habilitar el descarte en producción.** No hay cambios productivos ni descartes automáticos preparados para personas concretas. Cero escrituras en Supabase productivo; cero operaciones MikroTik/OLT.
