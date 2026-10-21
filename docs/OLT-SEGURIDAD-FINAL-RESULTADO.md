# Última validación de seguridad OLT — 2026-10-20

**PASS de controles focalizados**, con condiciones de activación y riesgos residuales abajo.
No se ha publicado ni desplegado. TypeScript global del backend mantiene cinco errores preexistentes;
no se considera PASS de ese chequeo global, aunque su salida es idéntica a la base y no hay errores nuevos.

Base de esta revisión: `0a10d33edb08f43fc3c67ee21d50b5638d811cf0`.
Corrección separada en rama local `fix/olt-seguridad-final-20261020`; el SHA final se entrega en el cierre.
No se repitió una auditoría general: solo reinicio, límites/concurrencia de lecturas e importación,
atribución de respuestas y recuperación de frontend/backend.

## 1. Reinicio y referencia óptica

Se confirmó el riesgo: perder el Map en memoria deja el siguiente cruce sin referencia. No es
seguro reconstruirla desde `olt_onts.rx_power`/`last_synced_at`: hay lecturas históricas contaminadas,
timestamps que no acreditan serial y sincronizaciones sin potencia. El log de alertas registra
transiciones, no todas las muestras verificadas. Ninguno sirve como fuente general fiable.

Corrección mínima local, sin Supabase ni migraciones:

- Checkpoint independiente con versión, hash SHA256 del contenido y referencias por ID + OLT + serial
  normalizado + posición + timestamp. Solo recibe mediciones verificadas por el lector existente.
- Escritura a archivo temporal exclusivo, fsync, rename atómico y fsync del directorio en Linux.
  Las muestras se guardan una vez por ciclo, no por fila. Una invalidación de una referencia
  existente se guarda inmediatamente, también desde lecturas manuales, para no resucitarla al reiniciar.
- Se carga al reiniciar únicamente para comparar alertas. No restaura estado/potencia como actuales;
  la presentación sigue «No confirmado» hasta una lectura nueva válida.
- Archivo ausente/corrupto/versión desconocida: no reconstruir desde historia; empezar sin referencia.
  Corrupción produce error visible en log. Fallo al guardar no se oculta como guardado correcto.
- Volumen Docker dedicado `smartrayco_olt_telemetry`, montado en `/var/lib/smartrayco-olt`.
  Compose fija `OLT_SIGNAL_CHECKPOINT_PATH=/var/lib/smartrayco-olt/signal-references.json`.
  No se creó ni montó ese volumen en producción durante esta tarea.
- Persiste el límite de comparación del padre: 185 minutos con 30 min × 3 ciclos, máximo 24 h.
  Un checkpoint de otra identidad o vencido no sirve como referencia.

Pruebas: reinicio con −23,98 → lectura nueva −30 produce lowSignal; checkpoint actualizado y nuevo
reinicio con −30 no duplica el cruce. Recuperación, otra identidad, corrupción, expiración y error
de escritura cubiertos. En dos contenedores Linux locales sucesivos, con red `none`, el mismo volumen
conserva el checkpoint y su hash. No se inició la aplicación backend en ese ensayo.

## 2. Importación lenta, timeouts y concurrencia

Producción se inspeccionó solo en lectura. Configuración real: nginx `proxy_read_timeout 180s`,
Caddy read/write timeout 200s; scheduler cada 30 minutos, potencia cada tres ciclos. No se realizaron
escaneos ni pruebas de carga sobre la C300. La importación secuencial del padre podía superar 180 s;
no era correcto prometer que nunca habría timeout.

Correcciones locales:

- Exclusión por operación lógica y OLT, además del mutex por sesión Telnet: importación, escaneo
  manual, señal individual y scheduler comparten la guarda. Otra petición manual responde ocupado
  (409 en import/sync; señal mantiene su respuesta de error) y un tick del scheduler se omite.
  No se encolan escaneos completos adicionales. La guarda se libera en finally.
- Presupuesto de 150 s para importación/sync manual; 80 s para señal individual. Incluye espera
  por sesión y llamadas REST de esas operaciones. Los timeouts Telnet se limitan al tiempo restante.
- El mutex elimina peticiones vencidas de su cola: no ejecuta una sesión cancelada más tarde.
  También libera el turno si el lector lanza un error síncrono.
