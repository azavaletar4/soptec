# Etapa 4 — Realtime de inventario: propuesta y parada

Fecha: 16/10/2026. Base: `eaa4510`.

**BLOQUEADO para implementación y validación.** Se cumple la condición del
usuario: «Si Realtime requiere cambios de políticas, publicaciones o
infraestructura, preparar la propuesta y detenerse antes de aplicarlos».
No se han aplicado cambios de infraestructura, políticas ni publicaciones,
siquiera en el laboratorio. Esta entrega es documental, sin código funcional.

## Inspección acotada

| Consumidor actual | Suscripción y efecto |
| --- | --- |
| Campo, Alta | `CampoTrabajoDetailView.vue`, `setupRealtimeSync`: cambios de `inventory_movements` por `installation_id` recargan materiales; `inventory_units` por `installation_id` recarga equipos |
| Campo, Avería | Mismo componente: movimientos por `ticket_id` recargan materiales; unidades por `ticket_id` recargan equipos asignados/pendientes |
| Cuadrilla de la orden | `job_assignees` por `job_id` llama `loadAssignees`, que vuelve a consultar inventario contextual para Altas/Averías |
| Administración de Inventario | No se encontraron suscripciones de inventario en `src`; vistas y stores administrativos cargan por consultas y refrescos tras acciones. Conservar esos refrescos, sin introducir un canal compartido con Campo |
| Rutinas | Comparte el canal de cuadrilla en ese componente, pero no suscribe allí movimientos/unidades de inventario. Fuera de alcance; no cambiar su rama |

La búsqueda se limitó a sitios `.channel`, `postgres_changes`, suscripción y
limpieza en `src`, y a la configuración local del laboratorio. Las alertas de
agenda, tickets y telemetría no son consumidores de inventario; no se modifican.

Aunque los callbacks de inventario ignoran el payload, el transporte actual es
`postgres_changes` sobre filas de negocio. Ignorarlas en JavaScript no protege
su contenido. Los filtros por orden tampoco reemplazan autorización. Un retiro
que elimina el vínculo de la unidad exige invalidar también el contexto anterior;
no basta con filtrar su nueva fila. `subscribe()` no tiene callback de estado que
garantice recarga contextual tras reconectar. `removeChannel` existe al desmontar.

`loadMaterials`, `loadInstallEquipos` y `loadEquipos` ya usan el cliente contextual;
reutilizarlo. Falta impedir que respuestas antiguas restauren datos tras una
revocación o cambio de contexto, y limpiar todos los selectores y cachés al denegar.

La migración versionada Fase 121 agrega `job_assignees`, `work_order_photos`,
`inventory_movements` e `inventory_units` a `supabase_realtime`. Esto describe
archivos locales, **no certifica el estado desplegado de Cloud**. No se consultó
ni modificó Cloud en esta etapa.

## Bloqueo confirmado en el laboratorio

Lectura de su compose existente, sin mostrar secretos: servicios `db`, `auth`,
`rest`, `edge`; red `lab` interna; ningún servicio Realtime configurado. Coincide
con `prepare.mjs`. El gateway y Vite tampoco exponen un transporte WebSocket
Realtime. No se intentó arrancar otro servicio ni recrear el laboratorio.

Para probar invalidaciones privadas con JWT reales hacen falta transporte local,
encaminamiento y autorización de suscripciones. Cambiar solo el callback actual
no elimina las filas transmitidas ni permite certificar la revocación.

## Secuencia propuesta, pendiente de autorización

1. **Preparar transporte únicamente local y aditivo.** Conservar volumen, Auth,
   fixtures y journals. Añadir Realtime compatible con PostgreSQL/Auth existentes,
   ruta WebSocket local y configuración explícita del cliente de laboratorio.
   Aislarlo de toda salida operativa. No reutilizar `prepare.mjs` sobre el runtime
   existente ni modificar allowlists para permitir Cloud. Comprobar compatibilidad
   de JWT ES256/JWKS antes de tocar consumidores.
2. **Preparar autorización y emisión privadas.** Archivos separados de etapa 3
   y Fase 162. Proponer canales privados por tipo/ID de orden, sin SELECT de
   tablas administrativas para recibir invalidaciones. Autorizar usuario activo,
   rol y pertenencia vigente a `job_assignees`, comprobando el tipo además del ID
   y el estado de orden permitido según reglas existentes. Impedir emisión por
   clientes; el servidor emite únicamente tras cambios confirmados. Payload
   permitido: versión de protocolo y señal de invalidación; sin unidades,
   movimientos, series, MAC, clientes, contratos, importes ni identificadores de
   equipos. No usar funciones privilegiadas sin esas comprobaciones.
