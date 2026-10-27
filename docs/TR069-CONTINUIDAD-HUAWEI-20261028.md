# Continuidad TR-069 Huawei para Claude Code y Codex — 27/10/2026

## Estado que prevalece

**Comunicación TR-069 real CONFIRMADA** con la ONT de prueba
`HWTC1D3691B7` (1/2/2:24, OLT ZTE C300 real, `10.15.15.2`). La
**corrección de identificación de serial — commit `5104253` en `main`
— está implementada, probada y DESPLEGADA en producción** (2026-10-27
~20:18 UTC, autorización expresa): backend
`smartrayco-backend-tr069fix:5104253-20261027T201808Z`. Verificado con
el código real desplegado y datos reales de Supabase que ya resuelve
la identidad correctamente. El propietario confirmó al retomar desde Claude
«TR-069: Conectado», «Administrar TR-069» habilitado y el equipo en línea en
GenieACS. La comprobación visual está completada; modificar WiFi desde
SmartRayco sigue sin probarse. Esta actualización registra su confirmación,
sin nuevas consultas ni cambios en producción.

## 1. Interfaz de gestión OMCI independiente — operativa

Aplicada en 3 bloques pequeños, cada uno verificado antes de continuar
(ver `docs/TR069-HUAWEI-PRUEBA-REAL-PREPARACION-FINAL.md` para el
procedimiento exacto y `docs/TR069-GESTION-INDEPENDIENTE-HUAWEI.md` para
el diseño/código):

- VLAN de gestión dedicada: 200.
- IP de gestión: `10.15.15.200` (verificada libre dos veces antes de
  asignar; gateway `10.15.15.1`, DNS `8.8.8.8`/`8.8.4.4`).
- `tcont 1`/`gemport 1`/`service-port 1` (Internet, VLAN 120) — **sin
  tocar**, confirmado por lectura antes/durante/después.
- Patrón idéntico al de 6 Huawei GPT-2741GNAC reales ya configuradas en
  esta misma OLT (apuntando al ACS de la antigua plataforma SmartOLT,
  `10.69.69.1` — no a GenieACS; esta prueba es la primera vez que se usa
  este patrón apuntando a GenieACS).

**GenieACS recibió 3 Informs reales**: Inform inicial (`4 VALUE CHANGE`)
+ 2 periódicos (`2 PERIODIC`, cada 300s), sin ningún hueco. Evidencia
(log CWMP, resumen del dispositivo) conservada en
`docs/backups/hwtc1d3691b7-cwmp-log-20261027.txt` y
`docs/backups/hwtc1d3691b7-genieacs-summary-20261027.json`.

## 2. Incidente de internet — recuperado, sin causa definitiva

Durante la prueba, el propietario reportó pérdida de ping a `8.8.8.8` en
el equipo de prueba. Se verificó **solo lectura** (sin ejecutar ninguna
reversión): sesión PPPoE real con uptime continuo (nunca se reinició),
`running-config` de la OLT idéntico al respaldo previo en todas las
lecturas, y los 3 Informs de GenieACS sin ningún hueco durante la
ventana del incidente. El internet volvió al reconectar el cable de red
del **equipo de prueba** (no el WAN de la Huawei). **No se declara causa
confirmada** — la hipótesis mejor respaldada por la evidencia es un
problema del lado del cable/NIC del equipo de prueba, no de TR-069 ni de
la OLT. Detalle completo:
`docs/TR069-HUAWEI-INCIDENTE-Y-RECUPERACION-20261027.md`.

## 3. Diferencia de representación del serial GPON

- OLT (ZTE C300): `HWTC1D3691B7` (4 ASCII + 8 hex, ITU-T G.984.3).
- GenieACS/TR-069 (esta Huawei): `485754431D3691B7` (16 hex — el vendor
  ID también hex-codificado: `48575443` decodifica byte a byte a
  `H`,`W`,`T`,`C`).
- **Es el mismo serial de 8 bytes**, otra representación — no un dato
  distinto, no dos equipos distintos.

## 4. Corrección — commit local `5104253`

- Nuevo `src/lib/gponSerial.ts`: `normalizeGponSerial`,
  `gponSerialsMatch`, `matchTr069Device`. Comparación EXACTA del serial
  normalizado completo — nunca parcial, nunca por substring. Serial
  inválido, sin coincidencia, o coincidencia ambigua →
  **nunca vincula automáticamente**.
- `src/lib/gponVendorId.ts`: `gponVendorFromSerial` normaliza antes de
  leer el prefijo de fabricante.
- `server/src/routes/olt.ts`, 2 consumidores corregidos (ambos
  comparaban serial literal, mismo problema): `GET
  /:id/onts/:ontDbId/tr069/status` (botón "Habilitar TR-069" guiado) y
  `GET /onts/status` (panel genérico `Tr069View.vue`).
- Compatibilidad con ZTE y formatos ya canónicos conservada sin cambios
  (passthrough). Detalle: `docs/TR069-IDENTIFICACION-SERIAL-HUAWEI-CORREGIDA.md`.

## 5. Pruebas aprobadas

