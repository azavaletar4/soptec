# Lectura activa controlada Hosts Huawei — 28/10/2026

Autorización del propietario: lectura TR-069 exclusivamente de
`HWTC1D3691B7` / `485754431D3691B7`, sin configuración ni credenciales,
sin reinicios, sin connection_request y sin reintentos automáticos.

Identidad GenieACS única:
`00259E-HG8145X6%2D13-485754431D3691B7`.
Preflight 21:59:57 UTC: último Inform 21:58:39.179 UTC, cero tareas y cero faults.
Evidencia: `TR069-HOSTS-ACTIVE-READ-20261028.json`.

## Alcance enviado

Dos lotes secuenciales `getParameterValues`, ambos sin connection_request:

1. Tarea `6ae270e911b92787fcd0250e`, aceptada HTTP 202 a las 22:02:17.182 UTC.
   Exactamente 15 hojas: `InternetGatewayDevice.LANDevice.1.Hosts.Host.{i}.Active`,
   `.InterfaceType` y `.Layer2Interface`, para i=1,2,3,4,5 concretos.
   Terminó en el Inform 22:03:39.211 UTC; las 15 hojas tienen timestamp
   22:03:39.213 UTC. Verificado a las 22:04:04 UTC: tarea ausente y cero faults.
2. Tarea `6ae27187220eb9ba9f4c3580`, aceptada HTTP 202 a las 22:04:55.501 UTC,
   después de verificar el primer lote. Solo 11 entradas:
   `.WLANConfiguration.1.X_HW_RFBand`, `.Channel`, `.Standard`, `.TotalAssociations`,
   `.AssociatedDevice.`, equivalentes WLAN 5 y `.LANEthernetInterfaceConfig.`;
   prefijo común `InternetGatewayDevice.LANDevice.1`.
   En el Inform 22:08:39.189 UTC registró `script.Error`, detalle
   `Error: Invalid parameter path`, `retries:0`. No actualizó las hojas ni
   descubrió asociaciones o puertos. **GenieACS rechazó el lote que incluía
   rutas parciales terminadas en punto**; no demuestra que la Huawei sea incapaz
   de informar esos campos. No se ejecutó un tercer lote ni se probó una
   ruta alternativa.

Se agruparon asociaciones y Ethernet en un segundo GPV para reducir el plan
de descubrimiento a **dos tareas**. Los tres nombres de objeto terminan en
punto y leen solo sus subárboles; no se solicitó WLANConfiguration completa,
SSID, contraseñas, credenciales ni WAN. El GPV de un prefijo terminado en
punto está definido para CWMP en
[TR-069 A.3.2.2, Broadband Forum](https://www.broadband-forum.org/pdfs/tr-069-1-6-0.pdf).
Eso no implica que la tarea `getParameterValues` de este GenieACS acepte
esas rutas: en este experimento las rechazó. La agrupación fue un error
de preparación del segundo lote frente al plan original `refreshObject`.
No corregirlo enviando otra tarea bajo esta autorización ya consumida.
El ejecutor tiene listas cerradas de rutas, identidad/Inform/cola validados
antes del envío y un registro `wx` por lote en `/tmp` del backend para impedir
duplicados incluso si la respuesta HTTP queda incierta. **No volver a ejecutar
send ni borrar esos registros para reintentar.**

## Muestra real y clasificación

Hora de `Active`/tipo/referencia: **17:03:39 del 28/10, Lima**.
Nombre/IP/MAC conservan su lectura anterior de 16:38:39; la relación se mantiene
por la misma instancia Host y su MAC, nunca por nombre/fabricante/IP.

| Host | MAC | Tipo reportado | Referencia reportada | Active |
|---|---|---|---|---|
| REDMI-Note-15-5G | d2:d3:3a:8d:85:1c | WiFi (802.11) | WLANConfiguration.1 | false |
| S26-Ultra-de-Warner | 56:b9:d2:f2:e7:c1 | WiFi (802.11) | WLANConfiguration.1 | true |
| iPhone | be:9e:54:93:df:8c | WiFi (802.11) | WLANConfiguration.1 | false |
| Z2359 | 7e:75:b3:0a:86:76 | WiFi (802.11) | WLANConfiguration.1 | false |
| LAPTOP-996NPL7I | 00:07:29:55:35:57 | Cable (Ethernet) | LANEthernetInterfaceConfig.2 | false |

`false` significa desconectado según el valor explícito de esa muestra; no
se dedujo de una lista vacía. La banda no se deduce del índice WLAN 1.
La información de una muestra no es una garantía de conexión en vivo.

Clasificación posible con certeza respecto de esa muestra:
cuatro WiFi (802.11), un Cable (Ethernet); S26-Ultra-de-Warner conectado,
los otros cuatro desconectados según Active explícito del 28/10 17:03:39 Lima.
Las referencias son del propio Host; **no hubo una segunda correlación por
AssociatedDeviceMACAddress ni una tabla Ethernet por MAC**, porque el segundo
lote no produjo esos datos. Banda de los cuatro WiFi: **Sin confirmar**.
No se infiere 2.4 GHz por WLAN 1 ni se interpreta un X_HW_RFBand sin valor.

Último Inform observado: **22:08:39.189 UTC (17:08:39.189 Lima)**. No renovó
Active: sus valores siguen fechados a las 22:03:39.213 UTC. Un indicador de
estado debe caducar según su fecha propia, como en la mejora local `8fec55d`.
El mapeador en producción ya puede leer InterfaceType y Active recién poblados,
pero el guard de vigencia y «Sin confirmar» siguen sin desplegar.

## Cierre al primer fallo

Se retiró solo la tarea fallida `6ae27187220eb9ba9f4c3580` por DELETE del NBI
para impedir reprogramación automática: HTTP 200 a las 22:09:30.092 UTC;
GET posterior de tareas del equipo: **cero pendientes**. El detalle del fault
se conservó en evidencia antes del DELETE; no se consultó su persistencia
posterior en el ACS (el campo `faultPreserved` de esa captura se refiere a
la evidencia, no es verificación posterior de la colección faults).
No hubo llamada de retry ni reenvío. La primera
tarea había desaparecido con los valores confirmados y sin faults.

No continuar automáticamente: banda y asociaciones siguen pendientes de
otra autorización. Si se retoma, usar el `refreshObject` acotado del plan
original para cada objeto por separado, y lecturas de hojas concretas para
radio; no repetir el GPV de subárboles terminado en punto. Este documento
registra el límite del experimento, no autoriza esas operaciones futuras.

No se modificaron aplicación, configuración de equipos ni despliegue. No
se ejecutaron comandos OLT/ONT/MikroTik ni operaciones PPPoE. La continuidad
de navegación/uptime PPPoE no se midió con tráfico o acceso directo a red;
no se afirma una prueba de navegación que no se haya realizado.

Controles locales: sintaxis Node PASS; dos IDs únicos; primer lote 15 hojas,
segundo lote 11 entradas; ninguna ruta de credenciales/SSID/WAN y cero acciones
de configuración/reinicio/connection_request. Sin cambios funcionales, sin
despliegue, migraciones, push ni comandos sobre equipos. Se actualiza únicamente
continuidad y se conserva el ejecutor con guardas de no repetición.
