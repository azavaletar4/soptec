# Seguridad de Inventario — BLOQUEADO antes de migración

Continuación de `INVENTARIO-ACCESO-CONTROLADO.md`, 15/10/2026. No se repitió la
auditoría de Cloud ni la búsqueda funcional. Se conserva la evidencia instalada
en `INVENTARIO-PERMISOS-CLOUD-METADATOS.json`.

## Motivo de la detención

La condición de parada del pedido exige detenerse si la separación compromete
Campo o requiere cambios estructurales importantes. No es seguro preparar un
cierre global de RLS y presentarlo como compatible con los consumidores actuales.
Las lecturas contextuales propuestas resuelven una parte, pero no estas dependencias:

1. **RETURNING y escrituras.** `inventoryUnits.registerEvent` hace INSERT más
   SELECT de evento/autor/cliente. `inventory.registerMovement` hace INSERT más
   SELECT y usa balance_after para actualizar el saldo local. Eliminar SELECT a
   técnicos puede impedir esas respuestas; conservar políticas ALL mantiene el
   acceso directo amplio. Las operaciones de retirar equipo de Alta
   (`handleUnassignInstallUnit` → markRepaired) y desvincular pendiente de Avería
   (`handleUnlinkPendingUnit` → rejectUnit) ni siquiera envían el job_id al servicio.
   Una frontera contextual segura debe recuperar y bloquear el vínculo anterior,
   validar la orden/asignación real y devolver una respuesta mínima. No basta
   reutilizar el INSERT actual con otro nombre ni confiar en un job_id enviado.
2. **Realtime y contenido de filas.** `setupRealtimeSync` en Campo escucha
   inventory_movements e inventory_units con postgres_changes. RLS filtra filas,
   no proyecta una respuesta distinta por perfil de aplicación: dar SELECT para
   conservar el canal también permite pedir esas mismas filas/columnas por REST.
   El canal no consume la proyección mínima de una RPC. Por ejemplo, los
   movimientos contienen balance_after, además de la cantidad de la orden.
   No se debe dar por autorizada toda la fila administrativa para justificar
   una señal de actualización.
3. **Pérdida del vínculo al retirar.** La función Cloud capturada
   apply_inventory_unit_event pone installation_id/ticket_id a NULL cuando
   el estado no ocupa un cliente. Tras retirar, la fila nueva ya no coincide con
   los filtros de suscripción por orden y puede dejar de ser visible por una
   política contextual. Es una limitación que también puede existir hoy: no se
   certificó que el canal actual notifique todas las retiradas. Cambiar solo RLS
   no resuelve esta actualización entre dos técnicos del mismo trabajo.
4. **Rutinas y Fase 162.** RoutineInventory mantiene lecturas directas por
   routine_id, catálogo y equipos de cliente/producto, además de su RPC pendiente.
   La restricción de tablas compartidas afectaría también a ese componente.
   No se debe incorporar ni reescribir Fase 162 para aparentar que esta fase de
   seguridad ya conserva las operaciones de Rutinas.
5. **Reasignación y reintento.** La autorización debe comprobarse otra vez al
   ejecutar, no solo al abrir la pantalla: un técnico puede perder la asignación
   mientras tiene una respuesta o una operación pendiente. La cola actual es
   de cierres de trabajo; no se ha demostrado un protocolo idempotente general
   para todas las mutaciones de inventario de Altas/Averías. No se modificó esa
   cola ni se certificaron concurrencia o reintentos de nuevas RPC inexistentes.

## Alcance que necesita resolverse antes del cierre de RLS

- Adaptadores contextuales de lectura **y escritura**, con identidad real,
  autorización por job_assignees, validación de estados y locks transaccionales
  sobre orden/asignación/unidad; los SELECT de órdenes desplegados son amplios.
- Un mecanismo de invalidación de inventario por orden que no requiera exponer
  la fila administrativa: evaluar canal privado autorizado con mensajes mínimos
  o eventos existentes con contexto fiable. Diseñar y probar las retiradas,
  las reasignaciones y la revocación de acceso antes de reemplazar el canal.
  No se ha creado una tabla, trigger de notificación ni policy de Realtime.
- Un contrato de compatibilidad independiente para Fase 162 y los consumidores
  de Soporte/Clientes. No cambiar sus roles ni romper sus lecturas contextuales.
- Estrategia de clientes antiguos/offline antes de retirar permisos directos.

Esto amplía la frontera de autorización y sincronización de Campo; no se
implementa de manera parcial bajo el supuesto de que equivale a cambiar RLS.

## Entrega local conservada

Se guarda la corrección frontend ya preparada: rutas, menú y llamada de búsqueda
solo para ADMIN/SUPERADMIN, con cancelación y limpieza al perder el rol. Los
stores, las escrituras de inventario y Campo no se cambian. Esta corrección
**no protege por sí sola el REST directo de Cloud**.

Evidencia de la versión frontend sin cambios desde su validación:
11/11 pruebas de autorización; 30 combinaciones ruta/rol en navegador sintético;
cambio de rol limpia resultados y no consulta datos; compilación correcta.
No se repitió la compilación ni la búsqueda aprobada para esta detención
documental. Estas pruebas no certifican JWT reales, nuevas RLS, concurrencia
ni regresiones de operaciones de negocio bajo políticas restringidas.

**No se creó una migración RLS ejecutable ni una implementación parcial de
Campo:** hacerlo antes de resolver estas dependencias contradiría la condición
de parada. Las tareas de separación completa, concurrencia y regresiones quedan
pendientes, no aprobadas. No se ejecutaron migraciones, cambios de permisos,
escrituras operativas, push ni despliegue.

El commit de esta entrega contiene la corrección frontend, sus pruebas, diseño,
captura de permisos Cloud y este bloqueo; excluye Fase 162 y archivos ajenos.
El ejecutor local del diagnóstico de Cloud depende de una biblioteca privada
de la sesión anterior y no se incluye; se conserva su resultado JSON verificable.

## Rollback

Como no cambió Cloud, no hay rollback SQL ni de datos que ejecutar. La corrección
frontend se puede revertir mediante un commit inverso del commit de esta entrega,
sin resetear el workspace ni incluir los cambios ajenos. Ese rollback volvería
a admitir SOPORTE/FACTURACION en las rutas anteriores: no se recomienda como
solución de seguridad. Antes de implementar una futura migración, deberá
prepararse su rollback de policies/grants y compatibilidad de clientes usando
la captura Cloud, sin restaurar existencias ni asignaciones.
