# Hosts — señal WiFi + mensajes de error DESPLEGADOS; diagnóstico TR-069 (2026-10-29)

Autorización expresa del propietario: publicar los 3 commits locales
(`ddcf083`, `0b0fc28`, `cee686b`) y desplegar exclusivamente señal WiFi +
mensajes de error. No se repite ningún diagnóstico ya resuelto en sesiones
anteriores (ver `docs/TR069-HOSTS-SENAL-WIFI-*.md`,
`docs/TR069-HOSTS-FALLO-CONSULTA-20261029.md`).

## FASE 1 — GitHub

- `git fetch` + `git merge-base --is-ancestor origin/main main`:
  fast-forward confirmado antes de publicar.
- `git diff --stat 5632edc cee686b`: confirmado que los 3 commits solo
  tocan `CLAUDE.md`/`ESTADO_DESARROLLO.md`, 4 documentos nuevos de Hosts,
  evidencia JSON, y el código+pruebas de señal WiFi/mensajes de error
  (`tr069Hosts.ts`, `tr069HostsSignal.ts`, `tr069HostsPanel.ts`,
  `Tr069View.vue` y sus pruebas) — ningún archivo de otras fases.
- `git push origin main`: normal, sin force/merge/rebase.
  `00f012b..` → `5632edc..cee686b` (fast-forward).
- Confirmado: `main` local y `origin/main` coinciden en **`cee686b`**.

## FASE 2 — Despliegue

### Antes de tocar nada
VM: backend/frontend `...eb96f77b7dca`, igual a lo documentado;
Caddy/Mongo/GenieACS sin cambios desde su último arranque.

### Alcance declarado (`deploy/consolidation-release-scope.json`)
`sourceCommit: cee686b`; `backendSources`: `tr069Hosts.ts`,
`tr069HostsSignal.ts`; `frontendSources`: `tr069Hosts.ts` (lib),
`tr069HostsPanel.ts`, `Tr069View.vue` + sus 2 pruebas;
`frontendAssets`: `Tr069View.js` (se declaró también `tr069.js` por
precaución; el build real confirmó que no era necesario — solo
`Tr069View.js` cambió de verdad).

### Pruebas focalizadas (antes de `prepare`)
`test:provisioning` **330/330 PASS**, `test:fetch-timeout` **501/501
PASS**, `tsc`/`vue-tsc` limpios — mismos resultados ya reportados, solo
reconfirmados antes de construir.

### 4 fases, resultado real
- **`prepare`**: `{"prepared":true,"rollbackTested":true,...}` — respaldo
  fresco de `...eb96f77b7dca` (ambos servicios).
- **`build`**: `{"built":true,"reproducible":true,
  "contractGuardValidatedReadOnly":true,"artifactCount":126,
  "frontendChangedAssets":["assets/Tr069View.js"],"servicesChanged":false}`
  — exactamente lo declarado, nada inesperado.
- **`deploy`** (2026-10-29T20:46:23Z): 126 artefactos, 11 rutas
  (`/`, `/tr069`, `/asistencia`, `/campo`, `/campo/mi-custodia`, `/puntos`,
  `/soporte`, `/mikrotik`, `/analitica`, `/rutinas`, `/olt`) — todas
  responden, confirma preservación de los demás módulos (punto 5).
  `401` sin autenticación, `ssidTasksSent:0`.
- **`verify`**: idéntico a `deploy`.

### Imágenes — antes/después

| Servicio | Antes | Después |
|---|---|---|
| Backend | `smartrayco-backend-wifitrial:eb96f77b7dca` (`sha256:442fa457...`) | `smartrayco-backend-wifitrial:cee686b673c1` (`sha256:f0721944...`) |
| Frontend | `smartrayco-frontend-consolidado:eb96f77b7dca` (`sha256:8a34d94e...`) | `smartrayco-frontend-consolidado:cee686b673c1` (`sha256:39750085...`) |

### Confirmaciones en vivo (solo lectura)
- `docker ps`: ambos servicios `...cee686b673c1`, sanos; Caddy/Mongo/
  GenieACS con el mismo contenedor y arranque de antes del deploy.
- `GET /api/health`: `{"status":"ok"}`.
- **Punto 6 (RSSI solo con identidad/firmware verificados)**: confirmado
  leyendo el código REAL dentro del contenedor desplegado —
  `VERIFIED_X_HW_RSSI_DBM_FIRMWARE` contiene exactamente la única
  combinación verificada (`00259E`/`HG8145X6-13`/`V5R023C00S342`); ninguna
  otra identidad quedó habilitada.
- **Punto 7 (sin polling, sin tareas de configuración)**: cola de
  GenieACS (`GET /tasks`) tenía 1 tarea `refreshObject` en
  `InternetGatewayDevice.DeviceInfo`, creada **20:41:42 UTC — antes** de
  que este despliegue empezara (20:46:08 UTC); no la generó nuestro
  código ni el despliegue (ver Fase 3). Gate `TR069_HOSTS_ON_DEMAND_ENABLED`
  sin cambios, serial único `HWTC1D3691B7`.
- Rollback preparado y probado (`rollbackTested:true`), restaura a
  `...eb96f77b7dca`; no se ejecutó.

## FASE 3 — Comunicación TR-069 (solo lectura, sin cambios, sin forzar nada)

