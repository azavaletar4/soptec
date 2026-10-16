# Etapa 4 — avisos genéricos: APROBADO EN LABORATORIO

16/10/2026. Base `8eeed0b` y evaluación posterior. Aprobación limitada al nuevo
reloj genérico y su consumidor de laboratorio. No aprueba producción ni el cierre
global de permisos de inventario. Los prototipos Broadcast/SSE por orden siguen
bloqueados; no se reactivaron ni corrigieron en esta entrega.

## Implementación y garantía real

`generic-clock.mjs` es un proceso separado, solo en `127.0.0.1:54388`. No importa
Auth, SQL, configuración Supabase, aplicaciones operativas ni ficheros de órdenes.
No conoce usuarios, permisos, cuadrillas, materiales o equipos. No tiene emisores
derivados de escrituras, RPC de notificaciones ni transacciones abiertas.

Un único reloj global emite cada 10.000 ms el frame literal de **33 bytes**:

```text
event: invalidate
data: {"v":1}

```

Sin `id`, `retry`, contador, fecha, tipo/ID de orden, sesión, motivo ni payload
variable. No envía un aviso inicial al conectar ni reinicia su reloj por usuarios.
El endpoint es genérico/público dentro del laboratorio: no necesita credenciales
ni concede lectura de información operativa. Ignora cabeceras de identidad o
último evento. No ofrece métricas HTTP; las del ensayo se obtienen por IPC local.
No espera clientes lentos ni guarda replay; cierra una salida con backpressure.

Un técnico retirado **continúa recibiendo el mismo reloj**, deliberadamente:
no existe un aviso relativo a su antigua orden que haya que revocar. La garantía
es ausencia de información de órdenes en la fuente y protocolo de notificaciones,
no ausencia de cualquier byte después de revocar acceso. Los sockets y su
temporización no participan en las transacciones de cuadrilla.

La página separada `/generic.html` usa el store Auth real y
`createFieldInventoryClient` existente. Cada aviso recarga únicamente materiales,
equipos asignados y pendientes de la orden visible, con JWT real. No consulta el
inventario administrativo ni cambia sus permisos. La selección fija el contexto
completo actor/orden/cliente/contrato esperado por el cliente existente.

El controlador mantiene resultados solo en memoria y en una sola orden:

- Cambio de actor, token, orden o logout: limpia resultados, aborta solicitudes
  anteriores y cambia de generación. Una respuesta vieja no puede restaurar datos.
- 401/403: vacía resultados, aborta el resto de la carga y pausa nuevos ticks.
  No vuelve a consultar automáticamente por cada señal. El usuario puede comprobar
  acceso explícitamente; si sigue denegado, vuelve a pausarse. Un contexto/sesión
  nuevo empieza con caché vacío y necesita otra autorización real.
- Offline, orden oculta o caída del productor: limpia/aborta; sin lecturas de
  fondo mientras no esté visible/conectada. La nueva conexión reconsulta estado
  permitido, sin reproducir eventos perdidos ni ejecutar escrituras.
- Una carga por generación en curso; ráfagas se coalescen, sin acumular trabajos.
- Reconexión con espera progresiva de 1 a 10 s. Se cancelan conexiones/timers
  anteriores; los callbacks antiguos no activan otra fuente.

La limpieza por revocación ocurre al recibir la siguiente denegación: normalmente
en el siguiente tick de 10 s más la latencia de consulta. No se promete borrado
instantáneo de información ya vista ni recuperación de datos que el usuario haya
guardado. Ante caída detectada del transporte se limpia también el resultado local.

## Pruebas ejecutadas

| Suite nueva | Resultado |
| --- | --- |
| `node --test scripts/inventory-auth-lab/generic-refresh.test.mjs` | **6/6**: 401/403, pausa/reintento, respuesta vieja de otro actor/orden, error viejo, 100 ticks concurrentes, offline/visibilidad y logout |
| `generic-validate.mjs` | **8 grupos PASS** con Auth real, navegador Chrome y API reales: roles, retirada, reasignación, limpieza, recuperación explícita, desconexión, sincronización visible, protocolo y recursos |
| `generic-headers.mjs` | **PASS** adicional: cuatro JWT reales y cabeceras Cookie/Last-Event-ID/X-Job-Id distintas producen exactamente las mismas cabeceras permitidas |
| `generic-reconnect.mjs` | **PASS** adicional: detener realmente el productor limpia caché; sin evento offline manual, se reconecta y ejecuta una sola recarga de tres vistas con JWT real de apoyo |
| Compilación de laboratorio | **Correcta**: Vite, 74 módulos; salida únicamente en runtime/generic-build, ignorada por Git |
| Auditoría de lectura final | Inventario/recibos íntegros; reloj del ensayo detenido |

Los cuatro usuarios ficticios existentes iniciaron sesión mediante GoTrue real:
líder, apoyo, ajeno y futuro retirado. Retirada/reasignaciones se ejecutaron con
JWT del ADMIN ficticio mediante la RPC existente en **PostgREST local**. No se
fabricaron sesiones de técnicos ni se utilizó service_role para sus consultas.
Se añadieron solo dos órdenes nuevas; ningún cambio de esquema, migración o RLS.

La rama 401 se comprobó en el controlador con un error controlado; los 403,
cambios de sesión y permisos se comprobaron contra Auth/API reales. No se hizo
un ensayo de expiración de JWT esperando una sesión completa de una hora.

### Protocolo y recursos observados

