# TR-069: WAN de gestión restaurada en HWTC1D3691B7 — GenieACS recibió Inform real (2026-10-30)

Autorización expresa del propietario: restaurar únicamente la interfaz de
gestión TR-069 (VLAN 200) de la Huawei `HWTC1D3691B7`, posición `1/2/2:24`,
usando el procedimiento ya existente y revisado
(`planTr069ManagementWan`/`configureTr069ManagementWanCommands`,
`server/src/services/tr069ManagementWan.ts`) y la configuración histórica
verificada (`docs/TR069-GESTION-INDEPENDIENTE-HUAWEI.md`). Continuación
directa de `docs/TR069-HABILITACION-REAL-HWTC1D3691B7-20261029.md` (TR-069
básico ya habilitado) y `docs/TR069-ENABLE-STATUS-ESTANCADO-20261029.md`
(diagnóstico final: faltaba la WAN de gestión completa, no solo el
`tr069-mgmt acs/state`).

## 1-3. Verificaciones previas a escribir (todas con datos frescos, en vivo)

- **Identidad/posición**: `show running-config` completo (735 posiciones),
  serial almacenado y serial en vivo en `1/2/2:24` coinciden exactamente
  con `HWTC1D3691B7` (`matchesExactly: true`).
- **IP de gestión libre**: `10.15.15.200` NO estaba entre las 8 IPs ya
  usadas por otras ONTs (`.161 .17 .30 .238 .26 .18 .199 .154`).
- **VLAN 200 / gateway / perfil correctos**: cruzado contra las 9 ONTs
  reales que YA tienen gestión VLAN 200 operativa en esta misma OLT — el
  único gateway usado en todas ellas es `10.15.15.1` (coincide exactamente
  con el valor planeado); perfil `SMARTOLT-VOIPMNG-10M` confirmado existente
  en la OLT.
- Estado "antes" congelado (interfaceBlock/mngBlock reales, ver abajo) y
  rollback específico calculado con `planTr069ManagementWan` (función pura,
  sin I/O) antes de tocar la OLT.

## 4. Estado "antes" (evidencia) y rollback preparado

**`interface gpon-onu_1/2/2:24` (antes):**
```
interface gpon-onu_1/2/2:24
  description "prueba"
  sn-bind enable sn
  tcont 1 profile SMARTOLT-100M-UP
  gemport 1 tcont 1
  gemport 1 traffic-limit downstream SMARTOLT-100M-DOWN
  service-port 1 vport 1 user-vlan 120 vlan 120
```

**`pon-onu-mng gpon-onu_1/2/2:24` (antes):**
```
pon-onu-mng gpon-onu_1/2/2:24
  service 1 gemport 1 vlan 120
  tr069-mgmt 1 state unlock
  tr069-mgmt 1 acs http://192.168.55.201:7547
```

**Rollback exacto preparado (no ejecutado, queda documentado por si se
necesita revertir):**
```
enable
configure terminal
pon-onu-mng gpon-onu_1/2/2:24
no tr069-mgmt 1 tag pri 2 vlan 200
no veip 1 port udp 1232 host 2
no ip-host 2 primary-dns 8.8.8.8 second-dns 8.8.4.4
no ip-host 2 ip 10.15.15.200 mask 255.255.255.0 gateway 10.15.15.1
no switchport-bind switch_0/1 veip 1
no service mgmt gemport 2 iphost 2 vlan 200
exit
interface gpon-onu_1/2/2:24
no service-port 2 vport 2 user-vlan 200 vlan 200
no gemport 2 traffic-limit downstream SMARTOLT-VOIPMNG-10M
no gemport 2 tcont 2
no tcont 2 profile SMARTOLT-VOIPMNG-10M
exit
```

## 5. Comando ejecutado — una sola vez

Solo los 7 sub-objetos que faltaban (`tr069-mgmt state`/`acs` ya estaban
aplicados desde la sesión anterior, no se repitieron):
```
enable
configure terminal
interface gpon-onu_1/2/2:24
tcont 2 profile SMARTOLT-VOIPMNG-10M
gemport 2 tcont 2
gemport 2 traffic-limit downstream SMARTOLT-VOIPMNG-10M
service-port 2 vport 2 user-vlan 200 vlan 200
exit
pon-onu-mng gpon-onu_1/2/2:24
service mgmt gemport 2 iphost 2 vlan 200
switchport-bind switch_0/1 veip 1
ip-host 2 ip 10.15.15.200 mask 255.255.255.0 gateway 10.15.15.1
ip-host 2 primary-dns 8.8.8.8 second-dns 8.8.4.4
veip 1 port udp 1232 host 2
tr069-mgmt 1 tag pri 2 vlan 200
exit
```

Nota de proceso: el primer intento de verificación posterior (lectura, no
escritura) falló por un error propio del script usado (pasé mal el
resultado de `fullRunningConfigCommand()` — ya devuelve un arreglo de 2
comandos — anidado dentro de otro arreglo), lo cual disparó un bug
preexistente de índice en `server/src/telnet/client.ts` (`commandVerb`
puede recibir `undefined` si `commands[commandIndex]` no es una cadena) y
terminó en una excepción de tipo, no en un rechazo real de la OLT. Se
detuvo la ejecución de inmediato (ningún comando adicional se envió) y se
repitió la lectura con el script corregido antes de continuar — la
escritura real (paso 5) en sí misma nunca repitió comandos ni se reintentó.

## 6. Verificación: VLAN 120/Internet/otros equipos intactos