3. **Resolver revocación antes de elegir el mecanismo definitivo.** No aceptar
   como garantía una autorización comprobada solo al entrar al canal. Demostrar
   con conexión ya abierta qué ocurre al retirar/reasignar al técnico, desactivar
   al usuario, cerrar/devolver la orden y renovar JWT. Si el transporte mantiene
   autorizaciones antiguas, exigir revocación efectiva o entrega con autorización
   vigente por destinatario desde backend. Si esto requiere otro transporte,
   presentar ese coste antes de implementarlo. No enviar datos protegidos por
   broadcast ni considerar suficiente ocultarlos en la pantalla. Hasta pasar esta
   prueba no está aprobada la arquitectura ni procede cerrar RLS administrativo.
4. **Emisión completa sin duplicar operaciones.** Cubrir escrituras de Campo y
   administración sobre las mismas tablas, no solo la RPC. Derivar contextos
   anterior y nuevo de vínculos verificables; contemplar cambio de contrato y
   equipo saliente. No ampliar relaciones históricas ambiguas. Evaluar señales
   de catálogo/stock para selectores autorizados, sin abrir una suscripción
   global de productos al técnico. El emisor no escribe movimientos ni recibos.
5. **Adaptar solo Altas/Averías.** Sustituir sus dos suscripciones de filas por
   invalidaciones; mantener aislada la rama de Rutinas y sus alertas. Al recibir
   señal, coalescer recargas y consultar mediante `fieldInventory.read` con orden
   vigente. Descartar respuestas de generaciones anteriores. Ante 401/403,
   limpiar datos, selectores y canal, sin fallback a tablas administrativas.
   Revisar la señal de cambio de cuadrilla para que la propia revocación no
   dependa de una fila que el técnico ya no puede leer.
6. **Recuperación.** Reconexión, renovación JWT, vuelta a primer plano o cambio de
   red: reautorizar y recargar contexto completo permitido; no depender de replay
   de eventos. Reintentos acotados con backoff para errores transitorios. Una
   invalidación nunca ejecuta escrituras ni repite una intención de consumo.
   Mantener identificadores e idempotencia de etapa 3 sin modificarlos.

No eliminar tablas de la publicación compartida como atajo: podría afectar
otros consumidores. Una política nueva sobre mensajes tampoco restringe por sí
sola las lecturas REST amplias existentes; ese cierre sigue siendo otra etapa.

## Validación nueva requerida, no ejecutada

- JWT reales de líder/apoyo reciben señal de su Alta/Avería y refrescan solo DTO
  contextual; ajeno, retirado, SOPORTE y FACTURACION no reciben información de
  esas órdenes. Mantener separados los canales y consultas administrativos.
- Revocar con socket abierto y petición en vuelo; comprobar también reconexión,
  token renovado, canal manual de otra orden y emisión directa falsificada.
  Inspeccionar frames de red, no solo la vista: ninguna fila protegida debe viajar.
- Retiro/liberación de equipo notifica la orden anterior; cambio desde
  administración actualiza Campo autorizado. Orden/contrato incorrectos no
  exponen equipos. Sin eventos del inventario histórico ambiguo real.
- Desconexión, eventos duplicados/en ráfaga, reconexión sin replay: recarga final
  correcta, consultas acotadas, ninguna escritura o movimiento duplicado.
- Refrescos administrativos actuales conservados. Rutinas/Fase 162 sin cambios.

No se ejecutaron pruebas funcionales nuevas: falta el transporte que deben
ejercitar. No se repitieron pruebas aprobadas de etapa 3 ni las 49 lecturas/8
escenarios previos. Únicamente inspección estática y lectura local sanitizada
del compose; no certifican entrega, revocación ni conectividad Realtime.

## Archivos, riesgos y rollback

Entrega: este documento. Nota de continuidad añadida a `ESTADO_DESARROLLO.md`,
conservando sus cambios previos fuera del commit documental. Sin cambios a código,
migraciones, runtime ni datos del laboratorio. Cambios ajenos de Fases 161/162
quedan excluidos.

Riesgos pendientes: permisos amplios REST actuales, contenido de las suscripciones
de filas actuales, revocación de conexiones abiertas, eventos perdidos al liberar
FK, respuestas en vuelo y compatibilidad del servicio Realtime local. **La etapa 4
no está implementada ni aprobada.** No habilitar la futura restricción RLS aún.

Rollback actual: revertir únicamente el commit documental; no hay cambios de
infraestructura o datos que revertir. Para una implementación posterior, preparar
retirada del emisor/canales y servicio local sin borrar el volumen ni historial;
no volver a suscripciones amplias si ya se hubiese restringido el acceso.

Sin producción, Cloud, migraciones remotas, push ni despliegue. Las ocho unidades
indeterminadas siguen intactas y no se volvieron a investigar.
