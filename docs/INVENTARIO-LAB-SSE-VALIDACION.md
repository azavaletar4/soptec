# Etapa 4 — SSE con barrera SQL: BLOQUEADO en laboratorio

16/10/2026. Base `d30a331`. Implementación experimental local y prueba real,
**no aprobada para integrar ni desplegar**. Se detuvo al demostrar un aviso
posterior a una revocación confirmada, conforme a la condición del usuario.

## Qué se implementó

- Backend HTTP independiente Node, solo `127.0.0.1:54387`, sin importar la
  aplicación operativa ni sus schedulers. No cambia gateway, frontend, Realtime
  anterior ni mecanismos administrativos. Requiere `LAB_SSE_ENABLE=1` explícito.
- Endpoint `GET /events/<tipo>/<id>` con Bearer JWT real GoTrue. Verificación ES256
  con JWKS local, issuer, audience, rol authenticated, sujeto y expiración.
  Se vuelve a verificar antes de cada entrega. Sin tokens en URL ni logs.
- Autorización SQL fresca: perfil activo/rol, orden/estado y pertenencia vigente
  líder/apoyo. `FOR SHARE NOWAIT` sobre perfil, orden y asignación; transacción
  abierta hasta `response.write` y commit inmediatamente después, sin esperar
  red ni `drain`. Ante denegación, contención o presión de salida, no hay fallback
  administrativo. El stream se cierra; errores iniciales devuelven JSON sin datos.
- Rol LOGIN `lab_sse_backend`, sin superusuario ni SELECT de tablas de inventario.
  Usa psql por socket Unix dentro del contenedor fijo existente: no instala
  drivers, no publica PostgreSQL ni introduce credenciales reales. Sin contraseña
  TCP. Solo puede ejecutar funciones del esquema experimental `lab_sse`.
- Funciones privilegiadas locales con search_path fijo y EXECUTE restringido.
  El sujeto proviene exclusivamente del JWT validado por backend, no de un
  parámetro del navegador. El control de señales verifica ADMIN/SUPERADMIN activo.
- Dos órdenes nuevas, programada/abierta, con cuadrillas de usuarios ficticios
  existentes; tabla de revisiones limitada a esa fixture. Señal de control
  transaccional, consulta de revisiones cada 250 ms y guard individual por entrega.
  Payload exacto `{v:1}`, evento fijo `invalidate` e ID numérico de revisión.
  Deduplicación por conexión; al reconectar se entrega revisión vigente y se
  reconsulta el contexto permitido. No se reproducen eventos históricos.

El emisor del ensayo es un control ADMIN local, **no un trigger integrado con
movimientos reales**. El protocolo SSE se prueba con HTTP real, no con la pantalla
completa de Campo. No se modificaron tablas ni triggers existentes de inventario,
ni escrituras de Altas/Averías. La migración de etapa 3 no se volvió a ejecutar.

## Pruebas nuevas, JWT reales y datos ficticios

Evidencia: `INVENTARIO-LAB-SSE-RESULTADOS.json`.

| Escenario | Resultado |
| --- | --- |
| Líder, apoyo y futuro retirado / técnico ajeno | PASS: SSE 200 para asignados; ajeno 403 sin contexto |
| Señal mínima y deduplicación | PASS: una señal `{v:1}` por revisión en tres conexiones; sin filas protegidas |
| Retirada con conexión abierta | PASS en operación normal: RPC de cuadrilla con JWT ADMIN; no llega revisión nueva al retirado y servidor cierra stream |
| Reconexión del retirado | PASS: mismo JWT y otro obtenido por login real son rechazados |
| Cambio de identidad | PASS de protocolo: conexiones distintas no heredan identidad; no certifica UI completa de cambio de sesión |
| Reasignación de Avería | PASS: RPC real con JWT ADMIN; líder/apoyo anteriores dejan de recibir; ajeno pasa a recibir al ser asignado |
| Cierre de Avería | PASS: PATCH real con JWT ADMIN; stream anterior deja de recibir y no puede reconectar |
| Corte temporal | PASS: nueva conexión recupera revisión vigente; consulta contextual real 200 de su orden, sin materiales ajenos |
| Pausa del backend y pérdida de la transacción SQL | **FAIL bloqueante:** aviso escrito y recibido después del commit de revocación |

**8 PASS, 1 FAIL.** No se repitieron suites anteriores de Broadcast, lecturas ni
transacciones de inventario. Las pruebas de autorización se ejecutaron de nuevo
porque el transporte SSE es nuevo y constituye el objeto de esta validación.

La primera ejecución reveló un defecto del handshake: el cierre por fallo SQL
destruía la respuesta de un usuario no autorizado antes de escribir su 403.
Se corrigió para devolver primero el error cuando aún no hay cabeceras SSE.
No había pruebas funcionales completadas ni revisiones incrementadas; se verificó
ese checkpoint antes de reanudar. Se conserva informe previo en runtime.

## Fallo de la barrera: secuencia observada

