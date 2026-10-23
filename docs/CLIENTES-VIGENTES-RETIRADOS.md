# Clientes vigentes, retirados y preparación de reincorporación

Fecha: 2026-10-23. Alcance: código de Clientes y contadores dependientes. Sin consultas ni escrituras a producción, migraciones, push o despliegue. Los 698 registros del pedido son el contexto del operador; no se afirma un nuevo total real sin consultar el entorno autorizado.

## Causa y diseño aplicado

`ClientesView.vue` usaba `clientsStore.clients.length`: todas las fichas, incluyendo bajas. La ficha se marca `retired` desde su edición o desde `ClientDetailView.handleClientStatusChange`. Esto no cancela sus contratos. Los contratos tienen estados independientes `active`, `suspended`, `cancelled`; no existe un estado contractual pendiente. Las altas usan `pending`, `scheduled`, `in_progress`, `completed`, `cancelled`.

Regla compartida en `src/lib/clientLifecycle.ts`:

1. Cualquier alta abierta mantiene vigente al titular.
2. Cualquier contrato distinto de `cancelled` lo mantiene vigente, incluyendo suspensión por deuda.
3. Sin altas abiertas y con todos los contratos cancelados, es retirado, aunque su ficha tenga un estado antiguo.
4. Sin contratos ni altas abiertas, se usa la ficha: sólo `retired` pasa a retirados. Prospectos sin servicio permanecen consultables entre vigentes; vigente no significa servicio conectado ni abonado facturable.

No se cambia ningún estado almacenado. Se conserva el badge original de la ficha y se explica su independencia de la sección. Se muestran contadores globales por sección y resultados del filtro dentro de la sección seleccionada. La búsqueda incluye retirados, documento, teléfonos, correo y códigos de servicio; conserva los filtros rápidos. Activos y suspendidos consideran contratos, con respaldo del estado de ficha si no hay contratos. Pueden coincidir en un titular con servicios distintos; no son sumables.

El dashboard usa el mismo clasificador y particiona cada titular una sola vez: retirado, activo si conserva un contrato activo, suspendido si conserva uno suspendido, prospecto si sólo queda una alta abierta, o su estado de ficha cuando no tiene contratos. Las cifras describen la relación comercial; no sustituyen la situación técnica ni el estado almacenado. El KPI de contratos activos conserva su consulta contractual exacta. Clientes recientes mantiene su significado de registros históricos recientes. Selectores de clientes de otros módulos conservan el historial completo para no perder relaciones.

Clientes se lee con `service_contracts(status), installations(status)` sin filtros interiores. Se pagina por orden estable; la clasificación no depende de un contrato seleccionado ni de un listado global truncado. También se paginan los listados existentes de contratos e instalaciones que alimentan búsqueda, número de servicios y accesos al historial. Se avanza por filas recibidas, hasta alcanzar el total exacto (o página vacía si el servidor no informa total), incluso si el servidor limita la respuesta por debajo del tamaño solicitado. El total exacto evita solicitar un rango posterior al último registro. Un error no publica un total parcial. Las relaciones están sujetas a las políticas RLS existentes, sin credenciales privilegiadas.

## Reincorporación: preparación disponible, operación detenida

`Reincorporar` sólo está visible y protegido en su handler para ADMIN/SUPERADMIN. Abre un diálogo de preparación que identifica al cliente y enlaza a `/clientes/{id}`. No ejecuta INSERT, UPDATE, RPC, creación contractual, asignación de equipos, activación ni provisión. Conserva la misma PK y todas sus relaciones.

La validación de documento busca en el listado completo, incluyendo retirados; bloquea guardar y remite a la ficha existente. La restricción real `clients.document_number UNIQUE` de la migración inicial sigue como defensa ante carreras. No se altera ni se amplía la normalización existente (trim y comparación local sin distinguir mayúsculas).

Revisión del flujo real antes de implementar cualquier reactivación:

