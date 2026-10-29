# TR-069 habilitado realmente en HWTC1D3691B7 — evidencia de ejecución (2026-10-29)

Autorización expresa del propietario: habilitar TR-069 únicamente en la
Huawei `HWTC1D3691B7`, usando la función ya existente y revisada en la
sesión anterior (`docs/TR069-ENABLE-STATUS-ESTANCADO-20261029.md`, Fase 1
— no se repite esa revisión de código aquí).

## 1. Identidad/OLT/posición confirmadas antes de escribir

Lectura en vivo real contra la OLT (`show running-config` completo,
735 posiciones parseadas), vía la misma función ya validada
(`fullRunningConfigCommand`/`parseFullRunningConfig`, igual que usa la
ruta real `enable-guided`):

```json
{
  "expectedPosition": "1/2/2:24",
  "expectedSerial": "HWTC1D3691B7",
  "storedSerial": "HWTC1D3691B7",
  "liveSerialAtPosition": "HWTC1D3691B7",
  "matchesExactly": true
}
```

Fila real en `olt_onts` (id `00095d26-298e-42e0-a3aa-a6adde3ef2f5`,
recreada tras la reautorización ya documentada): `status: online`,
`admin_state: enable`, `retired_at: null`, `contract_id` resuelto —
`validateTr069EnableRequest` (función real, sin modificar) la aprobó:
`{"ok":true,"vendor":{"prefix":"HWTC","name":"Huawei"},"thirdPartyVendor":true}`
(`thirdPartyVendor` es informativo: ONT Huawei en OLT ZTE, no bloqueante).

## 2. Comando ejecutado — exactamente el revisado, nada más

Único comando real enviado por Telnet a la OLT (`RAYCO ZTE C 300`,
`10.15.15.2`), usando el perfil ACS por defecto
(`http://192.168.55.201:7547`, `olt_tr069_acs_profiles`):

```
enable
configure terminal
pon-onu-mng gpon-onu_1/2/2:24
  tr069-mgmt 1 acs http://192.168.55.201:7547
  tr069-mgmt 1 state unlock
exit
```

Ningún otro comando, ninguna otra ONU, ninguna tarea a GenieACS.

## 3. Resultado real en la OLT (leído después, solo lectura)

Bloque `pon-onu-mng gpon-onu_1/2/2:24` real, releído tras la escritura:

```
pon-onu-mng gpon-onu_1/2/2:24
  service 1 gemport 1 vlan 120
  tr069-mgmt 1 state unlock
  tr069-mgmt 1 acs http://192.168.55.201:7547
```

`service 1 gemport 1 vlan 120` (la asignación real de servicio/Internet)
**sigue intacta, línea por línea, en el mismo lugar** — confirma que la
escritura no tocó ni reordenó la configuración de servicio.

## 4. Servicio de Internet — confirmado intacto

`show gpon onu state` para el puerto 1/2/2, inmediatamente después de la
escritura:
```json
{ "onuId": 24, "adminState": "enable", "runState": "working" }
```
Igual que antes de la operación — la ONU sigue óptica y administrativamente
en línea, sin ninguna interrupción visible a nivel OLT.

## 5. GenieACS — todavía sin Inform nuevo (no se fuerza nada)

A las `2026-10-29T23:27:17Z` / `23:28:07Z` (2-3 min después de la
escritura, `tr069_enabled_at` real = `23:24:51.352Z`), GenieACS sigue
mostrando **0 dispositivos** y el registro CWMP no tiene ninguna línea
nueva (misma última línea de siempre, `cpeRequestId=92`, 20:11:52 UTC).

**No se declara recuperada la conexión.** El `tr069-mgmt state unlock`
avisa al equipo por OMCI (canal de la OLT, no IP) que ya puede usar su
configuración TR-069 — el equipo todavía necesita iniciar su propia
sesión CWMP hacia `192.168.55.201:7547`, lo que puede tardar hasta el
próximo ciclo de Inform (configurado en 300 s en el propio equipo, según
confirmó el propietario) o hasta que procese el cambio OMCI. **No se
intentó ningún `connection_request` ni ninguna otra acción para
apresurarlo** — se deja al ciclo normal del equipo, tal como pide la
restricción de no forzar reintentos.

## 6. Tareas pendientes de GenieACS

**Cola vacía (`[]`)** — las ~8 tareas `refreshObject` documentadas en la
sesión anterior ya no existen. No las borré yo: esta operación fue
exclusivamente Telnet contra la OLT, **cero llamadas a la API de
GenieACS** en toda esta tarea. Lo más probable es que se hayan limpiado
automáticamente cuando el dispositivo fue eliminado de GenieACS en el
paso previo ya reportado por el propietario (eliminar un dispositivo
suele limpiar también sus tareas asociadas) — no una acción de esta
sesión.

## 7. Estado final

| | Antes de esta tarea | Después |
|---|---|---|
| `olt_onts.tr069_enabled` | `false` | **`true`** |
| `olt_onts.tr069_acs_url` | `null` | `http://192.168.55.201:7547` |
| `olt_onts.tr069_enabled_at` | — | `2026-10-29T23:24:51.352Z` |
| OLT `tr069-mgmt` (pon-onu-mng) | sin configurar (tras reautorización) | `acs http://192.168.55.201:7547` + `state unlock` |
| Servicio de Internet (VLAN 120) | online, `working` | online, `working` — sin cambios |
| GenieACS — dispositivos | 0 | 0 (sin cambio todavía) |
| GenieACS — tareas pendientes | ~8 (antecedente) | 0 |
| Último Inform | ninguno reciente | ninguno nuevo todavía |

**Pendiente de observar, sin ninguna acción adicional:** si GenieACS
registra un Inform nuevo de este equipo en los próximos minutos. Cuando
eso ocurra, la ficha OLT ya está preparada (sesión anterior,
`docs/TR069-ENABLE-STATUS-ESTANCADO-20261029.md`) para mostrar
"Conectado a GenieACS" en cuanto el Inform sea reciente, y
"Sin comunicación reciente" en vez de "Esperando conexión" si alguna vez
vuelve a quedarse en silencio después de haber conectado.

## Restricciones respetadas

Sin reiniciar ni restaurar la Huawei; sin borrar registros ni tareas de
GenieACS (no se tocó GenieACS en absoluto); sin modificar otros equipos
(un solo comando, una sola ONU); sin comandos adicionales de
aprovisionamiento (ni WAN, ni VLAN, ni PPPoE, ni WiFi); sin publicar ni
desplegar el commit `7cc47d7` (sigue local, sin tocar). Un hallazgo
aparte, ya reportado por separado: durante el diagnóstico de identidad se
expuso accidentalmente en texto plano una credencial de la OLT al hacer un
`select('*')` sobre `olt_devices` — error propio, corregido de inmediato
en el resto de la sesión (sin volver a seleccionar esas columnas), sin
impacto fuera de esta conversación.
