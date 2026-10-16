# Etapa 3 — escrituras contextuales y RETURNING

15/10/2026. Base local: `3d6a68a`, etapas 1/2 y bloqueo documentado.
**BLOQUEADO antes de implementar cambios de esquema o permisos.**

La decisión del usuario congela las ocho unidades indeterminadas. Su revisión
administrativa es independiente: no se consultaron de nuevo, no se amplían
retiros ni se reconstruyen relaciones. Rutinas/Fase 162 quedan fuera.

## Consumidores concretos todavía dependientes de acceso amplio

| Acción de Campo (Altas/Averías) | Escritura actual | Dependencia / adaptación requerida |
| --- | --- | --- |
| Añadir material y kit de Alta | `inventory.registerUsage` → `registerMovement` | INSERT + SELECT de movimiento; usa balance_after para saldo local. Contextualizar producto/cantidad/orden; respuesta sin saldo administrativo. El kit realiza varias llamadas: definir explícitamente si conserva resultados parciales o se hace atómico; no ocultar éxitos al reintentar. |
| Corregir cantidad | `handleSaveMaterialQty` → reversión + nuevo consumo | Dos peticiones separadas; puede confirmarse solo la primera. Una operación transaccional debe insertar ambas filas o ninguna. |
| Quitar material | `revertMovement` | Deriva cantidad/producto/orden desde un objeto de UI. Resolver movimiento original en servidor, comprobar pertenencia y evitar doble reversión concurrente. |
| Asignar equipo a Alta | `inventoryUnits.assignUnit` | INSERT evento + SELECT expandido con autor/cliente. Validar stock/vínculos y derivar cliente/contrato de la orden. |
| Retirar equipo de Alta | `performUnitAction` → `markRepaired` | GET previo seguido de INSERT sin contexto. Ventana entre autorización y escritura; recuperar vínculo anterior dentro de la transacción. |
| Registrar entrante de Avería | `stageUnitFromTicket` | INSERT pending_approval + SELECT expandido. Conservar aprobación de oficina; técnico no puede asignar directamente. |
| Retirar saliente de Avería | `returnUnit` | INSERT de devolución; validar equipo contra contrato exacto y estado anterior, no solo cliente o unitId enviado. |
| Desvincular pendiente de Avería | `performUnitAction` → `rejectUnit` | GET previo + INSERT sin contexto. Validar pending_approval y ticket exacto bajo bloqueo. |

Fuentes: `src/views/campo/CampoTrabajoDetailView.vue`,
`src/stores/inventory.ts`, `src/stores/inventoryUnits.ts`,
`src/lib/fieldInventoryClient.ts`. No se incluyen CRUD administrativo,
aprobaciones de oficina ni escrituras de Rutinas.

## Por qué no basta un POST que delegue los INSERT actuales

El endpoint actual `server/src/routes/fieldInventory.ts` utiliza el JWT del
solicitante con Supabase REST; no ofrece una transacción que incluya lectura,
autorización, varias escrituras y resultado. Un control previo seguido de
INSERT conserva la carrera con reasignación/devolución de orden. Cambiar
`select('*')` por columnas mínimas reduce la respuesta, pero no elimina la
dependencia de SELECT ni garantiza autorización transaccional.

Las migraciones versionadas contienen locks de stock/unidad en triggers y
trazabilidad `reverses_movement_id`; el índice original de reversión es normal,
no una garantía de unicidad. No se afirma que este inventario de código sea una
nueva auditoría del esquema desplegado. No hay un protocolo general de claves
de intención en estos consumidores: volver a pulsar o repetir la petición tras
perder la respuesta puede crear otro consumo/evento. La cola offline de cierre
de trabajo no soluciona automáticamente las mutaciones de inventario.

Por tanto, no se implementa un POST parcial ni se cambia la UI para depender
de una operación inexistente. La condición del usuario exige preparar propuesta
y detenerse si se requieren esquema o permisos.

## Propuesta mínima para revisión

1. **Frontera transaccional.** Preferir una función RPC nueva para Altas/Averías,
   con wrapper HTTP autenticado opcional, antes que introducir credenciales SQL
   privilegiadas en el backend. Crear una función es cambio de esquema aunque
   no cree tablas. No se escribe SQL ejecutable ni se crea la RPC en esta entrega.
2. **Contrato de solicitud.** `operationId` estable por intención, jobType,
   jobId y acción cerrada: consume, correct, reverse, assign, unassign, stage,
   return, unlink. Solo IDs de producto/unidad/movimiento necesarios, cantidad,
   condición permitida y motivo limitado. No aceptar actor, saldo, cliente,
   contrato ni estado destino arbitrarios del navegador. Orden/contrato sin
   relación demostrada se rechaza; las ocho unidades no reciben excepciones.
3. **Identidad y autorización.** Obtener identidad de auth.uid(), perfil activo,
   rol permitido y job_assignees vigente leader/support para TECNICO_RED.
   ADMIN/SUPERADMIN según reglas actuales; SOPORTE/FACTURACION sin acceso a
   esta nueva operación de Campo. No modificar sus flujos existentes de oficina.
   Comprobar estado permitido, contrato exacto y cliente en la misma transacción.
