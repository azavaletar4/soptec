# Hosts bajo demanda y señal WiFi — preparado localmente

Sin desplegar. La preparación original no envió tareas activas. Posteriormente
el propietario autorizó una sola prueba real: e2c7bf7 funcionó con un GPV de
35 hojas (23:07 UTC), pero el build del candidato protegido ac511d7 se detuvo
con NORMALIZED_ASSET_NAME_COLLISION; no hubo deploy/verify. Cierre SSH fallido,
sin reintento. Resultado completo:
`TR069-HOSTS-DEMAND-DESPLIEGUE-DETENIDO-20261028.md`.

## Apertura y actualización

- El detalle general de una ONT deja Hosts cerrado. Entrar a TR-069, renderizar,
  cambiar de pestaña o consultar métricas no inicia lecturas de Hosts.
- Abrir explícitamente «Dispositivos conectados» o pulsar «Actualizar» llama
  `POST /api/genieacs-sync/hosts/:serial/read`, solo ADMIN/SUPERADMIN, detrás
  de la autenticación existente. Otros roles autorizados conservan solo GET
  de caché, sin permiso activo.
- Una operación en vuelo por serial GPON normalizado comparte promesa; serial
  ASCII/hex equivalentes nunca crean dos tareas. Un journal por ID GenieACS y
  un lock exclusivo en disco protegen también peticiones de otros procesos.
- El servicio comprueba identidad exacta y única, Inform reciente y cola libre.
  Si hay una lectura propia pendiente, la comprueba y reutiliza; no envía otra.
  Una operación ajena pendiente bloquea una lectura nueva.
- Solo se crea un GPV con hojas concretas anunciadas: Active, InterfaceType,
  Layer2Interface, HostName, IPAddress, MACAddress, y X_HW_RSSI/unidad si existen.
  Asociaciones ya descubiertas: únicamente MAC y medidas/unidades de señal
  anunciadas. Nada de SSID, claves, WAN, parámetros elegidos por el navegador,
  comodines ni prefijos terminados en punto. Máximo 64 Hosts y 512 hojas.
- La solicitud de lectura pide `connection_request` para intentar atender el
  clic en la misma operación. NBI espera hasta 12 s; el transporte POST tiene
  límite de 15 s y el task expira a los 45 s. El cliente tiene límite de 55 s;
  los GET de metadatos tienen límites independientes. No se reinicia ni se
  modifica configuración de la ONT.
- Se registra la intención **antes del POST**. Un timeout de envío queda
  incierto y no se reenvía. Solo se adopta una tarea con ID de ONT, tipo,
  parámetros y expiry exactamente coincidentes con el registro.
- Si NBI devuelve 202, no se hace polling: se muestra «pendiente» y el usuario
  puede pulsar Actualizar para comprobarla. Esa comprobación no crea otra tarea;
  después de terminar, una acción explícita posterior sí solicita una lectura
  nueva. No hay reintentos automáticos, cron, intervalos ni timers de refresco.
- Un fault o vencimiento detectado durante una comprobación explícita retira
  solo la tarea propia, verificando ID/ONT/tipo/parámetros/expiry. No se borran
  tareas ajenas ni se emite una alternativa automáticamente.
- HTTP 200 no significa datos nuevos: se verifica de nuevo identidad y fechas
  propias de Active/tipo/MAC/referencia/nombre-IP. Si la respuesta no confirma
  la muestra, se conserva el snapshot anterior; no se mezclan un Active nuevo
  con una MAC/nombre históricos de otra instancia.

El journal se guarda en `TR069_HOSTS_READS_DIR` (por defecto
`/var/lib/smartrayco-olt/hosts-reads`). Solo contiene identidad, fechas, estado,
ID de tarea y rutas de lectura; no credenciales. No borrar registros o locks
para forzar un reenvío incierto. Un lock abandonado por caída de proceso requiere
revisión manual de la tarea antes de retirarlo, sin recuperación automática ciega.

**Habilitación productiva pendiente:** `TR069_HOSTS_ON_DEMAND_ENABLED` es false
por defecto. ac511d7 exige además un serial en `TR069_HOSTS_ON_DEMAND_SERIALS`;
el contrato planea solo HWTC1D3691B7. La prueba autorizada de e2c7bf7, aislada
en /tmp, confirmó un único POST con connection_request, HTTP 200, valores y
fechas nuevas y cola/faults vacíos. No habilitó producción. No se repitió para
probar el guard más restrictivo (cubierto localmente). El rollout se detuvo
en build; la autorización no se reutiliza para repetir la lectura o forzar
la publicación. El vencimiento no llegó a ejercitarse en el ensayo real
porque la tarea terminó en menos de un segundo; mantiene pruebas simuladas.

El alcance refresca instancias conocidas en caché. No descubre automáticamente
Hosts/asociaciones nuevas ni tablas no conocidas, y no amplía a WLAN completa.
La incorporación de nuevas instancias depende de que GenieACS las conozca;
cualquier descubrimiento adicional necesita su propio alcance autorizado.

## Estado y presentación

