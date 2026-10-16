# Acceso controlado a Inventario — corrección local y diseño, 15/10/2026

## Resultado y límites

Frontend corregido localmente: ADMIN/SUPERADMIN exclusivamente. La protección
de consultas directas en Cloud **sigue pendiente**: no se aplicó ningún permiso,
DDL, migración, escritura de negocio, push o despliegue. No se modificaron
existencias/asignaciones ni servicios de Altas, Averías o Rutinas. Fase 162
permanece separada. No se repitieron las pruebas funcionales de búsqueda.

## 1. Permisos realmente desplegados, confirmados por catálogo Cloud

Evidencia: `INVENTARIO-PERMISOS-CLOUD-METADATOS.json`, capturada a las
2026-10-15 23:52:52 UTC (18:52:52 Lima) desde el proyecto autorizado.
Sesión PostgreSQL de diagnóstico con TLS verify-full, `BEGIN READ ONLY`,
`default_transaction_read_only=on`, timeout de 10 s y ROLLBACK. Solo SELECT de
catálogos: cero filas de negocio leídas y cero cambios remotos. No se usó esta
identidad privilegiada para simular permisos de un usuario operativo.

| Objeto desplegado | Confirmación |
| --- | --- |
| inventory_products | RLS activo. `inventory_products_staff_only` ALL permite SUPERADMIN, ADMIN, TECNICO_RED, SOPORTE y FACTURACION sin limitar filas por orden |
| inventory_units | RLS activo. SELECT/INSERT/UPDATE para esos cinco roles, sin alcance por orden en la política. DELETE solo SUPERADMIN |
| inventory_categories | RLS activo. ALL para esos cinco roles |
| inventory_movements / inventory_unit_events | RLS activo. SELECT e INSERT para esos cinco roles |
| Grants de tablas | anon/authenticated tienen SELECT; anon no tiene una política de filas habilitante en estas tablas. El grant por sí solo no implica visibilidad |
| inventory_get_albums | STABLE SECURITY DEFINER, sin verificación administrativa interna. EXECUTE para PUBLIC, anon, authenticated y service_role: exposición de agregados no cerrada por RLS de tablas |
| current_user_role | SECURITY DEFINER; obtiene el rol del perfil correspondiente a auth.uid() y exige active |
| SELECT de installations/tickets/routines | Incluye acceso amplio para TECNICO_RED. No sirve como prueba suficiente de asignación a una orden propia |

La captura incluye 5 tablas de inventario, 24 políticas (incluidas órdenes y
asignaciones), grants de tablas y definiciones/ACL de cuatro funciones. Es
evidencia instalada, no una suposición basada en archivos de migración.
No hubo sesiones reales ADMIN/SUPERADMIN/TECNICO_RED disponibles: el catálogo
confirma la configuración, no sustituye pruebas de sus JWT efectivos.

## 2. Consultas y operaciones compartidas con Campo

| Flujo / consumidor actual | Lecturas | Operaciones existentes que deben preservarse |
| --- | --- | --- |
| Campo: Altas, `CampoTrabajoDetailView.vue` | fetchProducts; movimientos por installation_id; unidades por instalación; unidades de modelo elegido y filtro in_stock aplicado en cliente | registerUsage, corrección/reversión de material y kit; assignUnit con cliente/contrato/instalación; retirar unidad equivocada vía markRepaired |
| Campo: Averías, mismo componente | catálogo; movimientos por ticket_id; equipos por contrato o fallback por cliente; pendientes por ticket; disponibles del producto elegido | consumo/corrección/reversión; saliente returnUnit; entrante stageUnitFromTicket con pending_approval; rejectUnit para desvincular pendiente |
| Administración de Altas, `InstalacionDetailView.vue` | mismo catálogo/unidades/movimientos, incluida selección de modelo | asignar/desvincular equipo según guardas actuales |
| Soporte, `TicketDetailView.vue`, ticketApprovals y tickets stores | movimientos/equipos por ticket; lectura de pendientes | approveUnit/rejectUnit según autorización actual; devolución de materiales al eliminar ticket (no accionar en esta revisión) |
| Rutinas: código local pendiente Fase 162, `RoutineInventory.vue` | movimientos/unidades/eventos por routine_id; catálogo; unidades del cliente y disponibles del producto | RPC routine_inventory_operation y recibo idempotente por operación. Componente usado desde RutinasView y Campo; no se ejecutó ni modificó |
| Vista de cliente/servicio, `ClientServiceDetailView.vue` | unidades por cliente, catálogo y disponibles por producto | setUnitContract, devoluciones y recupero, según permisos actuales de esa vista |

