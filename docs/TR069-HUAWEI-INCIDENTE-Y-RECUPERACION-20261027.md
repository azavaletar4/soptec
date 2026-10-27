# TR-069 Huawei HWTC1D3691B7 — incidente de internet y recuperación

## Línea de tiempo

- **19:44–19:45 UTC**: aplicada la interfaz de gestión independiente
  (ver `TR069-GESTION-INDEPENDIENTE-HUAWEI.md`), en 3 bloques verificados.
  Internet y PPPoE confirmados intactos inmediatamente después de cada
  bloque y al finalizar.
- **19:45:27 / 19:47:30 / 19:52:30 UTC**: 3 Informs reales recibidos en
  GenieACS (`cpeRequestId` 38/39/40) — TR-069 funcionando de punta a
  punta, sin interrupción, durante toda la ventana del incidente.
- El propietario reportó pérdida de ping a `8.8.8.8` en el equipo de
  prueba durante la ventana de la prueba.
- Por instrucción expresa, **no se ejecutó ninguna reversión** — se
  revalidó solo lectura y se preparó (sin ejecutar) revertir únicamente
  `tr069-mgmt 1 tag` como primer paso mínimo.
- El propietario reconectó el cable de red del **dispositivo de prueba**
  (no el WAN de la Huawei) y confirmó que el internet volvió.

## Evidencia que descarta una caída real de PPPoE/VLAN 120

- Sesión PPPoE real (`prueba`, `10.10.10.244`) con **uptime continuo**
  durante todo el incidente: nunca se reinició (confirmado en 3 lecturas
  sucesivas, siempre subiendo).
- `running-config` de la OLT: `service-port 1 vport 1 user-vlan 120 vlan
  120` y `service 1 gemport 1 vlan 120` **sin cambios**, idénticos al
  respaldo previo a la prueba, en todas las lecturas (antes, durante,
  después del incidente).
- OMCC/fase de la ONU: `enable/working` sin interrupción en ninguna
  lectura.
- Los 3 Informs de GenieACS llegaron en los intervalos de 300s
  esperados, **sin ningún hueco** que coincida con la ventana del
  incidente — la interfaz de gestión (VLAN 200) tampoco mostró caída.

## Causa — sin evidencia confirmada, no se asume

No se encontró evidencia de un conflicto real de rutas (ni una caída de
PPPoE, ni un hueco en los Informs). La explicación más consistente con
toda la evidencia reunida es que el corte estuvo del lado del **cable/NIC
del dispositivo de prueba** (lo que efectivamente se reconectó), no de la
Huawei ni de la OLT — pero esto no se declara como causa confirmada, solo
como la hipótesis mejor respaldada por los datos. No se ejecutó ninguna
prueba adicional que pudiera confirmarlo con certeza.

## Hallazgo nuevo, no relacionado al incidente: el serial TR-069 no es igual al serial GPON

GenieACS identifica el equipo con `_SerialNumber = "485754431D3691B7"`
(ManagementServer/TR-069), mientras que el serial GPON que usa la OLT es
`HWTC1D3691B7`. Comparten el sufijo `1D3691B7` pero no son el mismo
string. `tr069_devices.cpe_serial` ya sincronizado por el scheduler
automático refleja el serial TR-069, no el GPON.

**Esto significa que la lógica de "coincidencia exacta de serial" ya
implementada (`src/lib/tr069EnableStatus.ts`, ruta `/tr069/status`) nunca
va a encontrar esta coincidencia tal como está hoy** — comparar
`cpe_serial` contra `olt_onts.serial` literal seguirá mostrando "Esperando
conexión" en el panel aunque TR-069 esté realmente conectado y enviando
Informs reales cada 5 minutos. Es un ajuste de diseño pendiente, no un
problema de conectividad.

## Estado final (todo de solo lectura, nada escrito en esta verificación)

- ONU: `enable/working`, serial en vivo coincide.
- PPPoE del cliente: activo, sin interrupciones.
- VLAN 120 (Internet): intacta.
- VLAN 200 (gestión): intacta, IP `10.15.15.200` responde.
- GenieACS: 1 dispositivo registrado, 3 Informs reales recibidos,
  `tr069_devices` ya sincronizado por el scheduler automático.
- **TR-069 está realmente CONECTADO** (Informs reales, repetidos) — pero
  el panel seguirá mostrando "Esperando conexión" hasta ajustar la
  comparación de serial descrita arriba.

## Pendiente para completar la prueba

1. Confirmación del propietario de que el internet sigue estable (más
   allá del momento de este reporte).
2. Decidir y autorizar el ajuste de la lógica de coincidencia de serial
   (comparar por sufijo, o por la IP de gestión asignada) para que el
   panel refleje el estado real "Conectado".
3. Ningún cambio adicional en OLT/ONT se ejecutó ni se recomienda todavía.
