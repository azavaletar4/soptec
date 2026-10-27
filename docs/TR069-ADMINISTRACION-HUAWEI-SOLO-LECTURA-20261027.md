# Administración Huawei HWTC1D3691B7 — diagnóstico de caché, 27/10/2026

## Alcance y evidencia

Continuación de `1ae1603`, publicado en
`docs/tr069-continuidad-confirmada-20261027`. No se reabre el diagnóstico de
conexión: TR-069 y la confirmación visual siguen completados.

Consulta final: **2026-10-27 20:35:42 UTC (15:35:42 Perú)**. Solo GET NBI
`/devices/?query=...` filtrado por el serial TR-069 exacto `485754431D3691B7`;
se exigió un único resultado. Sin tareas, refresh, connection requests,
escrituras ni comandos OLT/ONT/MikroTik. Último Inform cacheado:
`2026-10-27T20:32:31.480Z`. No se confunde su fecha con la fecha de cada valor.

Evidencia saneada: `TR069-HUAWEI-PARAMETROS-SOLO-LECTURA-20261027.json`.
Los secretos se sustituyen antes de salir del proceso remoto; el JSON no es
un respaldo de contraseñas ni permite restaurarlas. `hasCachedValue=true`
no acredita una clave recuperable, no vacía ni válida.

El auxiliar interrumpido tenía una consulta adicional GET de relaciones en
Supabase. Una edición local falló y esa versión se ejecutó una vez al retomar;
leyó metadatos del vínculo, sin escribir. Se retiró ese bloque y se completó
la consulta final exclusivamente sobre GenieACS. El artefacto final contiene
solo evidencia NBI. No se alteraron permisos ni credenciales productivas.

## Parámetros realmente encontrados

Equipo NBI: `00259E-HG8145X6%2D13-485754431D3691B7`, modelo HG8145X6-13.
Raíz presente: **InternetGatewayDevice**; no se observó raíz `Device` en esta
caché. Hardware `46AD.D`, software `V5R023C00S342`. Esto describe la caché
observada, no una enumeración completa de todo lo soportado por el firmware.

En la tabla, `IGD` abrevia `InternetGatewayDevice` y
`WLAN` abrevia `IGD.LANDevice.1.WLANConfiguration`.

| Parámetro | Evidencia en caché | Escritura |
|---|---|---|
| `WLAN.1.SSID` | Valor legible: `RAYCO 18` | `_writable=true`, no probada |
| `WLAN.5.SSID` | Valor legible: `WirelessNet-5G` | `_writable=true`, no probada |
| `WLAN.1.KeyPassphrase`, `WLAN.5.KeyPassphrase` | Campo con valor cacheado, oculto; no se acredita recuperación de la clave | `_writable=true`, no probada |
| `WLAN.{1,5}.Enable`, `RadioEnabled` | Nombre presente, **sin valor cacheado** | `_writable=true`, no probada |
| `WLAN.{1,5}.BeaconType`, `IEEE11iAuthenticationMode`, `IEEE11iEncryptionModes`, `WPAAuthenticationMode`, `WPAEncryptionModes` | Nombres presentes, sin valor; modo de seguridad real desconocido | Metadatos no acreditan aplicación real |
| `WLAN.{1,5}.Standard`, `Channel`, `PossibleChannels` | Nombres presentes, sin valor; banda sin confirmar | No probada |
| `WLAN.{1,5}.PreSharedKey` | Objeto anunciado; no se acreditó una clave legible ni una ruta de clave instanciada | No probada |
| `IGD.WANDevice.1.WANConnectionDevice.1.WANPPPConnection` | **Objeto anunciado sin instancia**, y `WANPPPConnectionNumberOfEntries` sin valor | No probada |
| `WANPPPConnection.<n>.Username`, `.Password`, `.ConnectionStatus` | No se encontraron instancias ni valores cacheados | Desconocida |
| `IGD.WANDevice.1.WANConnectionDevice.2.WANIPConnection.1.ExternalIPAddress` | Valor `10.15.15.200`, corresponde a la gestión independiente documentada | Proteger de cambios de Internet |
| Misma WAN IP: `ConnectionStatus`, `X_HW_SERVICELIST`, `X_HW_VLAN` | Nombres presentes, sin valor; no permiten certificar estado/VLAN desde este árbol | No probada |
| `IGD.ManagementServer.PeriodicInformInterval` | Valor 300 segundos | No se modificó |