| Área | Evidencia y consecuencia |
| --- | --- |
| Contratos | `ClientDetailView.handleCreateNewService` inserta directamente. El esquema inicial define `service_contracts.status DEFAULT active`. Usarlo como reincorporación podría facturar antes de instalar. |
| Facturación | `server/src/services/invoiceGenerationService.ts` selecciona contratos `active`. No se ejecutó ni modificó esa ruta. Deuda e historial deben revisarse, no eliminarse. |
| Equipos serializados | `ClientServiceDetailView` usa `inventoryUnits.assignUnit`, `setUnitContract` y eventos de inventario. El estado `en_recupero` conserva el cliente (fase 51d). Las fases 151, 162, 164, 165 y 167 agregan controles de órdenes, custodia y cierre. No se debe reasignar un serial automáticamente ni reabrir una orden cerrada. |
| OLT | La ficha de servicio vincula ONT/contrato por rutas OLT. El trigger fase 68 sólo promueve fichas `prospect` al vincular ONT; excluye `retired` y `suspended`. No garantiza una reincorporación segura. |
| MikroTik/IPTV | Guardar el servicio puede sincronizar perfil PPPoE, desconectar sesiones y sincronizar estado XUI. No se invoca este guardado desde la preparación. |
| Permisos | RLS de clientes permite actualización a varios roles de staff (fase 2b), no restringe una reincorporación a ADMIN/SUPERADMIN. El flujo actual no ofrece una operación transaccional específica para ese fin. |

Para una reincorporación operativa hace falta diseñar una operación de backend con autorización real ADMIN/SUPERADMIN, idempotencia y validación transaccional del titular y sus contratos; definir cómo representar el nuevo servicio pendiente sin volver a facturar el anterior; comprobar deuda, equipos recuperados/asignados y vínculo OLT antes de acciones operativas separadas. Si requiere estado contractual adicional o cambios en RLS/esquema, deben proponerse y autorizarse primero. No se implementa ni se crea una migración en esta entrega. La consulta de la ficha mantiene los controles operativos existentes, no equivale a autorizar su uso durante estas pruebas.

## Archivos

- `src/lib/clientLifecycle.ts`: clasificación, contadores y paginación compartidos.
- `src/stores/clients.ts`: relaciones de ciclo de vida y lectura completa.
- `src/stores/contracts.ts`, `src/stores/installations.ts`: paginación de consultas existentes usadas en Clientes.
- `src/stores/dashboard.ts`: contador por titular con la misma regla.
- `src/views/clientes/ClientesView.vue`: secciones, filtros, contadores, preparación y orientación ante duplicados.
- `src/lib/__tests__/clientLifecycle.test.ts`: casos de dominio y paginación sintéticos.
- `scripts/tests/clientes-lifecycle-browser.mjs`: UI real con todas las respuestas externas simuladas y escrituras bloqueadas.
- Este documento.

## Validación

Las pruebas usan datos sintéticos; no crean clientes, contratos, servicios ni equipos reales. No certifican políticas desplegadas ni el total actual de producción.

| Prueba | Resultado |
| --- | --- |
| Baja definitiva, ficha sin contratos y todos los contratos cancelados | PASS, prueba de dominio |
| Cliente activo | PASS, prueba de dominio |
| Suspendido por deuda, incluso con ficha retirada | PASS, prueba de dominio |
| Dos servicios, uno cancelado y otro activo/suspendido | PASS, prueba de dominio |
| Alta pendiente/programada/en curso; completada/cancelada no evita retiro | PASS, prueba de dominio |
| Contadores particionados y 1203 filas con límite de servidor 137 | PASS, prueba de dominio |
| Error de lectura no entrega totales parciales | PASS, prueba de dominio |
| Búsqueda por documento retirado, filtros, duplicados y preparación sin escrituras | PASS, Chrome local; 4 vigentes y 1 retirado; servidor simulado limitado a 2 filas |
| ADMIN y SUPERADMIN ven Reincorporar; SOPORTE y FACTURACION no | PASS, Chrome local; controles de router para técnico revisados en código |
| Dashboard usando consultas reales del store y respuestas simuladas | PASS, 2 activos + 1 suspendido + 1 pendiente + 1 retirado |
| `npm run build` (TypeScript + Vite) | PASS; aviso de tamaño de chunks |

## Riesgos y estado de entrega

Una ficha puede decir «Baja» y estar en vigentes por conservar un servicio: se conserva evidencia de la inconsistencia en lugar de cambiar datos. Prospectos sin contrato se mantienen en vigentes por compatibilidad; no debe usarse ese total para emitir facturas. La lectura completa requiere más páginas y relaciones que antes. Lecturas paginadas no son una instantánea transaccional si otro operador cambia datos simultáneamente; recargar vuelve a consultar. La clasificación depende de la visibilidad que conceda RLS: la revisión local confirma las políticas de staff del repositorio, pero no certifica su estado desplegado. Antes del despliegue corresponde validar los totales y visibilidad con sesión real autorizada, sólo lectura.

Cambios locales preparados para revisión. Sin push, despliegue ni migraciones; ningún dato real modificado. Se excluyen todos los archivos ajenos que ya estaban modificados en el workspace.
