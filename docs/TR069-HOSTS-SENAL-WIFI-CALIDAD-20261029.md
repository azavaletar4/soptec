# Señal WiFi de Hosts — calidad orientativa implementada (2026-10-29)

Continuación de `docs/TR069-HOSTS-SENAL-WIFI-INVESTIGACION-20261029.md`
(no se repite esa investigación). Nueva evidencia del propietario: la
interfaz propia de la Huawei `HWTC1D3691B7` (`HG8145X6-13`) muestra
`RSSI -39 dBm` para `S26-Ultra-de-Warner` (MAC `56:b9:d2:f2:e7:c1`); TR-069
reportó `X_HW_RSSI=-40` para el mismo host — diferencia coherente con el
desfase entre ambas lecturas, no una discrepancia de escala. Esto confirma
(para este modelo+firmware exacto) lo que antes era solo "plausible".

## 1. Ruta reutilizada, sin nueva investigación

`InternetGatewayDevice.LANDevice.1.Hosts.Host.{i}.X_HW_RSSI` — la misma ya
documentada. No se buscaron parámetros nuevos.

## 2-3. Alcance exacto por fabricante+modelo+firmware

**Decisión de diseño clave: la interpretación de `X_HW_RSSI` como dBm NO
se activa por defecto ni por el nombre del parámetro — requiere una
identidad exacta verificada.** Nuevo en
`server/src/services/tr069HostsSignal.ts`:

```ts
export interface FirmwareIdentity { oui: string | null; productClass: string | null; softwareVersion: string | null; }

const VERIFIED_X_HW_RSSI_DBM_FIRMWARE: readonly FirmwareIdentity[] = [
  { oui: '00259E', productClass: 'HG8145X6-13', softwareVersion: 'V5R023C00S342' },
];
```

Esta es la ÚNICA combinación verificada (la de `HWTC1D3691B7`, confirmada
por el cruce con la interfaz propia de la ONT). Agregar otra combinación
exige repetir esa misma verificación cruzada — nunca se generaliza "todo
Huawei" ni siquiera "todo `HG8145X6-13`" sin importar el firmware: un
cambio de firmware (p. ej. una actualización futura) deja de coincidir
hasta verificarse de nuevo, a propósito.

`readHostWifiSignal(host, wlans, identity?)` ahora recibe un tercer
parámetro opcional. La excepción de "sin unidad declarada, igual se acepta
como dBm" aplica **solo** cuando `name === 'X_HW_RSSI'` **y** la identidad
coincide exacto con la lista verificada — `RSSI`/`SignalStrength`
(nombres TR-098/181 estándar) siguen exigiendo su `Unit` explícito como
antes, incluso en este mismo firmware (probado explícitamente).

La identidad se extrae en `server/src/services/tr069Hosts.ts`
(`hostsInventoryFromDevice`) de los propios campos que GenieACS ya
expone: `_deviceId._OUI`, `_deviceId._ProductClass` y
`InternetGatewayDevice.DeviceInfo.SoftwareVersion` (proyección ampliada en
`readHostsDevice` — 3 campos nuevos, solo lectura, sin tocar ningún otro
comportamiento). Se calcula una vez por equipo y se pasa a cada host —
nunca se adivina ni se asume de otra fuente.

## 4. Correlación MAC/identidad (ya existente, sin cambios)

`readHostWifiSignal` ya usaba el `Host.{i}` exacto (misma instancia de esa
MAC) o, en su defecto, `AssociatedDevice` filtrado por MAC exacta y por la
WLAN que el propio `Layer2Interface` del host señala — sigue igual.

## 5. Clasificación implementada

`src/lib/tr069Hosts.ts` (`hostWifiSignalPresentation`, función compartida
frontend/pruebas — sin cambios en su firma pública salvo el nuevo nivel):

| Rango dBm | Calidad | Color |
|---|---|---|
| ≥ -55 (incluye más fuerte que -30) | Excelente | Verde |
| -56 a -67 | Buena | Verde |
| -68 a -75 | Regular | Amarillo |
| < -75 | Débil | Rojo |

`level` pasa de 3 a 4 valores (`'excellent' \| 'good' \| 'fair' \| 'poor'`);
Excelente y Buena comparten color verde pero tienen etiqueta de texto
distinta — pedido explícito de la tarea. Actualizado en
`src/views/tr069/Tr069View.vue`: `signalColors`/`signalLabels` ahora
incluyen `excellent` (mismo verde que `good`).

Sin cambios en el límite de validez numérica ya existente
(`-120 ≤ dbm < 0`, entero) — `0` (el valor que reportan los Hosts
desconectados) sigue excluido, nunca se confunde con "0 dBm".

## 6-7. Sin porcentajes, sin velocidad, "No aplica"/"No disponible" intactos

