# TR-069: interfaz de gestión independiente por OMCI (Huawei) — preparado, no ejecutado

Commit local (sin push). Implementa el método de "gestión independiente"
que ya usa la vieja plataforma SmartOLT en 6 Huawei GPT-2741GNAC reales de
esta misma OLT ZTE C300 — descubierto por lectura directa del
`running-config`, nunca documentado antes en este repo.

## Por qué hacía falta esto

El intento anterior (`tr069-mgmt acs`/`state unlock` solos, sin IP de
gestión propia) nunca generó tráfico: el ONT no tenía por dónde enviarlo.
Las 6 Huawei reales con gestión VLAN 200 completa siguen `enable/working`
hoy mismo — el patrón es real y estable, no solo teórico.

## Patrón reutilizado (idéntico a las 6 referencias reales)

Interfaz (`interface gpon-onu_S/L/P:ID`) — **aditivo**, nunca toca
`tcont 1`/`gemport 1`/`service-port 1` (Internet del cliente, VLAN 120):
```
tcont 2 profile SMARTOLT-VOIPMNG-10M     (perfil YA existente, reutilizado)
gemport 2 tcont 2
gemport 2 traffic-limit downstream SMARTOLT-VOIPMNG-10M
service-port 2 vport 2 user-vlan 200 vlan 200
```

OMCI (`pon-onu-mng gpon-onu_S/L/P:ID`):
```
service mgmt gemport 2 iphost 2 vlan 200
switchport-bind switch_0/1 veip 1
ip-host 2 ip <IP libre en 10.15.15.0/24> mask 255.255.255.0 gateway 10.15.15.1
ip-host 2 primary-dns 8.8.8.8 second-dns 8.8.4.4
veip 1 port udp 1232 host 2
tr069-mgmt 1 state unlock
tr069-mgmt 1 acs <url>
tr069-mgmt 1 tag pri 2 vlan 200
```

## Código nuevo (local, con pruebas, sin ejecutar nada real)

- `server/src/ssh/zteCommands.ts`: `configureTr069ManagementWanCommands` /
  `removeTr069ManagementWanCommands` — constructores puros, parametrizados,
  con flags de "ya existe" por línea (nunca duplican lo que ya está).
- `server/src/ssh/zteParsers.ts`: `extractManagementIpAssignments`,
  `extractPonOnuMngBlock`, `extractOnuInterfaceBlock` — lectura, sin
  tocar nada.
- `server/src/services/tr069ManagementWan.ts`: `planTr069ManagementWan` —
  valida serial/posición en vivo, IP no duplicada (salvo que sea la IP que
  la MISMA ONU ya tenía), conflicto de ACS distinto, "ya todo configurado";
  arma `commands`/`rollbackCommands` simétricos.
- 20 pruebas unitarias nuevas (`server/src/services/__tests__/tr069ManagementWan.test.ts`),
  todas con datos simulados. `tsc` backend sin errores nuevos; 247/247
  pruebas de `server/src/services/__tests__` en verde.

## Validado por lectura en vivo (solo lectura, nada escrito)

- `HWTC1D3691B7` (1/2/2:24): sigue `enable/working`, serial en vivo
  coincide exacto. `tr069-mgmt state unlock` y `tr069-mgmt acs` YA
  presentes de un intento anterior — el plan los omite automáticamente.
- IPs de gestión ya usadas por otras 8 ONTs: `.161 .17 .30 .238 .26 .18
  .199 .154`. `10.15.15.200` comprobada libre (sin respuesta a ping) dos
  veces, la más reciente justo antes de generar el plan de abajo.

## Comandos EXACTOS que se ejecutarían (generados por el código real, NO tipeados a mano — ninguno ejecutado)

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
(`tr069-mgmt 1 state unlock` y `tr069-mgmt 1 acs http://192.168.55.201:7547`
se omiten — ya estaban aplicados.)

## Reversión exacta (solo lo nuevo, generada por el mismo código)

```
enable
configure terminal
pon-onu-mng gpon-onu_1/2/2:24
no tr069-mgmt 1 tag
no veip 1 port udp 1232 host 2
no ip-host 2 primary-dns
no ip-host 2 ip
no switchport-bind switch_0/1 veip 1
no service mgmt gemport 2
exit
interface gpon-onu_1/2/2:24
no service-port 2
no gemport 2
no tcont 2
exit
```
**Sintaxis de remoción (`no ...`) NO confirmada todavía contra el equipo
real** — a diferencia de los comandos de escritura (ya validados, syntax
aceptada por el CLI), ningún `no` de esta lista se probó aún. Confirmar
antes o durante la prueba controlada, no asumir que funciona igual.

## Pendiente, fuera de este commit

- Ejecutar esto de verdad contra `HWTC1D3691B7` — requiere autorización
  expresa aparte.
- Guardar en algún lado (hoy no existe columna) qué IP de gestión quedó
  asignada, para no repetir el escaneo manual cada vez.
- Confirmar si `voip protocol sip` (presente en una de las 6 referencias,
  omitido aquí a propósito por no ser necesario para TR-069 puro) hace
  alguna diferencia real.
