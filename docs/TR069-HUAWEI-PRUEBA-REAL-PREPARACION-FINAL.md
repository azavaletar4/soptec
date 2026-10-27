# TR-069 Huawei HWTC1D3691B7 — preparación final de la prueba real

Preparación exclusiva para `HWTC1D3691B7` (1/2/2:24), previa a la primera
ejecución real. Todo lo de abajo es de solo lectura — **ningún comando de
escritura se ejecutó todavía.**

## 1. Respaldo del running-config actual (conservado)

Capturado 2026-10-27T19:36:17.943Z. Copia en
`/opt/smartrayco-staging/tr069-mgmt-wan-hwtc1d3691b7-20261027/backup/running-config-before.json`
(VM) y en el repo local (adjunto a este commit, ver abajo).

```
interface gpon-onu_1/2/2:24
  description "PRUEBA"
  sn-bind enable sn
  tcont 1 profile SMARTOLT-100M-UP
  gemport 1 tcont 1
  gemport 1 traffic-limit downstream SMARTOLT-100M-DOWN
  service-port 1 vport 1 user-vlan 120 vlan 120

pon-onu-mng gpon-onu_1/2/2:24
  service 1 gemport 1 vlan 120
  tr069-mgmt 1 state unlock
  tr069-mgmt 1 acs http://192.168.55.201:7547
```

## 2. Revalidación en vivo (justo antes de este documento)

- Estado OMCC/fase: `1/2/2:24 enable/enable/working` — operativa.
- Serial en vivo: `HWTC1D3691B7` — coincide exacto con el esperado.
- IPs de gestión ya usadas por otras 8 ONTs: `.161 .17 .30 .238 .26 .18 .199 .154`.
- `10.15.15.200`: sin respuesta a ping (libre) — comprobado dos veces hoy,
  la segunda inmediatamente antes de generar el plan final.

## 3. Reversión — corresponde exactamente a lo nuevo

El plan (generado por `planTr069ManagementWan`, no tipeado a mano) detectó
que `tr069-mgmt state unlock` y `tr069-mgmt acs` **ya existían** de un
intento anterior — por diseño, ni los comandos a ejecutar ni la reversión
los tocan. La reversión deshace únicamente las 9 líneas que esta operación
agregaría de nuevo (`service mgmt`, `switchport-bind`, `ip-host` x2,
`veip port`, `tr069-mgmt tag`, y en la interfaz: `service-port 2`,
`gemport 2`, `tcont 2`).

## 4. Internet / VLAN 120 — confirmado sin tocar

Verificación automática sobre el texto final de ambas listas (comandos y
reversión): **ninguna línea menciona** `vlan 120`, `tcont 1`, `gemport 1`
ni `service-port 1`. No es una promesa — es un grep sobre los comandos
reales que se ejecutarían.

## 5. Compatibilidad con los ejemplos Huawei reales

Comparado línea por línea contra `1/2/3:37` (Huawei real, `enable/working`
hoy mismo): misma estructura (`service mgmt`/`switchport-bind`/`ip-host`
x2/`veip port`/`tr069-mgmt tag`), mismos índices locales (vlan 200, iphost
2, veip 1, vport/tcont/gemport 2), mismo perfil tcont/traffic reutilizado
(`SMARTOLT-VOIPMNG-10M`). Única diferencia deliberada: se omite
`voip protocol sip` (no hace falta para TR-069 puro) y se usa el ACS/IP de
esta prueba en vez de los de la referencia.

## 6. Comandos finales a ejecutar (generados por el código real)

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

## Reversión

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
Sintaxis de remoción (`no ...`) sigue sin confirmar contra el equipo real
— confirmar en el momento, no asumir éxito silencioso.

## Verificaciones posteriores preparadas (a ejecutar DESPUÉS de la escritura real)

Todas de solo lectura, mismo mecanismo ya usado en esta sesión:

1. **Internet del cliente intacto**: re-leer `show running-config interface
   gpon-onu_1/2/2:24` y confirmar que `tcont 1`/`gemport 1`/`service-port 1`
   (vlan 120) son idénticos al respaldo del punto 1. Si el cliente estaba
   navegando, seguirá navegando sin ninguna acción adicional (no se
   reinicia la ONU).
2. **Configuración aplicada en la OLT**: `show running-config interface
   gpon-onu_1/2/2:24` + `pon-onu-mng gpon-onu_1/2/2:24` deben mostrar las 9
   líneas nuevas tal cual se mandaron.
3. **Primer Inform en GenieACS**: `GET /devices` (NBI) y
   `tr069_devices` — buscar un `cpe_serial` **exactamente** `HWTC1D3691B7`
   (nunca "algún CPE nuevo"). Revisar también
   `genieacs-cwmp-access.log` (hoy en 0 líneas) para confirmar que algo
   llegó.
4. **Coincidencia exacta de serial**: el mismo criterio que ya usa
   `src/lib/tr069EnableStatus.ts` — sin eso, igual se considera
   "Esperando conexión", nunca "Conectado".

## Pendiente

Ejecución real — requiere tu autorización expresa, todavía no dada en
este documento.