- Cuatro conexiones, seis frames por conexión: **24 frames idénticos**. Tres
  iniciales sin escrituras de actividad y al menos tres durante cambios de cuadrilla.
- Intervalos observados: **10.006–10.014 ms** en las cuatro conexiones; no hubo
  señal extra por retirada/reasignación. Tolerancia del ensayo local: ±500 ms.
- Mismo contenido para líder/apoyo/ajeno/retirado. Cabeceras sin IDs, cookies de
  respuesta, fecha, ETag o metadatos operativos. El proxy usa una URL fija,
  `/generic-clock`, sin contexto de orden.
- Tramo medido: cinco conexiones (cuatro muestras y navegador), **57,34 MiB RSS**,
  **7,53 MiB heap**, **24 peticiones contextualizadas**; cero peticiones externas
  y cero excepciones de aplicación. CPU reportada por Node: 0 ms en esa ventana;
  es resolución de la medición, no una afirmación de consumo nulo.
- Una ráfaga de 100 activaciones del consumidor produjo una sola recarga. En la
  reconexión real se produjeron tres peticiones, una por cada vista, sin duplicarlas.
- El transporte hace **cero consultas SQL**. En el consumidor son al menos tres
  peticiones por recarga/10 s por cliente visible autorizado; la paginación puede
  añadir peticiones. No es una medición de carga de flota ni de inventario real.

No se detectó información operativa en contenido, frecuencia o cabeceras en los
casos ensayados. La cadencia depende de temporizadores/OS/red; no es una garantía
de tiempo real exacto ni certifica ausencia de canales laterales físicos bajo
cualquier carga o sistema compartido. Desconexiones causan huecos, sin catch-up:
la nueva consulta recupera el estado vigente autorizado.

### Incidencias del comprobador y recuperación

El primer runner Chrome completó cinco grupos y se interrumpió durante el corte
de red por `Invalid InterceptionId`: una petición cancelada mientras CDP intentaba
continuarla. Se conservó el informe parcial en runtime, se comprobó la cuadrilla
del checkpoint y se reanudaron solo desconexión, medición del canal y recursos.
Los cinco grupos aprobados no se repitieron. Las métricas de 60 s corresponden al
tramo reanudado. Ningún dato de inventario se modificó durante la incidencia.

La prueba adicional de caída real detectó que un HTTP 500 del proxy puede cerrar
EventSource definitivamente. Se añadieron reintentos acotados y se repitió solo
esa prueba afectada; pasó. La compilación final incluye esa corrección.
No se repitieron suites anteriores de etapa 3 ni de los transportes descartados.

## Estado, archivos y límites pendientes

Evidencias JSON: `INVENTARIO-LAB-GENERICOS-RESULTADOS`, `-CABECERAS`, `-RECONEXION`
y `-AUDITORIA`. Baseline, fixture, cuentas ficticias y journals permanecen en runtime
ignorado. Reloj y Chrome del ensayo cerrados; Auth/API/Vite existentes conservados.
La nueva Alta quedó sin cuadrilla por la prueba de metadatos; la nueva Avería
conserva líder/apoyo/futuro retirado. No resetear ni repetir automáticamente la fixture.

Archivos nuevos en `scripts/inventory-auth-lab/`: `generic-clock.mjs`,
`generic-refresh.mjs`, `generic-refresh.test.mjs`, `generic-prepare.mjs`,
`generic-ui.ts`, `generic.html`, `generic-validate.mjs`, `generic-headers.mjs`,
`generic-reconnect.mjs`, `generic-audit.mjs`. Cambios únicamente al README y
`vite.config.ts` del laboratorio para ruta de fixture ficticia, proxy local y build.
Documentación y evidencias anteriores se conservan. Nota de continuidad en
`ESTADO_DESARROLLO.md` fuera del commit por sus modificaciones previas.

**Pendiente de otra fase:** integrar el consumidor en la pantalla real de Campo,
probar dispositivos/volumen/batería y estados completos de la aplicación. No se
modificó `CampoTrabajoDetailView.vue`, Rutinas ni Fase 162. No se ejecutó una
regresión administrativa: sus rutas, stores y mecanismos actuales no cambiaron.
La pantalla de laboratorio carece de controles de escritura de inventario.

La aprobación **no certifica el cierre RLS administrativo**. Las lecturas directas
amplias pendientes siguen pendientes; esta entrega reutiliza las consultas de
backend contextualizadas y no amplía ni restringe esos permisos existentes.
Un cierre RLS futuro necesita su propia validación autorizada. Las ocho unidades
históricas y todos los datos reales permanecen fuera de alcance.

## Revisar localmente y rollback

Con Auth/API/Vite del laboratorio disponibles, iniciar solo el reloj:

```powershell
$env:LAB_GENERIC_CLOCK='1'
node scripts/inventory-auth-lab/generic-clock.mjs
```

Abrir `http://127.0.0.1:54384/generic.html`, elegir la Avería y una cuenta ficticia
asignada. La Alta está denegada por el estado final deliberado de su fixture.
No iniciar el backend operativo ni usar `npm run dev`. No desplegar herramientas
de laboratorio, endpoints de fixture o runtime. La build es una verificación,
no un paquete de producción independiente del servidor dev del laboratorio.

Rollback: parar el reloj (Ctrl+C) y dejar de abrir generic.html. Revertir el commit
retira código/config del laboratorio, pero no borra fixture, baseline ni journals.
No eliminar volúmenes ni resetear Auth/inventario. No hay migraciones nuevas que
revertir. Sin Cloud, producción, migraciones remotas, push, despliegue ni datos reales.
