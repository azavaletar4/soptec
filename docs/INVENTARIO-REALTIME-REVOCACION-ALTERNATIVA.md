# Revocación Realtime — causa exacta y alternativa de servidor

16/10/2026. Base `0aa40d3`.

**BLOQUEADO en Broadcast. Alternativa propuesta, no implementada ni aprobada.**
Se cumple la condición de parada del usuario: si el servidor actual no ofrece
la garantía requerida, documentar un transporte alternativo. No se presenta una
renovación de token o abandono del canal desde el navegador como corrección.

## Causa raíz en la versión instalada

Se revisó exclusivamente el código oficial de Realtime **v2.143.3**, la misma
imagen del laboratorio, y la evidencia ya conservada. No se repitió el ensayo.

En [`realtime_channel.ex`](https://github.com/supabase/realtime/blob/v2.143.3/lib/realtime_web/channels/realtime_channel.ex):

- `maybe_assign_policies`, líneas 972–989: guarda el resultado de autorización
  en `socket.assigns.policies`.
- `fastlane_metadata`, líneas 1015–1026: incorpora el permiso de recepción al
  camino de despacho; no consulta la pertenencia en cada mensaje.
- `handle_info`, líneas 308–320: utiliza ese permiso almacenado para rechazar o
  transmitir el evento.
- `handle_in("access_token", ...)`, líneas 492–495: si el token coincide con el
  anterior, no hace nada. Un heartbeat o reenviar el mismo JWT no revoca acceso.
- `apply_access_token`, líneas 541–565: un token nuevo borra la policy anterior,
  reautoriza y comprueba revocación. Esto depende de que llegue ese token nuevo.

Eliminar una fila de `job_assignees` no invalida automáticamente ese estado
del proceso Realtime. La consulta REST sí lee la asignación vigente. Esta
diferencia explica el 403 REST simultáneo con un socket todavía autorizado.
La [documentación oficial](https://supabase.com/docs/guides/realtime/authorization#updating-rls-policies)
también describe la caché durante la conexión.

## Evaluación de revocación desde el servidor actual

El [`router.ex` de la versión fijada](https://github.com/supabase/realtime/blob/v2.143.3/lib/realtime_web/router.ex)
expone controles de tenant y emisión de Broadcast. No se encontró allí una API
pública para retirar atómicamente una suscripción de un usuario/orden al confirmar
el cambio de cuadrilla. No se afirma que todos los servicios Realtime posibles
carezcan de esa capacidad: la conclusión se limita a esta versión y configuración.

| Medida | Por qué no satisface la garantía |
| --- | --- |
| `unsubscribe`, logout o `setAuth` desde la aplicación | El receptor puede ignorarlo; no es una revocación impuesta por el servidor |
| JWT más breve | Reduce una ventana, pero sigue existiendo acceso después del commit |
| Notificación de revocación al cliente | El propio receptor debe actuar; eventos perdidos/reordenados no son una barrera |
| Recargar/reiniciar el tenant después del cambio | Afecta otras órdenes y deja una carrera entre commit y desconexión; no se ejecutó |
| Un canal por usuario y consultar destinatarios antes de emitir | Separar SELECT y envío deja una carrera con revocaciones concurrentes |
| Rotar el nombre de canal al reasignar | Requiere serializar emisores y revocación; no elimina mensajes ya encolados en el canal anterior |
| Trasladar la misma comprobación a una tabla RLS de avisos | Es candidata para otra garantía, pero no demuestra por sí sola que un evento autorizado antes del commit no se entregue después |

No se hizo un fork del servidor Realtime ni se cambiaron sus controles de tenant.
Tampoco se debilitó ninguna policy para forzar un resultado favorable.

## Alternativa concreta: stream de invalidación controlado por backend

Proponer un endpoint SSE autenticado por orden, consumido con `fetch` y cabecera
Bearer (sin token en URL), separado de Broadcast y de las suscripciones
administrativas. Un WebSocket controlado por el mismo backend sería equivalente;
SSE basta porque el cliente solo necesita recibir una señal. Se reutilizarían Auth,
el backend y las consultas contextualizadas; no hace falta transmitir inventario.

1. El servidor verifica firma JWT, issuer, audience, expiración y sujeto con las
   claves de Auth. Cada conexión queda fijada a ese sujeto y a tipo/ID de orden;
   una conexión no cambia silenciosamente de usuario.
2. Un emisor transaccional produce exclusivamente invalidaciones después de
   cambios confirmados, incluyendo los contextos anterior y nuevo al liberar
   equipos. LISTEN/NOTIFY puede servir como señal efímera de activación; no como
   autorización. Si se pierde una señal, se recupera mediante reconsulta contextual.
3. **Cada entrega requiere una autorización fresca y una barrera de concurrencia**.
   El backend inicia una transacción breve, valida usuario activo, rol permitido,
   orden/estado y pertenencia líder/apoyo, y conserva locks compatibles con las
   escrituras existentes de perfil, orden y asignación hasta terminar de encolar
   el único frame autorizado. La eliminación/actualización de esas filas debe
   esperar o ganar antes: no puede confirmar entre el chequeo y el envío.
4. Si gana la revocación, la autorización falla y no se inicia ninguna entrega.
   Si gana el envío, este debe quedar ordenado antes de que la revocación pueda
   confirmar. No vale liberar la transacción, devolver un booleano por REST y
   escribir el frame después. Una RPC stateless seguida de `write()` conserva
   precisamente esa carrera.
5. El stream solo transmite un evento fijo `invalidate` con `{v:1}`. El tipo/ID
   se fijan al abrir el endpoint; no viajan clientes, contratos, equipos, series,
   MAC, movimientos, importes ni el motivo de revocación. No guardar una cola de
   frames ya autorizados para enviarla más tarde. Ante denegación/error, descartar
   la señal; se puede cerrar el stream, pero la seguridad no depende de ese cierre.
6. El receptor autorizado reconsulta por `fieldInventory.read`. Desconexión o
   inicio de una conexión nueva exigen autorización nueva y recarga contextual.
   Ante 401/403 se vacían datos; respuestas de la sesión/contexto anterior se
   descartan. El receptor no ejecuta consumos ni repite escrituras al recibir avisos.
7. Un cambio de sesión crea otra conexión con otra identidad. Mantener abierta
   maliciosamente la conexión vieja no concede la identidad nueva: se sigue
   evaluando la autorización del sujeto original en cada entrega.

### Garantía y límites que deben quedar explícitos

Es posible diseñar una garantía de **no iniciar ni encolar nuevos avisos en el
servidor después del commit de revocación**, con la barrera anterior. No se ha
implementado ni demostrado aún. Incluso esa garantía no puede retirar bytes que
el servidor ya entregó al sistema operativo y que siguen en tránsito, ni impedir
que un navegador procese tarde un frame recibido antes. Por ello no prometer
literalmente que ningún byte previo será observado después del commit.

La prueba debe registrar el orden de commit y de encolado del servidor, además
de inspeccionar frames recibidos; medir solo el DOM no distingue esas carreras.
Si el criterio exige también cancelar paquetes ya enviados, ningún reemplazo de
transporte puede ofrecerlo; esa condición sigue bloqueante y no debe ocultarse.

### Dependencias y coste antes de implementar

- Hace falta una conexión PostgreSQL de transacción controlada por el backend,
  con rol dedicado de privilegios mínimos. Las llamadas HTTP independientes a
  PostgREST no permiten mantener el lock hasta el encolado SSE.
- La función o consulta de autorización debe reutilizar las reglas existentes,
  no un rol con SELECT administrativo amplio. Si se necesita SECURITY DEFINER,
  verificar identidad/rol/contexto estrictamente, search_path fijo, EXECUTE
  limitado y ninguna lectura arbitraria suministrada por el cliente.
- Revisar un orden de locks compatible con perfil/orden/cuadrilla, cierre y
  reasignación. Ante 55P03 o presión de salida, omitir/coalescer la señal y
  reconsultar al reconectar; no mantener locks esperando a un teléfono lento.
- Especificar qué se considera encolado en el adaptador HTTP y sus buffers;
  limitar tiempo, conexiones y backpressure. No basta una promesa de envío
  que se resuelve antes de escribir, ni un proxy con una cola no controlada.
- El mismo mecanismo debe aplicarse en todos los procesos/instancias; un mutex
  en memoria no serializa commits SQL ni otros emisores. Las reglas SQL deben
  cubrir bajas de perfil y todos los caminos existentes de revocación.

Estos cambios se proponen, **no se han realizado**. Evitar añadir credenciales
operativas o infraestructura de producción para intentar certificar el laboratorio.

## Pruebas: evidencia existente y pendientes nuevos

No se repitieron los diez PASS ni el FAIL previo. Se conserva intacto
`INVENTARIO-LAB-REALTIME-RESULTADOS.json`: cuatro JWT GoTrue reales, autorización
inicial de líder/apoyo, ajeno denegado y retirada de Alta con conexión abierta
que sigue recibiendo señal pese a REST 403. Son evidencia anterior, no pruebas
aprobadas de la alternativa.

Por la parada condicionada, **no se ejecutaron nuevas pruebas JWT**, ni se afirma
haber validado reconexión, cambio de sesión o reasignación. Para el transporte
alternativo quedan estos ensayos concretos:

| Ensayo nuevo | Criterio obligatorio |
| --- | --- |
| Líder/apoyo Alta y Avería | Señal mínima y reconsulta de su contexto; sin filas administrativas |
| Ajeno | Conexión denegada o cero señales; sin acceso a otras órdenes |
| Retirado con conexión abierta | Cero nuevos encolados tras commit, sin cooperación del cliente |
| Pausa entre autorización y envío | El commit de revocación espera al envío o este se cancela; jamás pasa entre ambos |
| Revocación gana primero | Chequeo posterior deniega aunque la conexión siga abierta |
| Reasignación con JWT ADMIN ficticio | Vieja cuadrilla deja de recibir; nueva cuadrilla autorizada, sin depender de `assigned_to` antiguo |
| Reconexión con JWT viejo y renovado | Ambos denegados para el retirado; autorizado recupera mediante reconsulta |
| Cambio de sesión | Socket viejo conserva su sujeto; nuevo usuario no hereda canales ni respuestas |
| Corte temporal y ráfaga | Reconsulta recupera estado; sin replay protegido ni escrituras duplicadas |
| Desactivación, cierre y devolución | Misma barrera de revocación, sin caché de perfil/estado que permita enviar |
| Instancias concurrentes y backpressure | Sin bloqueo de operaciones por clientes lentos ni entregas de colas antiguas |

## Alcance, archivos y rollback

Entrega documental: este archivo y aviso en README del laboratorio. Nota local
de continuidad en `ESTADO_DESARROLLO.md`, excluida del commit por sus cambios
previos. Sin cambios de código de aplicación, policies, transporte, fixtures ni
datos; no hay build ni pruebas funcionales nuevos que ejecutar sobre esos archivos.
Se verifican diff y alcance del commit, sin declarar etapa 4 aprobada.

Altas/Averías/administración mantienen su funcionamiento actual; no se activó el
transporte experimental para usuarios operativos. El bloqueo del laboratorio y
los permisos REST amplios pendientes no quedan corregidos por este documento.
Rutinas/Fase 162 y las ocho unidades históricas no se tocaron.

Rollback de esta entrega: revertir el commit documental. No deshacer `0aa40d3`,
el volumen ni sus journals; la evidencia previa queda conservada. Ningún cambio
en Cloud, producción, migraciones remotas, push, despliegue ni equipos reales.