Los valores SSID/KeyPassphrase datan de **19:45:10 UTC**, anteriores al último
Inform: recibir un Inform no garantiza renovar todo el árbol. El nombre
`WirelessNet-5G` no demuestra banda 5 GHz; tampoco se asigna 2.4 GHz a la
instancia 1 por su índice. No se certifican bandas, seguridad ni PPPoE con
datos ausentes. Un nombre presente y `_writable=true` no prueban legibilidad
del valor ni que `SetParameterValues` funcione en este firmware.

## Funciones ya implementadas y límites específicos

Revisión del código local, sin afirmar que todos estos archivos coincidan
con el artefacto productivo; esta etapa no hizo una auditoría de despliegue.

- `server/src/services/tr069DeviceService.ts`: GET de usuario PPPoE y redes
  WiFi; encolado de usuario/clave PPPoE, SSID/KeyPassphrase, reinicio, refresh
  y aprovisionamiento combinado. Reutilizar lecturas y transporte, sin invocar
  acciones en esta etapa. La búsqueda NBI compara serial literal y toma el
  primer resultado; falta reutilizar la normalización y rechazo de ambigüedad
  ya implementados en `src/lib/gponSerial.ts` para los estados OLT.
- `getWifiNetworks` exige `Enable._value === true`. Para esta caché devolvería
  cero redes aunque hay dos SSID legibles: **estado desconocido no es apagado**.
  No se ejecutó ese endpoint para demostrarlo: se deriva de la condición real.
- `getPppoeInfo` usa la primera instancia WANPPPConnection; aquí no hay ninguna
  instanciada. No permite establecer el usuario real de la ONT.
- `queueWifiChange` acepta un path del cliente y concatena SSID/KeyPassphrase,
  sin validar que sea una instancia permitida del dispositivo. Falta lista
  explícita de rutas y capacidades. `queuePppoeChange` selecciona la primera
  WAN y, si falta, **encola descubrimiento**: nunca usarla como lectura.
- `queueTask` hace POST con `?connection_request`; no se utilizó. Resultado
  `ok/queued` indica aceptación de tarea, no verificación de aplicación.
- `server/src/routes/genieacsSync.ts` y proxy `genieacs.ts` permiten escribir
  también a TECNICO_RED. Futuro requisito: solo ADMIN/SUPERADMIN en servidor,
  incluyendo proxy para que no permita eludir las guardas.
- `src/stores/tr069.ts` y `src/views/tr069/Tr069View.vue`: ya hay formulario
  conjunto PPPoE/WiFi con selección de red, valores nuevos y resultado encolado.
  Selecciona por defecto la primera red, no separa cambios PPPoE/WiFi ni verifica
  resultado. Los inputs de contraseña carecen de `type="password"`; corregir
  antes de uso. No convertir errores/respuestas de tareas en logs con claves.
- `OntDetailModal.vue` → `OltDetailView.vue`: «Administrar TR-069» abre el modal
  de asignar/quitar ACS por OLT. No es todavía acceso a administrar WiFi.

## Contrato exacto y PPPoE: operación futura separada

Fuentes de vínculo existentes: `olt_onts.contract_id` / `client_id`,
`service_contracts.id` / `client_id` / `pppoe_username` / `mikrotik_device_id`,
y `tr069_devices.service_contract_id`. No confundir este último con un campo
`contract_id` en esa tabla. El store ya permite vincular un contrato, pero
las funciones de escritura por serial no verifican estos vínculos.

La lectura adicional inicial encontró la ONT vinculada a `CTR-2026-00214` y
el registro TR-069 con `service_contract_id=null`. No se cambió esa relación
ni se conserva el usuario PPPoE en este informe. Aun existiendo usuario en el
contrato, **no se ha comparado con un usuario real legible de la ONT**.

Diseño requerido: resolver dispositivo único por serial normalizado completo,
ONT no retirada, contrato exacto y cliente concordantes; si hay vínculo
ausente/discrepante, bloquear y pedir verificación, nunca elegir otro contrato
del mismo cliente. No vincular ni resolver ambigüedades automáticamente.
Seleccionar explícitamente WAN de Internet por instancia y servicio verificados;
excluir gestión `10.15.15.200`, ManagementServer y VLAN 200. Sin esa identificación,
mantener PPPoE como «No disponible para administrar».

Antes de una escritura PPPoE futura: autorización separada, credenciales
autorizadas vigentes y anteriores custodiadas fuera de logs/Git, corroboración
del contrato y router exactos y capacidad de recuperación por gestión
independiente o acceso local. No copiar ciegamente el valor administrativo a la
ONT ni modificar MikroTik como consecuencia implícita. Si se pierde Internet,
restaurar las credenciales anteriores mediante gestión independiente verificada;
si esta falla, recuperación local previamente acordada. Sin acceso de recuperación
y claves anteriores válidas no iniciar la operación. Esta etapa no lo probó.