Además, Campo escucha Realtime de movimientos/unidades filtrados por
installation_id/ticket_id; su cola offline y los `.insert(...).select(...)`
dependen de los permisos de lectura además de los de escritura.
Los servicios compartidos están en `src/stores/inventory.ts` e
`inventoryUnits.ts`. No se añadieron guardas administrativas globales a esos
stores, para no bloquear Campo ni sus consumidores contextuales.

## 3. Corrección frontend aplicada localmente

- Las cinco rutas `/inventario`, `/inventario/album/:slug`, `/inventario/:id`,
  `/inventario/devoluciones` y `/inventario/activos-fijos` usan la lista específica
  ADMIN/SUPERADMIN. `NOT_TECNICO` permanece igual para los otros módulos.
- El menú Inventario exige `requiresAdmin`, reutilizando la lógica existente.
- El buscador usa `searchAdministrativeInventory`, que rechaza los demás roles
  antes de llamar a Supabase. El componente observa los cambios de rol, cancela
  peticiones pendientes y borra resultados/detalle. No altera la consulta funcional.
- Esto es protección de cliente: alguien puede omitirla y consultar REST
  directamente mientras Cloud conserve los permisos amplios confirmados.

Archivos funcionales: `src/router/index.ts`,
`src/components/layout/AppLayout.vue`,
`src/components/inventario/InventorySearchResults.vue`,
`src/lib/inventoryAccess.ts`, `src/lib/inventoryAdministrativeSearch.ts`.

## 4. Separación mínima propuesta — diseño, NO aplicado

No basta mover la búsqueda a backend si las tablas siguen expuestas a los
mismos usuarios por REST. Tampoco basta añadir una policy SELECT para ADMIN:
las policies permisivas existentes se combinan mediante OR y ALL incluye SELECT.

Propuesta sin tablas nuevas y sin duplicar el inventario:

1. **Administración:** mantener los modelos actuales. El futuro endpoint
   `GET /api/inventory/admin/search` reutilizaría la consulta existente detrás
   de requireAuth + requireRole(ADMIN,SUPERADMIN). Usaría el JWT real del usuario
   para consultar Supabase, sin service_role. Aplicar el mismo criterio a álbumes
   y detalles administrativos; no dejar un RPC agregado sin comprobación de rol.
2. **Campo:** sustituir únicamente el acceso compartido que hoy es global por
   lecturas con contexto obligatorio. Contrato de RPC propuesta:
   `field_inventory_read(job_type, job_id, view, product_id?, cursor?)`.
   `view` sería una lista cerrada: catálogo elegible, unidades disponibles de
   un producto, materiales de la orden, equipos de la orden/contrato verificado.
   Sin búsqueda general por serie/MAC en unidades de otros clientes.
3. **Autorización de cada lectura de Campo:** auth.uid() legítimo, perfil activo,
   tipo de orden permitido, existencia de la orden y, para TECNICO_RED, pertenencia
   explícita en job_assignees con job_type/job_id/technician_id exactos y estado
   permitido. NO confiar en que SELECT de installations/tickets/routines devuelve
   una fila: actualmente esos SELECT son amplios. No aceptar actor, cliente o
   contrato arbitrarios del navegador; derivarlos de la orden comprobada.
4. **Respuesta mínima de Campo:** producto/modelo/unidad y cantidad utilizable;
   para seleccionar un equipo, ID/serie/MAC/estado solo de unidades in_stock del
   producto elegido. No precio, valor total, documentos de clientes ni equipos
   asignados a terceros. Paginación de 25 con orden estable; nunca un fallback
   que descargue todo el catálogo/unidades si la consulta contextual falla.
5. **Materiales y equipos ya registrados:** limitar por orden y contrato reales.
   En Averías conservar saliente/entrante y pending_approval. El fallback actual
   por cliente cuando no hay contract_id requiere revisión de los históricos:
   no inventar el contrato ni exponer otros servicios del mismo cliente. Este
   caso debe quedar resuelto y probado antes de restringir las tablas.