- Las peticiones REST comparten AbortSignal; después de agotar el presupuesto no se inician nuevas
  escrituras del lote. Se devuelve un error controlado, no se espera indefinidamente al proxy.

No se garantiza que una importación grande termine en una sola petición. Puede detenerse parcialmente;
`imported` indica filas confirmadas antes del fallo. Una petición ya enviada podría haberse confirmado
en el servidor aunque el cliente la abortara: verificar con SELECT antes de reintentar. Los predicados
de identidad e INSERT sin sobrescritura del padre permanecen. La ruta no tiene transacción global.

Carga: cero comandos CLI adicionales frente al padre; solo comprobaciones locales, una escritura
normal de checkpoint por ciclo y guardado inmediato de referencias invalidadas. La consulta COUNT y las escrituras REST secuenciales corresponden a importación
explícita, no a un nuevo polling de la OLT. Mientras una importación está activa, el scheduler no comienza
otro escaneo. Si un tick se omite, podría demorarse hasta el siguiente intervalo; el estado visual vence
y queda no confirmado. El mutex y la guarda protegen un solo proceso, no herramientas externas.

## 3. Respuestas incompletas, fallidas y posiciones reutilizadas

Se encontró otro defecto específico: `parseBulkPower` conservaba solo onu-id y descartaba puerto.
Una respuesta con el mismo onu-id pero de otro puerto podía aportar potencia ajena pese a comprobar
el inventario de seriales en la posición solicitada.

El lector verificado ahora exige frame/slot/port correctos y sin filas duplicadas antes de aceptar
una tabla óptica. Un puerto ajeno o ambiguo invalida RX/TX de ese puerto, sin convertir el fallo de
potencia en desconexión ni borrar la referencia óptica anterior para alertas. Se mantiene la doble
comprobación de serial del padre y la escritura condicionada por identidad.

## 4. Resultados

| Control | Resultado |
|---|---|
| Regresiones críticas + indicadores/presentación | 139 PASS, 0 FAIL |
| Reproducciones originales import-failure / signal-gap | 2 PASS |
| Consulta de identidades fallida/truncada | PASS: cero escrituras del lote |
| MSTC / serial de Estiven en posición reutilizada | PASS en simulación; no reparación ni sustitución |
| Reinicio/checkpoint/corrupción/expiración | PASS |
| Puerto óptico ajeno/fila duplicada | PASS: potencia no confirmada |
| Operación concurrente y vencimiento de cola/REST | PASS en simulación |
| «No confirmado» en indicadores | PASS: no suma desconexión real |
| TypeScript frontend / Vite build local | PASS / PASS |
| TypeScript backend global | FAIL preexistente: mismos cinco errores que e679d9c, cero nuevos |
| Backups frontend/backend: OCI, hashes, load y plataforma/RootFS | PASS |
| Ensayo aislado nginx / Node y checkpoint Linux entre contenedores | PASS |
| Compose de rollback: ambas imágenes exactas y volumen/ruta checkpoint | PASS |

Errores globales preexistentes sin modificar: `fieldInventory.test.ts:4`,
`oltProvisioningService.ts:225,228`, `custodyRequiredMaterials.sql.test.ts:395,396`.
Vite mantiene la advertencia conocida de chunks >500 kB. Build local con configuración ficticia;
no es una imagen productiva autorizada. No se hizo otra auditoría de esos errores.

Evidencia: `scripts/inventory-auth-lab/runtime/olt-seguridad-evidencia-20261020/`,
incluyendo logs, `production-readonly.json`, `recovery-compose-checks.json` y `compose-final.json`.

## 5. Respaldo y rollback verificados

Producción observada: checkout `e679d9c9254746a7fe50ba317eabf7cb1d2c8871`; no se infiere de ello
el código de la imagen backend. Se usaron los IDs exactos de los contenedores ejecutados:

- Frontend: `sha256:8b8fcb9b9caa0ddb1de35c87e46cb29d1ef682407b80be8e008fd29009f389bd`.
- Backend: `sha256:43c7f723812b02d254ffe57909e328adfa20ac5a67cb1562eb91a051b76f032d`.

Respaldo NUEVO local, sin sobrescribir respaldos anteriores:
`D:/SmartRayco/scripts/inventory-auth-lab/runtime/olt-seguridad-evidencia-20261020/backup-2026-10-20T22-41-08.247Z/`.

