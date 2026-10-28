# Hosts Huawei: interfaz y estado, investigación solo caché

Consulta NBI GET del 28/10/2026 21:50:05 UTC (16:50 Lima), una única
Huawei `HWTC1D3691B7` / `485754431D3691B7`, ID
`00259E-HG8145X6%2D13-485754431D3691B7`. Cero tareas enviadas.
Evidencia con valores sensibles excluidos:
`TR069-HOSTS-INTERFACES-CACHE-20261028.json`.
Repetible mediante `node scripts/tr069-hosts-evidence-readonly.cjs`;
solo GET al NBI, no conexiones directas a equipos.

## Qué existe realmente

| Ruta relativa a InternetGatewayDevice | Resultado de caché |
|---|---|
| LANDevice.1.Hosts.Host.1–5.HostName / IPAddress / MACAddress | Cinco valores reales de cada campo, timestamp 21:38:39.146 UTC |
| LANDevice.1.Hosts.Host.1–5.Active / InterfaceType / Layer2Interface | Parámetros anunciados, sin `_value` ni `_timestamp` |
| LANDevice.1.Hosts.Host.1–5.LeaseTimeRemaining | Sin valor ni fecha |
| LANDevice.1.Hosts.Host.1–5.X_HW_RSSI / X_HW_NegotiatedRate | Sin valor ni fecha |
| LANDevice.1.WLANConfiguration.1 / .5.AssociatedDevice | Objetos sin instancias ni fecha de lectura |
| LANDevice.1.WLANConfiguration.1 / .5.Channel / Standard / X_HW_RFBand / TotalAssociations / Status / RadioEnabled | Anunciados, sin valores ni fechas |
| LANDevice.1.LANEthernetInterfaceConfig | Objeto anunciado, sin instancias ni timestamp |
| DeviceInfo.UpTime | 71687 segundos, leído a las 20:38:05.029 UTC; es del CPE, no de cada Host |

`OperatingFrequencyBand` no aparece en las WLAN cacheadas. El parámetro de
banda anunciado en este firmware es `X_HW_RFBand`, pero tampoco tiene valor;
no se interpreta ni se supone su codificación. No se asigna banda por índice
1/5 ni por SSID. Solo se encontró LANDevice.1; no hay árbol Device.Hosts,
Device.WiFi ni Device.Ethernet en la respuesta proyectada.

Se compararon las MAC de los cinco Hosts con todas las instancias cacheadas
de AssociatedDevice y LANEthernetInterfaceConfig: ninguna disponible para
correlacionar. Esto **no significa cinco desconectados ni cinco cableados**.
El objeto Ethernet no tiene puertos descubiertos; cuando se descubran, la
MAC propia de un puerto no debe confundirse con la MAC del dispositivo cliente.
Un enlace de puerto activo tampoco prueba por sí solo qué Host lo usa.

## Qué se puede afirmar

Solo nombre, IP y MAC tal como estaban registrados a las 16:38:39 de Lima.
El Inform de las 21:48:39.158 UTC confirma un contacto del CPE, no la vigencia
de Active, de una asociación WiFi, de su banda o de la lista de dispositivos.
Active no es un dato antiguo con valor: no tiene valor ni fecha en absoluto.
UpTime es una muestra anterior del CPE y no confirma actividad de un Host.
No se ha demostrado una limitación definitiva del firmware: falta lectura/
descubrimiento de parámetros anunciados. La ausencia en caché no prueba que
el equipo sea incapaz de proporcionarlos.

## Consulta activa propuesta (antecedente; ejecución posterior parcial)

**Actualización:** el propietario autorizó la lectura después de este sondeo.
Resultado real: `TR069-HOSTS-ACTIVE-READ-20261028.md` y su JSON. El GPV de las
15 hojas Hosts funcionó (InterfaceType/Layer2Interface/Active ya tienen valores).
El segundo lote, agrupado como GPV de radio y subárboles, falló en GenieACS con
`Invalid parameter path`; se retiró la tarea, sin reintentos ni pendientes.
Tipo/estado sí son viables con fecha y caducidad; banda sigue sin confirmar.
No repetir el sondeo ni dar por ejecutado íntegramente el plan original.

