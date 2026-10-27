# Primera prueba WiFi — preflight puntual de solo lectura

Continuación de `bbdab72`. **Resultado: todavía NO lista para ejecución.**
Se preparó una propuesta exacta y respaldo de SSID cacheado, no una tarea.
Sin escrituras, comandos OLT/ONT/MikroTik, cambios de asociación, refresh,
connection request, migraciones, push ni despliegue.

## Evidencia real de esta lectura

Consulta **27/10/2026 21:05:30 UTC / 16:05:30 Perú**. GET NBI para ambas
representaciones completas del serial (regex anclada, sin distinción de
mayúsculas); GET de vínculos puntuales en Supabase y tareas pendientes solo de
este dispositivo. Proyecciones limitadas a metadatos, sin usuario/clave PPPoE ni
contraseñas WiFi. No se buscó ni consultó la configuración de otras ONT.

- Un candidato GenieACS: `00259E-HG8145X6%2D13-485754431D3691B7`.
- Serial reportado `485754431D3691B7` normaliza exactamente a `HWTC1D3691B7`
  mediante `src/lib/gponSerial.ts`. Sin coincidencias parciales ni ambiguas.
- Una ONT no retirada: `8d3eb272-b90b-48b9-b834-2176e6003b6b`.
- Contrato activo único asociado: **CTR-2026-00214**,
  `bf6b0f88-3c55-4c9b-aca2-5dfa739e738c`; una sola ONT no retirada en ese contrato.
- Cliente **prueba zava**, `d996f03f-2fde-4210-9307-1489d2c6e5fc`: coincide
  exactamente en ONT y contrato. No se seleccionó un contrato por nombre.
- Un registro TR-069 por serial y por GenieACS id:
  `228cf2cb-6faa-42ea-ad13-2a8b7822a841`, **service_contract_id=null**.
  Es vínculo administrativo incompleto, no duplicidad. No se cambió.
- Último Inform: **16:02:30 Perú** (`21:02:30.453Z`).
- Tareas pendientes en GenieACS para este deviceId: **0** al consultar.

`IGD` abrevia `InternetGatewayDevice`; las rutas de instancia son:

| SSID cacheado | Instancia | Estado Enable | Banda | Fecha del SSID, Perú | SSID writable |
|---|---|---|---|---|---|
| RAYCO 18 | `IGD.LANDevice.1.WLANConfiguration.1` | Sin valor legible | Desconocida | 15:37:30 | true anunciado |
| WirelessNet-5G | `IGD.LANDevice.1.WLANConfiguration.5` | Sin valor legible | Desconocida | 15:37:30 | true anunciado |

Fecha exacta de ambos SSID: `2026-10-27T20:37:30.393Z`. Un Inform más reciente
no renueva necesariamente estos valores. No se afirma que WLAN 1 sea 2.4 GHz
ni WLAN 5 sea 5 GHz. **Capacidad anunciada, aceptación de escritura no probada.**

Evidencia: `TR069-WIFI-PREFLIGHT-SOLO-LECTURA-20261027.json`.
Consulta reproducible: `scripts/tr069-wifi-preflight-readonly.cjs` (solo GET).

## Propuesta puntual — selección aún no confirmada por el propietario

Como candidato, conservar la instancia usada en la simulación anterior, sin
interpretar su banda:

- DeviceId: `00259E-HG8145X6%2D13-485754431D3691B7`.
- Parámetro único:
  **`InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID`**.
- Anterior cacheado: **WirelessNet-5G**.
- Nombre nuevo propuesto: **WirelessNet-5G-PRUEBA** (21 bytes ASCII).
- Tipo: `xsd:string`.
- Reversión prevista: mismo parámetro/deviceId, valor **WirelessNet-5G**.
- No cambiar clave, otra red, seguridad, PPPoE, WAN, ManagementServer ni VLAN.

Plan local y respaldo legible guardados en `TR069-WIFI-PLAN-PUNTUAL-20261027.json`.
El respaldo se capturó a las 16:05, pero su **lectura de origen tiene unos 28
minutos**. Es recuperable como texto/ruta para una reversión futura; no se ha
corroborado como configuración efectiva actual del CPE. No se declara respaldo
vigente suficiente para ejecutar sin comprobación adicional. Las capturas de
simulación anteriores no sustituyen ese respaldo real.

## Condiciones pendientes y riesgos

1. El propietario todavía no eligió la red ni el nombre nuevo: esta propuesta
   no equivale a autorización ni a selección confirmada.