Tabla: Dispositivo, IP, MAC, Conexión, Estado, Señal WiFi. Muestra hora de
solicitud y de datos; conserva la hora de Active por fila al caducar. Los
mensajes de carga/fallo no esconden la lista anterior ni exponen rutas TR-069.
Tipo y estado requieren fechas propias válidas, no futuras, de hasta 10 min,
e Inform reciente. Un Inform o clic nuevo nunca rejuvenece campos antiguos.
El reloj local ya existente solo caduca la presentación; no consulta equipos.
Sin evidencia vigente: «Sin confirmar»; no se infiere por IP/nombre/fabricante.

## Evidencia real de señal y límites

`docs/TR069-HOSTS-SIGNAL-CACHE-20261028.json`, GET NBI 28/10 **22:51:24 UTC**
(17:51:24 Lima): identidad única, cinco `X_HW_RSSI` anunciados, todos sin valor,
tipo ni fecha; ninguna instancia AssociatedDevice en WLAN 1/5 y ninguna unidad
de señal declarada. Active/InterfaceType/Layer2Interface siguen fechados a las
22:03:39.213 UTC aunque MAC se leyó a las 22:38:39 y el Inform fue a las
22:48:39.251 UTC. Son datos históricos, no cinco conexiones actuales.

La consulta activa posterior sí obtuvo X_HW_RSSI 0/-43/0/-57/0 y fecha propia
23:07:06.893 UTC, sin unidad/escala verificada: no interpretarlos como dBm/%.
No hay todavía calidad calibrada verificable ni prueba de incapacidad del
firmware. El lote anterior de subárboles falló en GenieACS por
`Invalid parameter path`; no demuestra una limitación de la ONT y no se repitió.

La implementación prepara señal desde el propio Host o una única asociación
de la **misma MAC y WLAN referenciada por Layer2Interface**, sin asumir banda.
Solo acepta una medida entera entre -120 y -1 y una hoja de unidad explícita
`dBm` con fecha válida (`X_HW_RSSIUnit`, `RSSIUnit` o `SignalStrengthUnit`), si
el árbol realmente la declara. Esos campos de unidad existen en los ejemplos
simulados, **no se observaron en esta Huawei**. El nombre X_HW_RSSI y un número
negativo, por sí solos, no se usan como prueba de unidad. Si se verifica otra
convención del fabricante en una sesión futura, necesita un mapeo documentado.

Para mostrar calidad se exigen también MAC, referencia, medida, unidad y estado
con fechas vigentes y Host conectado. Datos conflictivos, asociaciones ambiguas,
otra MAC/WLAN, estado antiguo o unidad no verificada: «No disponible».
Ethernet con tipo vigente: «No aplica». No hay porcentajes estimados ni nativos.
Umbrales **propios de presentación**, no diagnóstico ni escala del fabricante:
verde ≥ -67 dBm, amarillo de -75 a -68 dBm, rojo < -75 dBm. Texto Buena/Regular/
Débil acompaña al color. La banda 2.4/5 GHz no se deduce ni se añade a la tabla.

## Validación y archivos

Preparación inicial: 66/66 pruebas y TypeScript backend/frontend PASS.
Ensayo/despliegue posterior: 67/67 con guard de serial, 14/14 del contrato y
tsc backend PASS. Build detenido por colisión de assets, sin publicar. Incluyen
apertura/cierre, renders sin peticiones, Actualizar, roles/401/403, concurrencia
ASCII/hex y entre procesos, persistencia, timeout incierto, expiración, faults,
cola ajena, identidad ausente/ambigua/cambiada, datos antiguos, señal/unidades/
MAC/WLAN y render real de las seis columnas sin advertencias ni rutas técnicas.

- Servicio: `server/src/services/tr069Hosts.ts`, `tr069HostsOnDemand.ts`,
  `tr069HostsSignal.ts`; rutas `server/src/routes/genieacsSync.ts` y
  `tr069HostsOnDemand.ts`.
- Frontend: `src/lib/tr069Hosts.ts`, `tr069HostsPanel.ts`, `src/stores/tr069.ts`,
  `src/views/tr069/Tr069View.vue`.
- Pruebas: `server/src/services/__tests__/tr069Hosts.test.ts`,
  `tr069HostsOnDemand.test.ts`, `tr069HostsSignal.test.ts` y
  `src/lib/__tests__/tr069HostsPanel.test.ts`, `tr069HostsView.test.ts`.
- Evidencia: `scripts/tr069-hosts-signal-cache-readonly.cjs`, JSON de señal
  citado y este documento; continuidad en CLAUDE.md y ESTADO_DESARROLLO.md.

No se cambiaron WiFi/PPPoE/WAN/VLAN/OLT/MikroTik, credenciales, migraciones,
cron ni otros módulos. Sin push ni despliegue. Producción sigue en la última
versión documentada, backend d6ce2c2f578f y frontend 5d48a10ea497, comprobados
a las 23:07 UTC. La comprobación de cierre no se completó; no se reintentó.
Una publicación futura requiere declarar alcance frontend+backend, incluyendo
las nuevas dependencias del servicio y la librería compartida, validar de nuevo
el release contra imágenes activas y autorizar por separado su habilitación real.