## Interfaz sencilla propuesta y archivos futuros

Los datos permiten construir una vista **parcial de solo lectura**:
WiFi (dos SSID, estado/banda/seguridad «Sin verificar»), PPPoE («Sin datos
legibles», sin asumir valores) y Diagnóstico (modelo, firmware, último Inform,
antigüedad por parámetro e IP de gestión). Identificar cliente/contrato solo
con vínculo verificado y ofrecer enlace a su ficha; horas de eventos en Perú.

Archivos a modificar en una entrega posterior autorizada:

1. `server/src/services/tr069DeviceService.ts`: identidad única, inventario de
   capacidades/fechas, estado desconocido, selección explícita y validación de
   ruta, comprobación de resultado y separación de operaciones.
2. `server/src/routes/genieacsSync.ts`, `server/src/routes/genieacs.ts`: roles,
   contrato exacto, lista de rutas y protección del proxy/secretos.
3. `src/stores/tr069.ts`, `src/types/domain.ts`: contratos de lectura con
   metadatos y estados pendiente/aplicado/verificado/fallido, sin claves leídas.
4. `src/views/tr069/Tr069View.vue`, `src/views/olt/OltDetailView.vue`,
   `src/views/olt/OntDetailModal.vue`: acceso correcto y secciones WiFi, PPPoE,
   Diagnóstico; contraseña oculta y confirmación de una sola operación.
5. Pruebas locales dirigidas en servicio/rutas/UI: seriales equivalentes y
   ambiguos, Enable desconocido, path ajeno, roles, cliente con dos contratos,
   rechazo de WAN de gestión y éxito encolado sin verificar. Ningún SQL nuevo
   se justifica todavía por estos hallazgos.

## Primera prueba WiFi propuesta — no ejecutada ni autorizada

1. Preparar primero las guardas y presentación anteriores con pruebas locales
   ficticias; mantener PPPoE separado y bloqueado. Confirmar red elegida por
   path completo y SSID, sin inferir banda. Si se necesita consultar valores
   frescos del CPE, pedir autorización separada para esa tarea: el GET de caché
   por sí solo no los actualiza.
2. Con acceso por cable y propietario presente, respaldar el SSID efectivo
   anterior y confirmar su vigencia. Primera prueba **solo SSID de una red**;
   no tocar contraseña, seguridad, canal, otra red, PPPoE ni gestión. El JSON
   saneado es evidencia, no respaldo de configuración para aplicar sin validar.
3. Obtener autorización independiente con ONT, contrato verificado, path,
   valor anterior/nuevo, ventana y reversión acordados. No usar provisionado
   combinado ni selección automática de primera red.
4. En la futura ventana autorizada, encolar exactamente un cambio. Mostrar
   «Pendiente» hasta comprobar resultado/fault y valor posterior con fecha nueva;
   un Inform o aceptación HTTP no equivalen a cambio verificado. Acordar antes
   cómo obtener ese valor si los Informs no lo renuevan espontáneamente.
5. Propietario confirma SSID visible, conexión WiFi e Internet/PPPoE operativos;
   comprobar continuidad de gestión. Ante fallo o al terminar prueba, restaurar
   solo el SSID anterior con una tarea separada prevista en la autorización y
   verificarlo de nuevo. No apilar cambios ante timeout: revisar tarea pendiente
   para evitar aplicación tardía después de la reversión.
6. Probar clave WiFi después, con otra autorización, modo de seguridad conocido
   y clave anterior válida guardada de forma segura; nunca basar reversión en
   un valor vacío/enmascarado del ACS. PPPoE queda para una operación distinta.

## Validación y estado de Git

Auxiliar corregido: `node --check` aprobado y GET NBI ejecutado correctamente;
se conserva una copia versionable en `scripts/tr069-readonly-parameters.cjs`
(el original bajo `scripts/inventory-auth-lab/runtime/` queda auxiliar local
ignorado por Git). Ambos contienen solo lectura GET NBI y saneamiento.
14 parámetros con valor y 234 nodos adicionales de metadatos en el filtro.
Dos nombres contienen WANPPPConnection (objeto y contador), **cero instancias
PPP con valores**. Secretos excluidos del informe y JSON saneado. Sin pruebas
funcionales de escritura, compilaciones ni suites generales: no se cambió
código de la aplicación. Commit local de esta tarea, sin push/merge; se
conserva la divergencia de main y todos los cambios ajenos.