| Archivo | Bytes | SHA256 del tar |
|---|---:|---|
| frontend.image.tar | 32955392 | 9bf1d626a43442f7fed3481522f464082f6d354133896c06ebc9daa10f60f17a |
| backend.image.tar | 296638464 | 85c90977aa95547abe8dd783756680c1bfb1d72ad29ff5dc05981bafe86aac32 |

La exportación se transmitió de `docker image save` remoto a archivos locales; no se crearon
archivos de respaldo ni se cambiaron tags/contenedores en producción. Se verificaron raíz OCI,
descriptores y blobs, checksums TAR, SHA del archivo, imagen cargada y plataforma/RootFS iguales.
Después del ensayo se confirmó que producción conservaba los mismos contenedores e imágenes.

Ensayo local sin red: nginx -t correcto con alias backend a loopback y temporales efímeros;
Node v22 correcto sin iniciar servidor/schedulers. Los primeros ensayos de nginx requirieron ajustar
el aislamiento del laboratorio (resolución del upstream, temporales y permiso CHOWN), sin modificar
las imágenes. El ensayo del checkpoint necesitó /tmp efímero para tsx. No fueron cambios de producción.
Esto valida recuperabilidad de imágenes, no una prueba funcional completa con credenciales reales.

Procedimiento operativo separado: `OLT-SEGURIDAD-FINAL-ACTIVACION-ROLLBACK.md`.

## 6. Riesgos restantes y recomendación

1. Primer arranque sin checkpoint o archivo corrupto/vencido: no se pueden reconstruir cruces
   anteriores de manera fiable. La primera lectura forma una base nueva; revisar la lista actual
   de señal baja tras activación. No sembrar con valores históricos contaminados de Supabase.
2. No hay transacción distribuida entre Supabase, emisión SSE y checkpoint local. Un apagado justo
   después de persistir/emitir una alerta y antes de guardar el checkpoint podría repetir ese evento
   al volver a leer. No se afirma entrega exactamente una vez ante un corte en ese punto. El caso
   de reinicio entre ciclos terminados sí está cubierto y no duplica alertas.
3. El checkpoint depende del volumen/ruta/permisos y de su respaldo. No usar disco efímero ni
   escalar a varios backends sin coordinación. En despliegues fuera de este compose debe configurarse
   almacenamiento persistente equivalente. Un fallo de guardado se propaga y debe detener activación.
4. Puede haber importación parcial o tick omitido por presupuesto/exclusión. No hay garantía de
   latencia real de la C300: se evitó sobrecargarla y los límites se verificaron con simuladores.
5. Permanecen las dos lecturas de configuración completas, el coste del inventario y la ventana
   no atómica frente a cambios/reversiones de herramientas externas entre comprobaciones.
6. Un rollback al backend anterior devuelve también su defecto de sincronización por posición.
   Se recomienda rollback con scheduler OLT pausado hasta decidir cómo recuperar su operación.

**Recomendación:** candidato apto para solicitar autorización de despliegue controlado, no para
publicación automática. Antes de activarlo deben verificarse las imágenes productivas del árbol exacto,
la disponibilidad del backup en el servidor, el volumen persistente y la ventana de primer ciclo.
No se garantiza ausencia absoluta de alertas omitidas/duplicadas ante corrupción, pérdida del volumen,
intervalos sin evidencia o corte en la ventana de escritura descrita. Si se exige exactamente una vez
incluso en ese escenario, hace falta un diseño transaccional/outbox adicional; no se improvisó una migración.

## 7. Alcance exacto y preservación

Lista completa de archivos contra producción e679d9c: `OLT-SEGURIDAD-FINAL-ARCHIVOS.txt`.
Incluye los cambios de 6aea8b5 + 0a10d33 + este commit, y exclusivamente código/documentación/pruebas
de esta corrección. No se deben publicar solamente los archivos del último commit sobre una base
sin sus padres. Los archivos runtime de laboratorio, respaldos, .env y los 216 pendientes no son parte
del candidato ni de su contexto Docker.

216/216 archivos protegidos conservan SHA256. Main local sigue en dceafa08d2717b643f65b3880ead020a14561648;
los worktrees 6aea8b5 y 0a10d33 permanecen intactos. Sin escrituras en Supabase, configuraciones de
OLT/MikroTik, migraciones, push, despliegue ni reparación de MSTC8CCE647E.