El prototipo limita la inactividad transaccional a **500 ms** para evitar dejar
operaciones de cuadrilla esperando indefinidamente si el proceso se pausa.
Una pausa de event loop de **1.800 ms** se inyectó después de obtener autorización
y antes de escribir. Este control solo se habilita con `LAB_SSE_TEST_FAULTS=1`,
exige ADMIN ficticio y afecta únicamente a la fixture.

| Punto | Tiempo UTC observado |
| --- | --- |
| Autorización completada y checkpoint antes de pausa | 15:45:22.773 |
| Sesión PostgreSQL ya terminada; RPC de retirada confirmada; marcador posterior a su respuesta | 15:45:23.605 |
| Backend reanudado, nuevo `response.write` del aviso | 15:45:24.581 |

El aviso se encoló **976 ms después del marcador que confirma la revocación**;
el receptor lo recibió. No es un paquete enviado antes del commit que llegó
tarde: la escritura misma ocurrió después. El ensayo comprobó desaparición del
PID SQL, confirmó el cambio mediante la RPC de cuadrilla con JWT ADMIN real y
guardó el marcador antes de que el backend reanudara.

La pérdida de la sesión libera los locks, pero el evento FATAL de psql todavía
está pendiente en el event loop pausado. El booleano local `db.healthy` sigue
siendo true hasta procesar ese evento. Por ello no prueba que la barrera siga
existiendo al escribir. Validar rol/membresía con SQL y comprobar el estado del
socket SQL no establece atomicidad entre PostgreSQL y el transporte HTTP.

Esto demuestra que **este prototipo y esta barrera son insuficientes**; no es
una prueba de que todo diseño SSE sea imposible. Un plazo monotónico podría
evitar este caso particular de timeout, pero necesitaría pruebas adicionales
frente a terminación/reinicio SQL antes de ese plazo. No se implementó otra
variante después del FAIL: se cumplió la parada solicitada.

No se desactiva el timeout como supuesto arreglo: una pausa podría retener locks
y afectar la reasignación/cierre. Tampoco se desplaza el commit antes del envío,
lo que reabriría la carrera ya identificada.

Referencias de semántica utilizadas: [bloqueos PostgreSQL 17](https://www.postgresql.org/docs/17/explicit-locking.html)
y [response.write de Node](https://nodejs.org/api/http.html#responsewritechunk-encoding-callback).
La evidencia del fallo procede del ensayo local, no solo de esas referencias.

## Estado final y límites

El servidor SSE del ensayo quedó **detenido**. Auditoría final de solo lectura:
`INVENTARIO-LAB-SSE-AUDITORIA.json`.

- Productos, unidades, movimientos, eventos y recibos: comparación completa por
  ID/contenido contra el baseline previo, **sin cambios**.
- Rol backend: sin superusuario, sin SELECT administrativo de inventario.
- Cero transacciones SSE sin terminar; puerto 54387 sin servidor escuchando.
- Fixture y journals conservados. Alta quedó con apoyo como líder; Avería cerrada
  con el técnico antes ajeno como líder. Estos cambios afectan solo las dos
  órdenes nuevas. No se alteraron órdenes anteriores del laboratorio.

No se comprobó una garantía general de ausencia de bloqueos/deadlocks ni múltiples
instancias. Quedan pendientes integración de emisores con inventario, frontend de
Campo, catálogos/stock compartidos, cambios administrativos, ráfagas/backpressure,
expiración prolongada, desactivación y estrés. No se certifica sincronización
operativa integral a partir de señales de control sobre órdenes vacías.

Las actualizaciones administrativas actuales se conservan porque no se tocaron
sus archivos ni servicios; no se repitió su regresión. Rutinas/Fase 162 permanecen
separadas. No se consultaron ni modificaron los ocho equipos históricos.

## Archivos, commit y rollback

- `scripts/inventory-auth-lab/sse-prepare.mjs` y `sse-schema.sql`: fixture aditiva,
  rol mínimo y funciones locales; no son migraciones de aplicación/Cloud.
- `sse-pg-session.mjs` y `sse-server.mjs`: prototipo aislado con barrera y control
  de fallo explícito. **No usar como transporte seguro aprobado.**
- `sse-validate.mjs`: ensayos JWT reales y reproducción; journal impide repetir
  sobre el estado final. No resetear ni volver a ejecutar fixture/validación.
- `sse-audit.mjs`: comprobación final de solo lectura, repetible.
- README del laboratorio, este documento, resultados y auditoría JSON.
- Nota en `ESTADO_DESARROLLO.md` fuera del commit para preservar cambios previos.

Se verificó sintaxis de los cinco `.mjs`, diff y ausencia de secretos literales.
No se hizo build de aplicación: no cambió su código ni dependencias. El commit
conserva el experimento y su fallo comprobado; no representa funcionalidad lista.

Rollback: conservar la parada del proceso SSE. Revertir Git no elimina el rol,
esquema, fixture ni journals locales. Su retirada se revisaría separadamente,
sin borrar volumen, Auth ni inventario; no se ejecutaron borrados de rollback.
Para continuar, primero revisar una garantía que coordine el estado de revocación
y el emisor incluso si se pierde la sesión SQL, con un modelo de fallo explícito.

Sin Cloud, producción, migraciones remotas, push, despliegue ni datos reales.
