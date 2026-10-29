# Señal WiFi de Hosts — investigación real (2026-10-29)

Caso reportado: en el panel de la Huawei `HWTC1D3691B7` (contrato
`CTR-2026-00214`), `S26-Ultra-de-Warner` aparece conectado por WiFi
(`192.168.100.35`) pero SmartRayco muestra «Señal WiFi: No disponible»,
aunque la propia interfaz web de la ONT sí muestra una intensidad.

**Conclusión corta: no es un error. TR-069 en este equipo no expone una
unidad verificable para su único parámetro de señal (`X_HW_RSSI`), así que
SmartRayco no puede mostrar dBm/colores sin inventar esa unidad — y no lo
hace, por diseño.**

## 1-2. Inspección real (solo lectura, sin tareas nuevas a GenieACS)

Se leyó el documento COMPLETO del equipo en GenieACS (sin proyección, para
no perderse ningún parámetro), 2026-10-29 19:51:36 UTC. Resultado
completo, sanitizado, en `docs/TR069-HOSTS-SIGNAL-CACHE-20261029.json`.

- **`Hosts.Host.{i}.X_HW_RSSI`** (vendor-specific Huawei): el ÚNICO
  parámetro con valores reales relacionados a señal. Los 4 Hosts actuales:

  | Host | Nombre | MAC | Activo | Interfaz | `X_HW_RSSI` |
  |---|---|---|---|---|---|
  | 1 | Z2359 | `7e:75:b3:0a:86:76` | false | WiFi | `0` |
  | 2 | LAPTOP-996NPL7I | `00:07:29:55:35:57` | true | Cable | `0` |
  | 3 | iPhone | `be:9e:54:93:df:8c` | false | WiFi | `0` |
  | **4** | **S26-Ultra-de-Warner** | `56:b9:d2:f2:e7:c1` | **true** | **WiFi** | **`-40`** |

  El dispositivo del reporte (`S26-Ultra-de-Warner`) **sí tiene un valor
  real y reciente**: `-40` (`xsd:int`), timestamp propio
  `2026-10-29T19:51:36.694Z` — no es un valor viejo ni inventado, el equipo
  lo reportó. Los desconectados muestran `0` (probable valor "sin
  medición", no una señal real de 0 dBm).

- **Unidad del valor: NO declarada por el equipo, en ningún nivel.**
  Se buscó explícitamente, leyendo el árbol completo real:
  - `X_HW_RSSIUnit` — **ausente** en los 4 Hosts (ni siquiera aparece como
    parámetro vacío; no existe en el modelo de datos que expone este
    firmware).
  - `RSSI`, `RSSIUnit`, `SignalStrength`, `SignalStrengthUnit` (nombres
    TR-098/181 estándar) — **ausentes** en los 4 Hosts.
  - `WLANConfiguration.{1,5}.AssociatedDevice.*` — **cero instancias**
    reportadas en esta muestra (`associations: 0`); no hay ninguna vía de
    correlación por asociación WiFi disponible ahora mismo, solo el valor
    directo en el propio `Host.{i}`.
  - Se revisó además el árbol completo (88 KB, sin proyección) buscando
    cualquier otro parámetro con `RSSI`, `Signal`, `dBm`, `Rate`, `Noise`,
    `SNR` o vendor-specific `X_HW_*`: solo aparecen parámetros Huawei de
    configuración/diagnóstico genéricos (`X_HW_WiFiDiagnostic`,
    `X_HW_WIFIInfo`, etc.) **sin valor** (`None`) — el firmware no los
    rellena vía TR-069 en este momento.

- **Investigación pública (igual que la de "KeyPassphrase" de sesiones
  anteriores — no se repite esa, esta es nueva y específica de
  `X_HW_RSSI`):** no se encontró documentación oficial de Huawei que
  confirme la unidad de `X_HW_RSSI`. Un foro de GenieACS y uno de Huawei
  Enterprise no tienen información específica sobre este parámetro. Un
  proyecto de terceros (no oficial, `RodrigoChang/TR-069-Unifi-Simulator`
  en GitHub) menciona de paso que "Huawei's positive RSSI magnitude is
  converted to negative dBm" para un escenario **distinto**: RSSI
  reportado como magnitud **positiva** que hay que convertir — lo opuesto
  a lo que observamos aquí (`-40`, ya negativo). No es una fuente oficial
  ni coincide con el comportamiento real observado; no se usó como base
  para implementar nada.

## 3. Correlación por MAC/asociación

El mecanismo ya existente (`server/src/services/tr069HostsSignal.ts`,
`readHostWifiSignal`, sin cambios) ya hace esto correctamente: usa
`X_HW_RSSI` del propio `Host.{i}` (ya es la instancia de esa MAC exacta,
sin ambigüedad) o, si no estuviera ahí, lo busca en
`AssociatedDevice` filtrando por MAC exacta y por la `WLANConfiguration`
que el propio `Host.Layer2Interface` señala — nunca la primera coincidencia
si hay más de una. Esto ya estaba implementado y es correcto; el problema
reportado no es de correlación, es de unidad no verificable.

## 4. ¿Caché o consulta activa?

**Está en caché, no requiere ninguna consulta activa nueva.** El valor
`-40` de `S26-Ultra-de-Warner` se leyó con un simple `GET` de solo lectura
sobre lo que GenieACS ya tenía almacenado del último Inform del equipo —
cero tareas enviadas. La lectura bajo demanda (`tr069HostsOnDemand.ts`)
también lo incluye en su plan (`HOST_FIELDS` ya tiene `X_HW_RSSI`/
`X_HW_RSSIUnit`) y lo refresca si se pulsa "Actualizar", pero no es
necesaria para obtener el valor — solo para confirmarlo más reciente.

## 5-7. ¿Se implementa la visualización?

**No.** La tarea autoriza implementar "si existe una fuente fiable" y
prohíbe expresamente "inventar porcentajes ni convertir dBm... sin una
escala definida y documentada". Aquí no hay:
- Ninguna declaración de unidad por parte del propio equipo.
- Ninguna documentación pública, oficial o consistente, que confirme que
  `X_HW_RSSI` está en dBm para este modelo/firmware exacto
  (`HG8145X6`/`V5R023C00S342`).
- El único dato de terceros encontrado describe un comportamiento
  **distinto** al observado (conversión de magnitud positiva, no de un
  valor ya negativo).

El valor `-40` **es plausible** como dBm (rango típico WiFi, convención de
nombre RSSI) y **es consistente** con la observación del propietario
(conectado y activo cuando antes no lo estaba) — pero "plausible" no es
"documentado". Tratar este valor como dBm sin esa confirmación sería
exactamente la inversión de unidad que las reglas del proyecto (y las de
esta tarea) prohíben. **Se mantiene "No disponible" sin cambios en
`tr069HostsSignal.ts`/`tr069Hosts.ts` ni en el frontend** — es el
comportamiento correcto, no un defecto a corregir.

## 8. Actualización exclusiva al abrir/Actualizar

Sin cambios: no se tocó ningún mecanismo de consulta. Confirmado que
`X_HW_RSSI` se leyó aquí con un único `GET` manual fuera de la aplicación
(para esta investigación), no por la aplicación ni por ningún polling.

## 9. Pruebas agregadas

`server/src/services/__tests__/tr069HostsSignal.test.ts`: nueva prueba
"caso real reportado (29/10)" que reproduce exactamente el escenario del
propietario con el dato real capturado hoy (los 4 Hosts reales, 4 MAC
distintas, incluido `S26-Ultra-de-Warner` con `X_HW_RSSI=-40` real y
activo por WiFi) y confirma que:
- Ninguna de las 4 MAC obtiene una señal verificable (`readHostWifiSignal`
  devuelve `null` para las 4).
- El caso específico de `S26-Ultra-de-Warner` sigue presentando
  `{"label":"No disponible","level":null}` incluso con su valor real y
  reciente.
- `X_HW_RSSIUnit`/`RSSI`/`RSSIUnit`/`SignalStrength`/`SignalStrengthUnit`
  nunca aparecen con valor en ninguno de los 4 Hosts, y no hay ninguna
  instancia `AssociatedDevice` para esta muestra.

Las pruebas ya existentes (señal simulada con unidad explícita
verde/amarillo/rojo, sin unidad, señal antigua, MAC distinta, Ethernet)
ya cubrían "varios dispositivos", "MAC diferentes", "señal ausente" y
"valores antiguos" de forma simulada — la nueva prueba añade el caso real
de hoy con datos reales de la Huawei, no simulados.

Resultado: `npm run test:provisioning` **326/326 PASS** (antes 325);
`npx tsc --noEmit -p tsconfig.server.json` limpio. Sin cambios en frontend
(ningún comportamiento visual cambia).

## Entrega / respuesta a la pregunta planteada

**¿La Huawei expone realmente la señal por TR-069?** Expone un valor
numérico real y actualizado (`X_HW_RSSI`) que muy probablemente representa
la intensidad en dBm (por convención de nombre y rango de valores), **pero
no declara su unidad** en ningún parámetro TR-069 estándar ni
vendor-specific disponible, y no se encontró documentación pública fiable
que lo confirme para este modelo/firmware. Por eso SmartRayco no puede
mostrarlo con garantía, y no lo inventa.

**Ruta exacta del parámetro:**
`InternetGatewayDevice.LANDevice.1.Hosts.Host.{i}.X_HW_RSSI` (lectura
directa, sin necesidad de correlación por `AssociatedDevice` cuando está
presente ahí).

**Sin cambios locales funcionales** — solo una prueba de regresión nueva
y esta documentación (ningún archivo de otras fases tocado). Si en el
futuro se confirma la unidad (por ejemplo, si el propietario obtiene
documentación oficial de Huawei para el modelo `HG8145X6` exacto, o si
otra ONT del mismo modelo expone `X_HW_RSSIUnit` con un valor real), la
pieza que decide mostrar dBm/colores (`tr069HostsSignal.ts` línea 30,
`unit?._value !== 'dBm'`) ya está preparada para activarse sola en cuanto
el equipo declare esa unidad — no haría falta ningún cambio de código.