4. **Bloqueos.** Definir orden estable de locks: orden, perfil/asignación,
   intención, movimientos originales y productos/unidades en orden de ID.
   Las operaciones que reasignan/devuelven/cambian estados deben respetar un
   bloqueo compatible. Bloquear una fila de asignación existente no impide por
   sí solo insertar otra: validar protocolo real antes de afirmar serialización.
5. **Reglas existentes.** Insertar en el Kardex/eventos actuales para ejecutar
   sus triggers de stock, límites ONU, estados y órdenes cerradas. No actualizar
   stock/unidades directamente ni borrar/recrear historial. Reversión y nuevo
   consumo en la misma transacción; comprobar original bajo lock y ausencia de
   reversión previa. Un error revierte todo. La función no debe ejecutar ramas
   de Rutinas ni sustituir triggers compartidos.
6. **Reintentos durables.** Evaluar primero las PK UUID existentes como IDs
   estables de cada fila de una intención, sin añadir columnas. Para correct,
   conservar dos IDs estables y comparar la carga original con las filas
   resultantes. Resolver replay antes de disparar INSERT/triggers; misma clave
   con otra carga se rechaza. No confiar en un SELECT previo sin lock, en
   `ON CONFLICT` como sustituto del protocolo ni en una caché de proceso.
   Si las filas existentes no permiten reconstruir/comparar una intención
   completa y su resultado, justificar un recibo persistente mínimo antes de
   proponer una tabla. Esta entrega no demuestra necesaria una tabla nueva.
7. **RETURNING mínimo.** Retornar recibo con operationId, contexto verificado,
   IDs/tipo/cantidad de movimientos o ID/estado del evento y unidad, y hora de
   servidor. Sin precios, balance_after, valorizaciones, documentos, emails ni
   joins administrativos. El cliente recarga las lecturas contextuales; no
   actualiza un saldo general desde el resultado de una escritura de Campo.
8. **Permisos futuros.** Evaluar primero SECURITY INVOKER: no resuelve por sí
   mismo futuras RLS restrictivas si necesita SELECT amplio. Si se justifica
   SECURITY DEFINER, dueño mínimo, search_path seguro, nombres cualificados,
   sin SQL dinámico, auth.uid y autorización estricta antes de cualquier dato o
   mutación; revocar PUBLIC/anon y definir EXECUTE de forma explícita. Son cambios
   de permisos sujetos a revisión posterior, no realizados aquí. No usar
   service_role como atajo ni elevar al usuario con un rol recibido del cliente.

## Secuencia compatible y pruebas exigidas antes de activar

1. Revisar contrato y necesidad exacta de esquema/permisos; confirmar compatibilidad
   con la versión real del esquema mediante evidencia acotada cuando se autorice.
2. Implementar y probar la operación únicamente en PostgreSQL aislado, cargando
   triggers existentes reales. Casos líder/apoyo, ajeno, inactivo, SOPORTE,
   FACTURACION, ADMIN/SUPERADMIN; cierre/reasignación concurrentes; stock insuficiente;
   equipo ajeno, contrato incorrecto, devolución y aprobación pendiente.
3. Probar duplicado simultáneo, respuesta perdida, replay tras reinicio y misma
   clave con carga diferente. Dos técnicos revirtiendo el mismo movimiento:
   una reversión; fallo del consumo corregido: cero filas/saldo cambiados.
4. Adaptar solo consumidores de Campo Altas/Averías a respuesta mínima, preservando
   IDs de intención hasta confirmación. No repetir automáticamente un error con
   clave nueva ni borrar borrador por resultado incierto; resolverlo con la misma
   identidad e intención y revalidar autorización al reintentar. No prometer una
   cola offline de inventario que no existe. No tocar la cola de cierres actual.
5. Pruebas de integración con frontend/backend juntos y fallo de RETURNING;
   regresiones de Altas/Averías. Mantener clientes antiguos operativos hasta la
   etapa de permisos, sin fallback de un error contextual a INSERT directo.

## Entrega y estado

Solo documento de propuesta y nota de estado; no hay código funcional nuevo,
migración, cambio de RLS/grants, consulta Cloud, escritura operativa, push ni
despliegue. No se ejecutaron pruebas funcionales o compilación: no hay cambios
de implementación y no se repiten las 24 pruebas ya aprobadas. Se verifica
formato con `git diff --check`.

Pendientes: revisión del diseño transaccional/idempotente y autorización para
preparar el cambio local de esquema que requiera; sesiones reales de líder,
apoyo y ajeno; Realtime/clientes antiguos continúan como riesgos de etapas
posteriores. No cerrar RLS ni presentar esta etapa como implementada.

Rollback: retirar este documento no altera operación ni datos. Cualquier futura
activación debe tener rollback de consumidores/función/permisos independiente,
sin borrar movimientos ni recibos ya confirmados.