### 1-2. Último Inform e identidad
```
Reloj del servidor: 2026-10-29T20:47:36 UTC
_lastInform:   2026-10-29T20:11:52.625Z   (36 min sin cambiar, confirmado
                                            con 2 lecturas independientes
                                            separadas ~17 min entre sí)
_lastBoot:     2026-10-29T17:04:18.304Z   (el propio equipo reportó un
                                            reinicio ~3.7 h antes)
_lastBootstrap:2026-10-27T19:45:10.542Z
_registered:   2026-10-27T19:45:10.542Z
_deviceId:     Huawei Technologies Co., Ltd / OUI 00259E /
               ProductClass HG8145X6-13 / Serial 485754431D3691B7
```
**El equipo sigue registrado en GenieACS con identidad correcta y
completa** — coincide exactamente con la Huawei validada. No es un
problema de identidad.

### 3. Tareas y registros
Una sola tarea pendiente, sin fault asociado:
```json
{"_id":"6ae3af8646fe832efbe32759","name":"refreshObject",
 "objectName":"InternetGatewayDevice.DeviceInfo",
 "device":"00259E-HG8145X6%2D13-485754431D3691B7",
 "timestamp":"2026-10-29T20:41:42.369Z"}
```
Esta tarea **no la generó el código de Hosts** (que solo envía
`getParameterValues`, nunca `refreshObject`) ni este despliegue. Rastreada
a `server/src/services/tr069DeviceService.ts` (`queueRefresh`), expuesta
en `POST /genieacs-sync/refresh/:serial` — el botón "Actualizar" de la
tarjeta general del equipo TR-069 (`refreshDeviceMetrics` en
`Tr069View.vue`), **distinto del botón "Actualizar" de Hosts**. Alguien
con permiso de escritura (ADMIN/SUPERADMIN/TECNICO_RED) la disparó a las
20:41:42 UTC — consistente con que el propietario haya probado ese botón
general al notar el problema. Sigue pendiente 6+ minutos después, sin
fault: el `connection_request` no obtuvo respuesta del equipo (el propio
código ya documenta que esto "puede fallar silenciosamente" si el ACS no
tiene ruta hacia el CPE).

### 4. Causa confirmada vs. hipótesis pendiente
**Confirmado con evidencia real:** el equipo no envía un Inform nuevo
desde las 20:11:52 UTC (36+ minutos, dos lecturas independientes) y un
intento de contactarlo activamente (`connection_request`) tampoco obtuvo
respuesta en 6+ minutos. GenieACS mismo está sano (`healthy`, sin errores,
responde normal a todas las consultas de caché). **Esto no es un defecto
de SmartRayco** — es ausencia real de comunicación con el equipo físico.

**Hipótesis pendiente (no verificable desde este código — SmartOLT es un
sistema externo que no administramos aquí):** el propietario reportó haber
desactivado TR-069 en SmartOLT "hace ~5 minutos" relativo a su mensaje,
cerca en el tiempo de la tarea de las 20:41:42 UTC. Si "desactivar TR-069"
en SmartOLT retira o cambia la asignación de ACS/perfil de gestión de esta
ONT a nivel de OLT, el equipo dejaría de poder alcanzar GenieACS por
completo — explicando a la vez la ausencia de Inform y el
`connection_request` sin respuesta. **No se puede confirmar ni descartar
desde SmartRayco**: SmartOLT no es parte de este código ni de esta VM.

### 5. Qué revisar en la configuración ACS de la Huawei (solo diagnóstico, NO ejecutado)
1. En SmartOLT: confirmar si el perfil/asignación de gestión TR-069 de
   esta ONT (`HWTC1D3691B7` / `485754431D3691B7`) sigue activo o fue
   retirado — si se desactivó a propósito, los síntomas aquí son
   exactamente los esperados y no requieren ninguna corrección en
   SmartRayco.
2. Si debía seguir activo: confirmar que la VLAN de gestión OMCI
   (documentada antes como VLAN 200 / `10.15.15.200`) sigue aplicada a
   esta ONT y que su ruta hacia el host de GenieACS no cambió.
3. Confirmar, por el panel/consola de la propia Huawei (si es accesible
   físicamente), que `ManagementServer.URL` sigue apuntando al GenieACS
   correcto — un cambio de esa URL explicaría la pérdida total de Informs.
4. Confirmar en la OLT (no en TR-069) que la ONT sigue óptica/físicamente
   en línea — si el problema fuera de capa óptica, tampoco sería un
   asunto de TR-069/SmartRayco.

### 6. Nada forzado
No se envió ningún `connection_request`/tarea nueva desde esta sesión, no
se canceló la tarea pendiente ya existente, no se reinició el equipo ni se
tocó su configuración. Todas las lecturas de esta fase fueron `GET`
puros o lectura directa de colecciones (`tasks`, `faults`), nunca `POST`.

## Entrega

- **Commit final en GitHub:** `cee686b` (confirmado en `origin/main`).
- **Imágenes:** ver tabla arriba (antes `eb96f77b7dca`, después
  `cee686b673c1`, ambos servicios).
- **Pruebas:** 330/330 backend, 501/501 frontend-lib, 31/31 contrato,
  `tsc`/`vue-tsc` limpios (reconfirmados antes de construir).
- **Rollback:** preparado y probado, no ejecutado (no fue necesario).
- **Estado real de comunicación de la Huawei:** registrada, identidad
  correcta; **sin Inform desde hace 36+ minutos**; un intento de
  `connection_request` externo a nuestro código tampoco obtuvo respuesta.
- **Último Inform recibido:** `2026-10-29T20:11:52.625Z`.
- **Causa:** confirmada como ausencia real de comunicación con el equipo
  (no un defecto de SmartRayco); la relación con la desactivación de
  TR-069 en SmartOLT es una hipótesis razonable y cronológicamente
  compatible, pero no verificable desde este código.
- **Estado final de sincronización:** `main` local = `origin/main` =
  `cee686b`; VM corriendo exactamente ese commit en backend y frontend.