Sin cambios: el label sigue siendo siempre `"${dbm} dBm"` o
`"No disponible"`/`"No aplica"` — nunca un porcentaje ni una cifra de
Mbps/velocidad (confirmado por una prueba nueva con regex). La lógica de
"No aplica" (Cable), "No disponible" (sin lectura verificable) y "Sin
confirmar" (estado general del host, función `hostStatusLabel`, sin
cambios) sigue exactamente igual.

## 8. Interfaz sencilla para personal administrativo

Sin nuevos controles ni pasos — el valor y la etiqueta aparecen en la
misma columna "Señal WiFi" que ya existía; solo cambia el texto/color
según el nuevo umbral. No se agregó nada que el administrativo deba
aprender a usar.

## 9. Sin polling, sin tareas de escritura

Sin cambios en el mecanismo de consulta (abrir Hosts / "Actualizar",
confirmado por las pruebas de vista ya existentes, no modificadas en su
intención). Esta tarea fue 100% solo lectura: cero tareas enviadas a
GenieACS, ninguna escritura a la Huawei, ninguna migración.

## 10. Pruebas agregadas

- `server/src/services/__tests__/tr069HostsSignal.test.ts`:
  - Umbrales con los 4 niveles y límites exactos (-30, -55/-56, -67/-68,
    -75/-76, -100) para `SignalStrength` con unidad explícita.
  - `X_HW_RSSI` en el firmware verificado: los mismos 4 niveles, sin
    unidad declarada por el equipo.
  - **Seguridad del alcance** (punto 3 de la tarea): el mismo `-40` en 6
    variantes de identidad NO verificada (sin identidad, identidad vacía,
    mismo modelo con otro firmware, otro modelo Huawei, otro fabricante/OUI,
    firmware vacío) — todas devuelven `null`/"No disponible".
  - `RSSI`/`SignalStrength` genéricos siguen exigiendo unidad explícita
    aunque el firmware esté verificado para `X_HW_RSSI`.
  - Caso real actualizado: con la identidad real verificada, S26-Ultra
    ahora muestra `"-40 dBm"` nivel `excellent`; los Hosts desconectados
    (`X_HW_RSSI=0`) siguen sin señal.
  - Pruebas previas (MAC distinta, señal antigua, Ethernet, caché sin
    unidad) conservadas sin cambios de intención.
- `server/src/services/__tests__/tr069Hosts.test.ts`: prueba de extremo a
  extremo nueva — la identidad se extrae del documento real del equipo
  (`_deviceId._OUI`/`_ProductClass`, `DeviceInfo.SoftwareVersion`) y
  habilita o bloquea la señal según el firmware exacto, pasando por
  `readHostsInventory` completo (no solo la función de señal aislada).
- `src/lib/__tests__/tr069HostsView.test.ts`: mock de `signalColors`/
  `signalLabels` actualizado con la nueva clave `excellent` (consistencia
  con el componente real; los escenarios existentes no cambian).

Resultado: `npm run test:provisioning` **330/330 PASS** (antes 326);
`npm run test:fetch-timeout` **498/498 PASS** (sin cambios, confirma que
ninguna prueba de vista existente se rompió); contrato de release
**31/31 PASS**; `tsc`/`vue-tsc` limpios.

## Evidencia actualizada

`docs/TR069-HOSTS-SIGNAL-CACHE-20261029.json` ampliado con:
- `identity`: `{oui, productClass, softwareVersion, manufacturer}` reales
  de este equipo (los mismos que entraron a la lista verificada).
- `ontOwnInterfaceCrossCheck`: el cruce real reportado por el propietario
  (ONT -39 dBm vs. TR-069 -40 dBm para el mismo host/MAC/momento).

## Archivos modificados

- `server/src/services/tr069HostsSignal.ts` (lógica + tipo `FirmwareIdentity`)
- `server/src/services/tr069Hosts.ts` (extracción de identidad + proyección NBI)
- `src/lib/tr069Hosts.ts` (`hostWifiSignalPresentation`, 4 niveles)
- `src/views/tr069/Tr069View.vue` (`signalColors`/`signalLabels`)
- `server/src/services/__tests__/tr069HostsSignal.test.ts`
- `server/src/services/__tests__/tr069Hosts.test.ts`
- `src/lib/__tests__/tr069HostsView.test.ts`
- `docs/TR069-HOSTS-SIGNAL-CACHE-20261029.json` (evidencia ampliada)
- Este documento.

Ningún archivo de otras fases (Fase 175, Puntos, Asistencia, etc.) fue
tocado. Sin cambios a configuración WiFi/contraseñas/OLT/MikroTik/PPPoE.
Sin migraciones. **Sin publicar ni desplegar** — commit local únicamente,
a la espera de autorización para GitHub y despliegue.
