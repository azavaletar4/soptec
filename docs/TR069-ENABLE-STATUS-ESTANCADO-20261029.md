# Ficha OLT atascada en "Esperando conexión" — diagnóstico y corrección (2026-10-29)

Continuación directa de las investigaciones TR-069 ya documentadas (último
estado real: `olt_onts.tr069_enabled=false` para `HWTC1D3691B7`, no se
repite ese diagnóstico). Esta tarea es sobre un problema DISTINTO: cuando
TR-069 SÍ estuvo habilitado y GenieACS SÍ llegó a registrar el equipo, la
ficha OLT seguía mostrando "Esperando conexión" como si nunca hubiera
pasado nada.

## FASE 1 — Qué hace exactamente "Administrar TR-069" / habilitar TR-069

Dos rutas en `server/src/routes/olt.ts` ejecutan el mismo y único comando
de escritura (`setTr069AcsCommands`, en `server/src/ssh/zteCommands.ts`):
`POST /:id/onts/:ontDbId/tr069` (manual, URL a mano) y
`POST /:id/onts/:ontDbId/tr069/enable-guided` (botón guiado, siempre usa el
perfil ACS por defecto de la OLT, con reverificación de identidad EN VIVO
antes de escribir — `fullRunningConfigCommand`/`verifyLivePosition`).

**El único comando real enviado a la OLT (ZTE C300, vía Telnet):**
```
enable
configure terminal
pon-onu-mng gpon-onu_{shelf}/{slot}/{port}:{ont_id}
  tr069-mgmt {veip} acs <url>
  tr069-mgmt {veip} state unlock
exit
```
- **VLAN:** ninguna — este comando no toca VLAN alguna.
- **WAN:** ninguna — no es un objeto `wan-ip`, es el objeto OMCI
  `tr069-mgmt` dentro de `pon-onu-mng`, exclusivo de la gestión TR-069.
- **Perfil:** el perfil ACS por defecto de `olt_tr069_acs_profiles`
  (`acs_url`) en el flujo guiado; en el flujo manual, la URL que se
  escriba en el formulario.
- **Parámetros:** `veip` (casi siempre `1`, una sola interfaz virtual de
  gestión por ONU) y la URL del ACS, saneada por `sanitizeAcsUrl`.

**Demostración de que no toca PPPoE/WAN de Internet/VLAN 120/credenciales:**
- `configureWanPppoeCommands()` (PPPoE/WAN real) es una función **completamente
  separada**, con sus propios comandos (`wan-ip`, usuario/contraseña
  PPPoE) — **nunca** se invoca desde `setTr069AcsCommands`,
  `enable-guided` ni el modal manual de TR-069.
- El comentario original del propio código (línea 1314 de `olt.ts`) ya lo
  declara: *"No toca service-port/VLAN/PPPoE de esta ni de ninguna otra
  ONT: el único comando que se ejecuta es `setTr069AcsCommands()`"* —
  confirmado leyendo el código real, no asumido.
- `disableTr069Commands()` (el botón para desactivar) es igual de acotado:
  solo `tr069-mgmt {veip} state lock`, sin tocar nada más.

**Riesgo para la navegación:** no se encontró ninguno. El objeto OMCI que
se escribe es independiente del objeto WAN/PPPoE que da servicio de
Internet — es la misma separación que ya permitió, en sesiones
anteriores, cambiar el SSID de WiFi por TR-069 sin afectar la navegación
del cliente real. No hay motivo para detenerse por riesgo; el motivo para
NO ejecutar todavía es exclusivamente la restricción explícita de esta
tarea ("no ejecutar todavía la habilitación").

## FASE 2 — Corrección local del estado mostrado

### Causa real del "Esperando conexión" permanente

`src/lib/tr069EnableStatus.ts` (`deriveTr069EnableStatus`) mezclaba dos
situaciones muy distintas bajo la MISMA etiqueta `esperando_conexion`:
1. El equipo **nunca** contactó a GenieACS (no hay fila en `tr069_devices`
   con ese serial).
2. El equipo **sí** contactó alguna vez (hay fila con `last_seen_at` real)
   pero ese contacto ya es viejo (más de 30 min).

Antes de esta corrección, el caso (2) — que es EXACTAMENTE lo que pasó:
GenieACS llegó a registrar la Huawei — se presentaba igual que el caso
(1), como si nunca hubiera pasado nada. Para el administrador, "Esperando
conexión" sugiere "todavía no pasó nada", cuando en realidad SÍ hubo
contacto confirmado y luego se perdió — información relevante que se
estaba ocultando.

### Corrección aplicada

Nuevos estados en `Tr069EnableStatus` (antes: 5 estados; ahora: 7):
`no_habilitado`, `habilitando`, **`configurado`** (nuevo),
`esperando_conexion`, `conectado`, **`sin_comunicacion_reciente`** (nuevo),
`error`.

```ts
if (input.matchedDevice?.last_seen_at) {
  const age = input.nowMs - Date.parse(input.matchedDevice.last_seen_at);
  return age <= staleAfter ? 'conectado' : 'sin_comunicacion_reciente'; // antes: 'esperando_conexion'
}
if (input.enabledAt) {
  const sinceEnabled = input.nowMs - Date.parse(input.enabledAt);
  if (sinceEnabled > firstContactGrace) return 'esperando_conexion';
}
return 'configurado'; // nuevo: recien habilitado, sin match, dentro del margen normal
```