**`interface gpon-onu_1/2/2:24` (después) — línea por línea contra "antes":**
```
interface gpon-onu_1/2/2:24
  description "prueba"                                          [igual]
  sn-bind enable sn                                              [igual]
  tcont 1 profile SMARTOLT-100M-UP                               [igual]
  tcont 2 profile SMARTOLT-VOIPMNG-10M                           [nuevo]
  gemport 1 tcont 1                                              [igual]
  gemport 1 traffic-limit downstream SMARTOLT-100M-DOWN          [igual]
  gemport 2 tcont 2                                              [nuevo]
  gemport 2 traffic-limit downstream SMARTOLT-VOIPMNG-10M        [nuevo]
  service-port 1 vport 1 user-vlan 120 vlan 120                  [igual]
  service-port 2 vport 2 user-vlan 200 vlan 200                  [nuevo]
```

**`pon-onu-mng gpon-onu_1/2/2:24` (después):**
```
pon-onu-mng gpon-onu_1/2/2:24
  service 1 gemport 1 vlan 120                                   [igual]
  service mgmt gemport 2 iphost 2 vlan 200                       [nuevo]
  switchport-bind switch_0/1 veip 1                               [nuevo]
  ip-host 2 ip 10.15.15.200 mask 255.255.255.0 gateway 10.15.15.1 [nuevo]
  ip-host 2 primary-dns 8.8.8.8 second-dns 8.8.4.4                [nuevo]
  veip 1 port udp 1232 host 2                                     [nuevo]
  tr069-mgmt 1 state unlock                                       [igual]
  tr069-mgmt 1 acs http://192.168.55.201:7547                     [igual]
  tr069-mgmt 1 tag pri 2 vlan 200                                 [nuevo]
```

Las líneas de VLAN 120/tcont1/gemport1/service-port1 (servicio de Internet
del cliente) y `tr069-mgmt state/acs` (ya aplicado antes) quedaron **sin
ningún cambio**, en el mismo orden. Ningún otro equipo/ONU fue tocado — un
único comando, una sola interfaz.

## 7. Internet — confirmado operativo, sin cambios

`show gpon onu state` para el puerto `1/2/2`:
```
1/2/2:24    enable       enable      working      1(GPON)
```
Admin state `enable`, estado operativo `working` — idéntico al estado antes
de la operación. Sin interrupción visible a nivel OLT.

## 8. GenieACS — Inform real recibido, ONU registrada (sin forzar nada)

Consulta de solo lectura al NBI de GenieACS (`GET /devices`, sin ninguna
tarea ni `connection_request` enviado):

```json
{
  "_id": "00259E-HG8145X6%2D13-485754431D3691B7",
  "_deviceId": {
    "_Manufacturer": "Huawei Technologies Co., Ltd",
    "_OUI": "00259E",
    "_ProductClass": "HG8145X6-13",
    "_SerialNumber": "485754431D3691B7"
  },
  "_lastInform": "2026-10-30T00:35:22.447Z",
  "_registered": "2026-10-30T00:35:22.447Z",
  "InternetGatewayDevice.ManagementServer.ConnectionRequestURL":
    "http://10.15.15.200:7547/cd3672d75e964478714767aee282da8f"
}
```

- `485754431D3691B7` es el mismo serial GPON de `HWTC1D3691B7` en su otra
  representación (ya confirmado por `matchTr069Device`/`gponSerial.ts`,
  commit `5104253`) — identidad exacta, sin ambigüedad.
- `_registered` = `_lastInform`: es el **primer Inform real** de este
  equipo desde que se restauró la WAN de gestión (antes de esta tarea,
  GenieACS tenía 0 dispositivos).
- El propio `ConnectionRequestURL` que GenieACS recibió apunta a
  `10.15.15.200:7547` — la IP exacta que se configuró en el paso 5. Esto
  confirma, con el dato que el equipo mismo reportó, que la ruta de vuelta
  por la nueva WAN de gestión (VLAN 200) ya es funcional, no solo que el
  Inform saliente llegó.
- Ningún `connection_request`, tarea, reinicio ni reintento fue enviado
  desde esta sesión — el Inform llegó por el ciclo periódico normal del
  propio equipo.

## 9. Estado final

| | Antes | Después |
|---|---|---|
| WAN de gestión (VLAN 200, IP, switchport-bind, veip) | ausente (borrada en la reautorización previa) | **restaurada, idéntica al patrón histórico** |
| `tr069-mgmt state`/`acs` | ya aplicado (sesión anterior) | sin cambios |
| VLAN 120 / Internet del cliente | online, `working` | online, `working` — sin cambios |
| GenieACS — dispositivos | 0 | **1** (`485754431D3691B7`) |
| GenieACS — último Inform | ninguno | `2026-10-30T00:35:22.447Z` (real, primero) |
| `ConnectionRequestURL` reportado | — | `http://10.15.15.200:7547/...` |

**La conexión TR-069 queda confirmada recuperada** — no por inferencia, sino
por un Inform real nuevo con identidad exacta y una URL de retorno que
corrobora la IP de gestión recién configurada.

## Restricciones respetadas

Un solo comando real de escritura a la OLT (los 7 sub-objetos faltantes,
nada repetido de lo ya aplicado); sin tocar VLAN 120, PPPoE, WiFi,
credenciales ni ningún otro equipo/ONU; sin reiniciar ni restaurar la
Huawei; sin tareas, `connection_request`, reintentos ni acciones forzadas
hacia GenieACS; sin migraciones, sin push, sin despliegue de código — todo
el trabajo de esta tarea fue Telnet de solo lectura/escritura puntual contra
la OLT real y una consulta de solo lectura al NBI de GenieACS. Los scripts
temporales (incluidos dos remanentes de la sesión anterior,
`preflight.ts`/`cross_check.ts`) se eliminaron del contenedor, de la VM y
del equipo local al terminar. Ninguna credencial de `olt_devices` se
imprimió en ningún momento de esta tarea.