2. Corroborar el SSID efectivo y su vigencia antes del envío. Bajo las restricciones
   actuales no se solicita lectura al CPE ni refresh. Si se necesita una lectura
   puntual activa para verificar el mismo SSID, incluirla explícitamente en la
   autorización de esa prueba, no confundirla con GET de caché.
3. La identidad y ONT→contrato→cliente están verificadas; TR-069→contrato sigue
   nulo. La futura vía de ejecución debe validar ese contrato exacto y definir
   explícitamente cómo tratar el vínculo nulo **sin crear/modificar asociaciones**.
   No pedir ni ejecutar vinculación automática ni usar otro contrato del cliente.
4. SmartRayco en `bbdab72` solo prepara; aplicar/revertir y proxy de escritura
   siguen bloqueados. No existe una vía habilitada de envío/recuperación. No se
   habilitó ni desplegó nada en este preflight. Este resultado no autoriza
   despliegues, migraciones ni escrituras de asociación.
5. Capacidad anunciada no garantiza aceptación Huawei. Un timeout puede dejar
   tarea pendiente y el cambio podría aparecer tarde. La prueba requiere acceso
   por cable, propietario presente y recuperación local antes de comenzar.

## Ejecución/verificación/reversión futuras, limitadas a la prueba

1. Revalidar inmediatamente antes del envío identidad única, ONT no retirada,
   contrato exacto, instancia y SSID anterior confirmado; si difiere, detener y
   preparar nuevo respaldo/confirmación. Revisar que no haya tareas pendientes.
2. Con vía específica revisada y autorización independiente, registrar hora
   efectiva de envío y taskId; enviar exactamente un `SetParameterValues` de
   `<instancia>.SSID` como `xsd:string`. Nunca provisionado combinado ni proxy
   abierto. El estado inicial es **Pendiente**, no éxito.
3. Esperar Inform posterior al envío (intervalo previamente confirmado 300 s),
   consultar por GET el mismo dispositivo y parámetro y revisar tarea/fault.
   Exigir SSID esperado y timestamp posterior al envío, además de Inform nuevo.
   El comparador local usa preparación: para la operación debe usarse la hora
   real de envío, más estricta. Propietario confirma SSID visible, conexión WiFi
   e Internet conservados. No deducirlo de HTTP 200, aceptación o Inform solo.
4. Si hay Inform pero SSID sin fecha nueva, mantener pendiente. Solo si se
   incluyó en la autorización, realizar lectura puntual activa del mismo SSID y
   repetir GET posterior; sin ello no certificar resultado ni repetir escrituras.
5. Para reversión autorizada, resolver tareas pendientes/faults antes de enviar
   la restauración; devolver **solo el SSID** anterior corroborado al mismo
   deviceId/path. Registrar hora/taskId de restauración y verificar otro Inform,
   valor/fecha nuevos y confirmación física. Si la gestión falla, recuperación
   local acordada. No tocar OLT, MikroTik, claves o WAN para compensar.

## Alcance exacto de una autorización futura

No se solicita ejecutar ahora: faltan las condiciones anteriores. Una vez
resueltas, la autorización puntual puede expresarse así, confirmando o cambiando
primero la red y nombre propuestos:

> Autorizo únicamente en HWTC1D3691B7, cliente prueba zava, contrato
> CTR-2026-00214, dispositivo GenieACS 00259E-HG8145X6%2D13-485754431D3691B7,
> cambiar InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID de
> WirelessNet-5G a WirelessNet-5G-PRUEBA, solo si la comprobación previa confirma
> ese SSID anterior. Incluyo restaurar ese mismo parámetro a WirelessNet-5G al
> terminar o ante fallo y las lecturas puntuales del mismo SSID necesarias antes,
> después y tras restaurar, con revisión de Inform y tarea. No autorizo cambios
> de contraseña, PPPoE, WAN, VLAN, asociaciones ni otras ONT.

Esta autorización **no** cubre despliegue/push/migración y no crea por sí misma
la vía de ejecución ausente. Se detiene antes de cualquier operación real.

## Validación local

Sintaxis del auxiliar aprobada. Lecturas GET completadas sin secretos en salidas.
Normalización reutilizada y comprobaciones locales de unicidad, concordancia de
IDs y contrato aprobadas sobre la evidencia guardada. Código de la aplicación
sin cambios; no se repitieron suites ni auditorías previas.