- **"Configurado"** (nuevo): TR-069 habilitado, ningún contacto todavía,
  pero dentro de un margen normal de espera (10 min — mismo margen ya
  usado para el guard de "sin comunicación reciente" de Hosts, reutilizado
  aquí por consistencia, no un número nuevo inventado).
- **"Esperando conexión"**: igual que antes, pero ahora reservado
  EXCLUSIVAMENTE para "nunca hubo contacto" — y solo después de superar el
  margen de 10 minutos desde que se habilitó (antes de eso, es
  "Configurado").
- **"Conectado a GenieACS"** (texto explícito, pedido en la tarea): igual
  que antes — identidad exacta + Inform dentro de los últimos 30 min.
- **"Sin comunicación reciente"** (nuevo): hubo contacto confirmado
  alguna vez, pero el último es viejo (más de 30 min) — ya NO se confunde
  con "nunca contactó". `canManageTr069` sigue exigiendo exactamente
  `'conectado'` — un contacto viejo tampoco habilita "Administrar TR-069".

**Nunca se declara conectado por registro histórico o identidad
ambigua** (punto explícito de la tarea): sin cambios ahí — `matchedDevice`
sigue viniendo de `matchTr069Device` (ya existente, rechaza coincidencias
ambiguas) y una fecha de Inform inválida/no parseable nunca resuelve a
`'conectado'` (probado explícitamente).

**Tareas pendientes de GenieACS vs. ausencia de conexión:** esta máquina
de estados **nunca recibió ni recibe** ningún dato sobre tareas pendientes
de GenieACS — es un concepto exclusivo de Hosts (`tr069HostsOnDemand.ts`,
archivo y preocupación completamente distintos). No había nada que
"confundir" porque nunca se mezclaron; se agregó una prueba explícita que
lo deja documentado para que no se mezclen en el futuro.

**Sin indicadores de carga indefinidos / sin polling permanente:** el
sondeo acotado que ya existía (hasta 12 intentos de 15 s ≈ 3 min, solo
mientras no hay contacto o se está habilitando) se mantiene igual de
acotado — se generalizó su condición de continuación a un helper
(`shouldKeepPollingTr069`) que ahora también cubre el nuevo estado
"Configurado" (con el mismo criterio que antes), pero **excluye
explícitamente** "Sin comunicación reciente": ese estado ya tuvo su
oportunidad de conectar; no se vuelve a sondear solo por abrir la ficha.

## FASE 3 — Pruebas

`src/lib/__tests__/tr069EnableStatus.test.ts`: reescrito y ampliado a
**16 pruebas** (antes 6): habilitando, error, no habilitado, configurado
(con y sin `enabledAt` conocido), límite exacto de 10 min
(configurado→esperando_conexion), conectado, **sin_comunicacion_reciente**
(incluido el caso real exacto reportado: match de hace horas, antes
indistinguible de "nunca contactó"), límite exacto de 30 min
(conectado→sin_comunicacion_reciente), umbrales configurables, fecha de
Inform inválida, `canManageTr069` con los 7 estados, `shouldKeepPollingTr069`
con los 7 estados, y la prueba explícita de que el input nunca incluye
tareas pendientes de GenieACS.

Resultado: `npm run test:fetch-timeout` **510/510 PASS** (antes 501, +9);
`npm run test:provisioning` **336/336 PASS** (sin cambios — esta
corrección es 100% frontend, no se tocó nada de backend/OLT/PPPoE);
`npx vue-tsc -p tsconfig.app.json --noEmit` limpio. Único otro archivo
modificado: `src/views/olt/OntDetailModal.vue` (usa los nuevos campos/
helper, agrega 2 colores de badge) — sin cambios de lógica de negocio,
solo presentación.

## ¿Es seguro habilitar TR-069 para esta Huawei ahora?

**Sí, basado en la revisión de código de la Fase 1** — el comando es
idéntico al que ya se usó antes para esta misma Huawei sin incidentes
(confirmado en sesiones anteriores: SSID cambiado por TR-069 sin afectar
PPPoE), y no toca ningún objeto WAN/VLAN/PPPoE/credenciales. **No se
ejecutó** en esta tarea, por restricción explícita.

**Autorización operativa concreta que se necesitaría** para proceder (en
un turno aparte, con el pedido explícito del propietario en ese mismo
turno — regla 16 de `CLAUDE.md`):
1. Confirmación expresa de ejecutar `POST .../tr069/enable-guided` (o el
   botón "Habilitar TR-069" del panel) para `HWTC1D3691B7` — esto re-aplica
   `tr069-mgmt acs <url>` + `state unlock` y vuelve a poner
   `tr069_enabled=true`/`tr069_acs_url` en `olt_onts`.
2. Nada adicional: no requiere tocar WAN-IP, VLAN, PPPoE ni credenciales
   — ya confirmado que ese comando es autosuficiente para la gestión
   TR-069 de esta ONT.
3. Verificación posterior recomendada (solo lectura, ya disponible): tras
   habilitar, esperar un Inform real y confirmar con la ficha OLT que
   pasa a "Conectado a GenieACS" — con esta corrección, si vuelve a
   perder comunicación más adelante, se verá como "Sin comunicación
   reciente" en vez de confundirse con "nunca contactó".

## Archivos modificados

- `src/lib/tr069EnableStatus.ts`
- `src/lib/__tests__/tr069EnableStatus.test.ts`
- `src/views/olt/OntDetailModal.vue`
- Este documento.

Ningún archivo de otras fases tocado. Sin cambios a OLT (código Telnet),
PPPoE, WAN, VLAN, credenciales, GenieACS ni ONT real. Sin migraciones.
**Sin push ni despliegue** — commit local únicamente.
