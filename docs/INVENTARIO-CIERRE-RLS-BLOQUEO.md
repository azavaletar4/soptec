# Cierre RLS de Inventario — BLOQUEADO por compatibilidad Fase 162

Actualización tras autorización puntual: la rama de recibos se corrigió en una
migración local independiente y aprobó 11/11 grupos con JWT reales en una base
ficticia separada. Ver `INVENTARIO-RUTINAS-RECIBOS-CORRECCION.md`. La evidencia
original siguiente se conserva; el cierre global RLS y sus otros consumidores
siguen pendientes, no se aplicó ningún cambio en Cloud.

16/10/2026. Base `7c03c2b` y `INVENTARIO-RLS-ADMIN-PENDIENTE.md`.
Revisión exclusivamente de los consumidores pendientes y sus contratos locales;
sin auditoría general ni consulta a Cloud. Las etapas 1–4 se conservan.

## Dependencia que obliga a detenerse

La función `routine_inventory_operation` de
`supabase/migrations/20261015180000_fase162_inventario_rutinas.sql:198` es
SECURITY DEFINER. Su secuencia actual es:

1. Identidad activa mediante `auth.uid()` y `current_user_role()`.
2. Lock de la clave idempotente y búsqueda del recibo.
3. Si existe y coinciden actor, rutina, acción y carga, **devuelve el resultado**.
4. Solo para una operación nueva bloquea la rutina y comprueba estado, rol y
   pertenencia a `job_assignees` (líneas 217–225).

Por lectura del código, un antiguo técnico que siga activo puede solicitar
su recibo anterior, con su UUID y carga originales, después de perder la
asignación. Cambiar las políticas de las tablas no interpone una comprobación
en esa rama SECURITY DEFINER. El resultado contiene identificadores de
operación/movimiento/evento/reversión; **no se ha demostrado una nueva escritura,
doble consumo, exposición de precios ni lectura de todo el inventario mediante
esa rama**. Es una carencia de autorización vigente del acceso al recibo.

Esto es evidencia del archivo local, no una prueba ejecutada contra Cloud ni
una confirmación de su definición desplegada. No se alteró Fase 162 ni se probó
el ataque sobre datos reales. No se debe extrapolar la corrección de recibos
de etapa 3, exclusiva de Altas/Averías, a esta función distinta.

Para garantizar el mismo límite de autorización en Rutinas es necesario
interponer la comprobación vigente también antes de devolver recibos y
coordinarla con devolución/reasignación/cierre. Modificar esa función o
revocar su EXECUTE para sustituirla por un wrapper cambia la seguridad efectiva
de Fase 162, aunque se conserve su archivo original. Dejar el endpoint anterior
ejecutable permitiría eludir un wrapper; revocarlo rompe clientes existentes.
No se implementa esa modificación bajo la restricción de mantener Fase 162 sin
modificar. Tampoco se elimina el recibo o el reintento offline como atajo.

## Consumidores pendientes comprobados, sin ampliación de auditoría

| Consumidor | Dependencia concreta | Efecto de cerrar directamente las tablas |
| --- | --- | --- |
| `server/src/services/fieldInventory.ts` | Las consultas mínimas de etapas 1–2 usan el JWT solicitante y SELECT sobre tablas de inventario; el filtro backend no reemplaza RLS | ADMIN/SUPERADMIN solamente en tablas dejaría sin resultados las lecturas de Campo. Necesitan una frontera SQL/backend contextual con DTO mínimo; no añadir service_role genérico |
| `RoutineInventory.vue:56` | Movimientos con `*`, unidades con `*`, eventos por rutina, catálogo compartido, equipos de cliente y de producto | Perdería materiales, series y selección de equipos. Mantener esos SELECT amplios permitiría consultar las mismas filas directamente |
| `RoutineInventory.vue:81` | RPC Fase 162 y reintento persistido de `routineInventoryRequest.ts` | Las escrituras SECURITY DEFINER y la rama de recibos requieren el contrato indicado arriba; RLS sola no lo corrige |
| `TicketDetailView.vue:166` y `ticketApprovals.ts` | Materiales por ticket; unidades pendientes; aprobación/rechazo mediante `inventoryUnits.registerEvent`, INSERT con SELECT de retorno | Soporte perdería consulta y aprobaciones legítimas. Requieren operaciones de oficina contextualizadas; no conceder inventario administrativo completo a SOPORTE |
| `ClientServiceDetailView.vue:542` | Equipos por cliente, catálogo, stock por producto; asignación, retorno y cambio de contrato con stores directos | Las operaciones de perfiles no administrativos dejarían de funcionar. No hay jobId en varias de estas operaciones: no inferir una orden a partir del cliente |
| `tickets.ts:89` | Devolución compensatoria al eliminar ticket, documentada solo ADMIN/SUPERADMIN | Conservar en acceso administrativo; no trasladar esta operación a técnicos |

La adaptación de lecturas de Rutinas y Soporte/Clientes sigue siendo necesaria,
pero no resuelve por sí sola el contrato de recibos de Fase 162. No se hicieron
cambios parciales antes de resolver esa dependencia.

## Pruebas y entrega

- Inspección focalizada de consumidores y del orden de autorización/retorno de
  la RPC: dependencia confirmada en el código local, sin ejecución SQL.
- No se repitieron pruebas de etapas 1–4 ni suites funcionales aprobadas.
- No se ejecutaron nuevas pruebas JWT/RLS en laboratorio: la parada ocurre
  antes de preparar políticas; no se presentan resultados simulados como reales.
- El bootstrap actual `scripts/inventory-auth-lab/schema.mjs` declara
  expresamente que no instala Fase 162. Su validación previa no certifica esa
  compatibilidad. No se reinicializó ni se aplicó nada al laboratorio existente.
- Solo documentación en el commit de esta detención. Sin código, migración
  parcial, cambios de esquema/permisos, Cloud, producción, datos reales,
  ocho equipos históricos, push ni despliegue.

## Mínimo necesario para levantar el bloqueo, sin iniciar trabajo nuevo

Resolver explícitamente el límite de compatibilidad: autorizar una corrección
acotada de autorización de la RPC Fase 162, manteniendo firma, cargas, UUID,
resultados persistidos y trazabilidad; o aceptar que su cierre de seguridad
queda fuera, en cuyo caso **no se puede aprobar el cierre consolidado**.

Si se autoriza esa corrección, comprobar primero en un laboratorio conservado
con fixtures ficticias compatibles con Fase 162: recibo propio antes/después
de revocación, apoyo/líder/ajeno, cambio de rol/usuario activo, reintento con
respuesta perdida y concurrencia contra devolución/reasignación/cierre. No
copiar automáticamente el orden de locks de Altas/Averías ni mantener una
transacción abierta durante sockets.

Después, y solo con esa compatibilidad demostrada, preparar en un único
conjunto las lecturas contextuales restantes, operaciones de oficina necesarias,
restricción de políticas permisivas y guard administrativo de
`inventory_get_albums`, con pruebas JWT de ADMIN/SUPERADMIN permitidos y resto
denegado para acceso directo. Esta secuencia delimita la dependencia; no inicia
una fase ni una investigación adicional.

Rollback de esta entrega: únicamente revertir el documento y su referencia;
no existe SQL ni dato operativo que restaurar. La entrega no está lista para
despliegue ni contiene una migración RLS segura para aplicar.