El NBI permite tareas `getParameterValues` con nombres concretos y
`refreshObject` para un objeto. Aunque sean lecturas TR-069, se crean por
POST a `/devices/<ID-URL-encoded>/tasks` y necesitan autorización aparte.
En la fase inicial de caché no se preparó ningún POST ni se encoló tarea;
la autorización y ejecución posterior están registradas en el documento citado.

Al autorizar una prueba puntual, contra este único ID y esperando el próximo
Inform (sin `connection_request` inicialmente):

1. `getParameterValues` para `InternetGatewayDevice.LANDevice.1.Hosts.Host.{i}.Active`,
   `.InterfaceType` y `.Layer2Interface`, con **i concretos 1,2,3,4,5**, no el
   texto literal `{i}`. Leer los valores nuevos, sus fechas y cualquier fault.
2. `refreshObject` de `InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDevice`
   y del equivalente `.5.AssociatedDevice`, para descubrir las asociaciones.
   Correlacionar solo las MAC leídas. El estándar TR-098 denomina la hoja
   `AssociatedDeviceMACAddress`; este firmware aún no tiene ninguna instancia
   descubierta y no se debe asumir que use la hoja `MACAddress` del mapeador
   genérico actual. Verificar el nombre real antes de extenderlo.
3. `getParameterValues` de `.WLANConfiguration.1.X_HW_RFBand`, `.Channel`,
   `.Standard`, `.TotalAssociations` y sus equivalentes en WLAN 5, todos ya
   anunciados. Interpretar banda solo después de observar valores inequívocos;
   no solicitar `OperatingFrequencyBand` como si ya existiera.
4. `refreshObject` de `InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig`;
   luego inspeccionar puertos/Status reales y correlacionar por una referencia
   Layer2Interface del propio Host, no por la MAC del puerto o por exclusión.

Realizar cada paso por separado y detenerse ante faults o identidad ambigua.
No refrescar el árbol completo ni WLANConfiguration completa (incluye claves).
Un resultado sin valores después de estas lecturas justificaría documentar una
limitación de esta vía/firmware; por ahora no se puede asegurar.

Fuentes primarias para la propuesta:
[API GenieACS 1.2.16](https://docs.genieacs.com/en/stable/api-reference.html#tasks),
[modelo TR-098 de Broadband Forum](https://cwmp-data-models.broadband-forum.org/tr-098-1-1-0.html).

## Cambios locales, sin desplegar

- Conexión, banda y estado desconocidos: «Sin confirmar».
- Hora discreta basada en las filas, no en el timestamp del descubrimiento
  del objeto Hosts (que en este equipo era del 27/10).
- Active conserva su propia fecha, separada del Inform y nombre/IP/MAC.
  La presentación exige Active booleano explícito, fecha propia e Inform
  recientes, no futuros. Caduca a los 10 minutos con el reloj local existente,
  sin consultas nuevas. Es una política conservadora de presentación (dos
  intervalos de 5 minutos), no una prueba de conexión en vivo. Un booleano
  antiguo, sin fecha o ausente nunca produce «Desconectado» por defecto.
- No se añadió ninguna clasificación por MAC/asociaciones inexistentes, banda
  Huawei no leída, nombre, IP o fabricante. En esta caché los cinco siguen
  «Sin confirmar». No se cambió identidad ni acceso a WiFi/PPPoE/OLT/MikroTik.

Validación: 34/34 pruebas focalizadas Hosts/GPON/presentación PASS; TypeScript
backend y Vue TypeScript frontend PASS. Las pruebas incluyen la evidencia real,
ausencia de campos, estados recientes/antiguos/futuros, caducidad local y
timestamps de filas frente a metadatos. Producción sigue en backend
`d6ce2c2f578f`, frontend `5d48a10ea497`; no desplegado ni publicado.