26 pruebas nuevas (Huawei real, ZTE, inválido, ambiguo, null/vacío) —
todas en verde. `tsc` backend y frontend limpios. 452 pruebas de
`src/lib/__tests__` y 247 de `server/src/services/__tests__`
existentes, sin regresión. Verificado también con los datos REALES de
Supabase (solo lectura, nada escrito en OLT/ONT/MikroTik):
`matchTr069Device('HWTC1D3691B7', [...])` encuentra el dispositivo real
y `deriveTr069EnableStatus(...)` ya deriva `'conectado'` con el
`last_seen_at` real.

## 6. Estado preciso (actualizado tras el despliegue, 20:18 UTC)

| | Estado |
|---|---|
| TR-069 conectado con la Huawei real | **Confirmado** (3 Informs reales) |
| Corrección de identificación de serial | **Implementada, probada y DESPLEGADA** |
| Imagen activa | `smartrayco-backend-tr069fix:5104253-20261027T201808Z` |
| Frontend | Sin cambios (el commit no lo requiere) |
| Verificación con código real + datos reales | `matchTr069Device` ya resuelve `HWTC1D3691B7` ↔ `485754431D3691B7` |
| Rollback | Preparado (imagen anterior respaldada, SHA256), no usado |
| Comprobación visual en el panel | **Confirmada por el propietario:** «TR-069: Conectado» y «Administrar TR-069» habilitado |
| Pantalla GenieACS | Equipo en línea, confirmado por el propietario |
| Modificar WiFi desde SmartRayco | **No probado todavía** |

## 7. Pendiente

Validación visual posterior local completada, sin tareas ni producción: 9 capturas
de simulación, formulario real en escritorio/móvil, respaldo descargado y roles.
Banda desconocida cuando falta evidencia; nuevo Inform y fecha SSID nueva para
comparar. Aplicar/revertir siguen bloqueados. Ver
[TR069-WIFI-VALIDACION-VISUAL-20261027.md](TR069-WIFI-VALIDACION-VISUAL-20261027.md).

Preparación WiFi posterior implementada solo local, sin tareas ni despliegue:
formulario de un SSID, identidad exacta, Enable desconocido visible, preparación
ADMIN/SUPERADMIN para la Huawei de prueba, respaldo y comparación GET. Escrituras
WiFi/PPPoE/provision/proxy bloqueadas; falta vía de aplicar/revertir autorizada y
prueba física. Detalle: [TR069-WIFI-PREPARACION-SEGURA-20261027.md](TR069-WIFI-PREPARACION-SEGURA-20261027.md).

Diagnóstico posterior de administración, solo lectura (27/10): árbol cacheado
`InternetGatewayDevice`, WLAN 1/5 con SSID y KeyPassphrase; Enable/seguridad/bandas
sin valores, WANPPPConnection anunciado sin instancia legible. Escritura no
probada. Preparar guardas locales antes de la primera prueba; detalles y
evidencia en [TR069-ADMINISTRACION-HUAWEI-SOLO-LECTURA-20261027.md](TR069-ADMINISTRACION-HUAWEI-SOLO-LECTURA-20261027.md).

1. Autorizar una prueba controlada aparte de modificación de WiFi desde
   SmartRayco en `HWTC1D3691B7`, acordando el cambio y su reversión.
2. En esa futura prueba, comprobar que el cambio se aplica realmente y que
   internet/PPPoE continúan funcionando. Todavía no intentada ni autorizada;
   el estado conectado y el botón habilitado no acreditan escritura WiFi.

## Commits

En `main` (locales, ver nota de sincronización): `516faba`, `5a1cfc0`,
`f61f771`, `877bec6`, `94d447e`, `5104253`, `83f06b4` (continuidad),
más el commit documental de esta actualización. En
`diagnostico/tr069-genieacs-readonly` (rama de producción real, ya
desplegada): `0480b3a`/`2974cd6` (botón guiado) y `7105679`/`8968e69`
(corrección de serial).

## Nota de sincronización con GitHub

`origin/main` divergió de la base de estos commits (4 commits propios de
Campo/devoluciones ya en `origin/main` que este `main` local no tenía:
`c11f6a8`, `6a8dadd`, `911c01d`, `88dec40` — documentales, sin conflicto
de código). Por eso este trabajo se publicó en una rama nueva, nunca
sobre `origin/main` directamente — sin fusionar ni forzar nada. Ver el
commit de esta misma actualización para el nombre exacto de la rama
publicada.

Retoma documental desde Codex (27/10/2026): consulta de referencias de GitHub
en solo lectura confirmó `origin/main` en `88dec40` y la rama remota
`feature/tr069-huawei-gestion-independiente` en `2fedaed` (base local de esta
retoma). Se conserva `main` local, sin fusionar ramas ni sobrescribir cambios
ajenos. La confirmación visual se guarda en un nuevo commit documental local;
su publicación requiere autorización expresa del propietario antes de un push.
La publicación de `1ae1603` fue posteriormente autorizada y completada en
`docs/tr069-continuidad-confirmada-20261027`, sin modificar `origin/main`
(`88dec40`). El diagnóstico de administración posterior se guarda solo local,
sin nuevo push ni merge y sin resolver la divergencia.