6. **Escrituras de Campo:** antes de retirar SELECT amplio, adaptar sus llamadas
   con RETURNING a operaciones contextuales validadas, o diseñar las políticas
   contextuales correspondientes. Preferir RPC con auth.uid() conservado y
   validación de orden/unidad/acción que reutilice los triggers/eventos vigentes.
   No ejecutar escrituras con service_role: perder el usuario original puede
   desactivar guardas basadas en current_user_role y pending_approval. Preservar
   los candados de órdenes cerradas y el Kardex insert-only. No reimplementar
   ni incorporar la RPC de Fase 162 en este cambio.
7. **Cierre de permisos, solo en una etapa futura autorizada:** sustituir las
   policies ALL/SELECT amplias de inventario por acceso administrativo y conservar
   las operaciones contextuales necesarias mediante el contrato anterior. Revisar
   también INSERT/UPDATE/RETURNING; retirar solo SELECT no asegura exclusividad
   de operaciones por orden. Proteger inventory_get_albums por rol y revisar
   EXECUTE PUBLIC/anon. No ampliar permisos de clients/service_contracts.
8. **Otros consumidores:** los detalles de tickets y clientes/servicios deben
   usar lecturas contextuales según sus permisos existentes, sin recibir acceso
   al catálogo administrativo. SOPORTE no debe adquirir permisos de Campo y
   FACTURACION no debe recibir permisos nuevos por este trabajo. Una restricción
   global sin adaptar estos consumidores rompería pantallas fuera de Inventario.

Una RPC SECURITY DEFINER de Campo deberá fijar search_path y comprobar todos
los parámetros antes de leer/escribir: es una frontera de autorización, no un
atajo genérico para saltarse RLS. No se ha creado ninguna de estas RPC/endpoints.

Orden seguro para preparar una futura entrega: implementar y probar en entorno
aislado los accesos contextuales, adaptar todos los consumidores y colas, probar
la coexistencia con clientes antiguos y recién entonces revisar el cierre de
políticas. No desplegar un cierre de tablas que rompa clientes Campo aún antiguos.
No se ha generado una migración ejecutable con esta propuesta.

## 5. Pruebas realizadas y pendientes

- `node --import tsx --test src/lib/__tests__/inventoryAuthorization.test.ts`:
  **11/11**. Permite ADMIN/SUPERADMIN; rechaza TECNICO_RED/SOPORTE/FACTURACION,
  CLIENTE, rol desconocido, service_role como supuesto rol de UI y sesión ausente.
  La denegación de búsqueda global, por álbum y virtual emite cero consultas.
- `node scripts/tests/inventory-authorization-browser.mjs`: **30 combinaciones**
  (5 rutas × 6 identidades sintéticas); menú y rutas correctos; ninguna consulta
  administrativa en los accesos denegados. Cambio ADMIN/SUPERADMIN → SOPORTE
  elimina resultados y menú sin nuevas consultas. Ruta de Campo permitida al
  técnico. Cero excepciones tras preparar adecuadamente los servicios simulados.
  Esto verifica frontend; no certifica sesiones reales ni RLS Cloud.
- `npm.cmd run build`: correcto, con aviso existente de tamaño de paquetes.
- `git diff --check`: correcto. No se repitieron los casos funcionales de búsqueda.

Los primeros intentos de lectura fallaron por sandbox/formato del archivo DPAPI.
Se resolvió su contenedor JSON comprobando proyecto y SID del usuario; ningún
intento fallido modificó Cloud. La lectura final del catálogo fue satisfactoria.
Secretos solo en memoria/stdin de psql, no en argv ni en la evidencia.

Pendientes para la capa de datos futura: pruebas con JWT reales de cada rol;
técnico asignado/no asignado, orden ajena/cerrada/reasignada, IDs manipulados,
contrato distinto, cliente multicontrato, equipos disponibles y de terceros;
rechazo de REST directo y del agregado a roles no autorizados; lecturas y
escrituras legítimas de Campo con RETURNING, Realtime y reintentos offline.
No se ejecutaron escrituras reales para simular estos escenarios.

Archivos adicionales de esta etapa: ejecutor
`scripts/inventory-cloud-permissions-readonly.ps1`, evidencia JSON Cloud,
las dos pruebas nuevas de autorización, este documento y nota en
`ESTADO_DESARROLLO.md`. Los archivos previos y Fase 162 no se incluyen en cambios
de implementación. El commit base sigue siendo `2595c77`; no se creó commit nuevo.

**Estado: frontend local corregido y catálogo Cloud confirmado. Protección de
datos pendiente de implementación/revisión separada; detenerse antes de aplicar
cualquier permiso en producción.**
