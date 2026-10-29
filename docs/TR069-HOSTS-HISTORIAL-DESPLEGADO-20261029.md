# TR-069 Hosts — corrección de historial DESPLEGADA en producción (2026-10-29)

Autorización expresa del propietario: "Autorizo publicar y desplegar
exclusivamente la corrección de historial Hosts del commit 4cf4ae8."
Causa/diseño ya investigados y documentados en
`docs/TR069-HOSTS-HISTORIAL-20261029.md` — no se repite ese diagnóstico.

## 1. Verificación previa (antes de tocar nada)

- `git show --stat 4cf4ae8`: confirmado que el commit solo toca los 10
  archivos de la corrección (código + pruebas + documentación de Hosts),
  nada de Asistencia/Puntos/Campo/OLT/Rutinas/WiFi.
- `git status`: los archivos pendientes de otras fases (Fase 175, Puntos,
  Asistencia, `docs/INVENTARIO-PRODUCCION-IMAGENES.json`) siguen
  intactos, sin incluir en ningún commit de esta tarea.
- `git fetch` + `git merge-base --is-ancestor origin/main main`:
  fast-forward confirmado, sin divergencia, antes de cada push.
- VM en vivo antes del despliegue: backend y frontend
  `...:ac511d7c70c8` (igual a lo documentado), Caddy/Mongo/GenieACS sin
  cambios desde su último arranque.

## 2. Publicación en GitHub

Tres commits publicados con `git push origin main` normal (sin
force/merge/rebase), cada uno verificado fast-forward antes de empujar:

| Commit | Contenido |
|---|---|
| `4cf4ae8` | Corrección real de historial Hosts (autorizada) |
| `eb96f77` | Ajuste de clases Tailwind (evitar `HISTORICAL_ASSETS_CHANGED` real, ver abajo) |
| (este) | Documentación final de despliegue + `deploy/consolidation-release-scope.json` |

`main` local y `origin/main` coinciden en cada paso (verificado con
`git rev-parse main origin/main` después de cada push).

## 3. Hallazgo real durante `build` — corregido antes de desplegar

El primer `build` falló con `HISTORICAL_ASSETS_CHANGED:assets/index.css`:
el toggle "Todos"/"Conectados" usaba `bg-slate-700`/`border-slate-700`,
clases Tailwind **nunca usadas antes en el proyecto** (confirmado con
`grep` en todo `src/`), lo que generaba un cambio real en el CSS
compilado, no declarado en el alcance. Corregido reutilizando el mismo
patrón ya usado en `MikrotikDetailView.vue` para sus selectores de rango
(`bg-sky-600 text-white` / `bg-slate-100 text-slate-600
hover:bg-slate-200` — confirmado con `grep` que esas clases ya estaban en
uso en el proyecto, cero CSS nuevo). Commit `eb96f77`. Reconstruido desde
cero: `build` pasó limpio, `frontendChangedAssets` exactamente
`["assets/Tr069View.js"]` como se esperaba.

## 4. Alcance declarado (`deploy/consolidation-release-scope.json`)

```json
{
  "sourceCommit": "eb96f77b7dca389bb7ddbf416f09be4008cda3e1",
  "backendSources": [
    "server/src/routes/genieacsSync.ts",
    "server/src/services/tr069HostsOnDemand.ts",
    "server/src/services/tr069HostsHistory.ts"
  ],
  "frontendSources": [
    "src/lib/__tests__/tr069HostsView.test.ts",
    "src/views/tr069/Tr069View.vue"
  ],
  "frontendAssets": ["assets/Tr069View.js"],
  "backendEnvironment": {
    "TR069_HOSTS_ON_DEMAND_ENABLED": "true",
    "TR069_HOSTS_ON_DEMAND_SERIALS": "HWTC1D3691B7"
  }
}
```

Verificado con `git diff --stat ac511d7 eb96f77`: ningún otro archivo de
`src/` o `server/src/` cambia entre la imagen que corría y esta — el
alcance es exacto, no amplía ni oculta nada.

## 5. Pruebas focalizadas (antes de `prepare`)

- `npm run test:provisioning`: **325/325 PASS**.
- `npm run test:fetch-timeout`: **498/498 PASS** (incluye el caso que
  prueba que abrir/cerrar/refrescar sin abrir Hosts no consulta nada).
- `node scripts/tests/consolidation-release-contract.test.cjs`: **31/31 PASS**.
- `npx tsc --noEmit -p tsconfig.server.json` y
  `npx vue-tsc -p tsconfig.app.json --noEmit`: limpios.

## 6. Resultado real de las 4 fases

### `prepare`
```json
{"prepared":true,"rollbackTested":true,
 "backupFiles":{"backend":".../backend-before.image.tar",
                "frontend":".../frontend-before.image.tar"},
 "declaredServices":["backend","frontend"],"servicesChanged":false}
```

### `build`
```json
{"built":true,"reproducible":true,"contractGuardValidatedReadOnly":true,
 "artifactCount":126,
 "frontendChangedAssets":["assets/Tr069View.js"],
 "frontendImage":"sha256:8a34d94ea936dc0f2431ece8261104c29d3789d9a9d3b54787e0793d88c98b32",
 "backendImage":"sha256:442fa45706d922225cf788c1e9e5a20ec9b145de5e8d591d55d7cd2d65b6bfce",
 "servicesChanged":false}
```

### `deploy` (2026-10-29T19:40:21.606Z)
Backend y frontend arrancaron `2026-10-29T19:40:06Z`; Caddy/Mongo/GenieACS
sin tocar (mismo arranque `16:51:49Z` de antes). `artifactsVerified:126`,
11 rutas (`/`, `/tr069`, `/asistencia`, `/campo`, `/campo/mi-custodia`,
`/puntos`, `/soporte`, `/mikrotik`, `/analitica`, `/rutinas`, `/olt`) —
todos los módulos listados responden, confirmando preservación.
`unauthenticatedStatus:401`, `ssidTasksSent:0`.

### `verify` (posterior, lectura)
Mismo resultado que `deploy`.

## 7. Confirmaciones adicionales en vivo (solo lectura)

- `docker ps`: `smartrayco-frontend-1`/`smartrayco-backend-1` con tag
  `...:eb96f77b7dca`, sanos; Caddy/Mongo/GenieACS con el mismo contenedor
  y arranque de antes del deploy.
- `GET /api/health`: `{"status":"ok"}`.
- Código desplegado confirmado dentro del contenedor real:
  `server/src/services/tr069HostsHistory.ts` presente, y
  `applyHostsHistory` referenciado en `genieacsSync.ts` y
  `tr069HostsOnDemand.ts` (2 ocurrencias cada uno) — la corrección real
  está en el contenedor que corre, no solo en el repositorio.
- `printenv` del backend (solo esas 2 claves): gate de Hosts restringido
  exclusivamente a `HWTC1D3691B7`, sin cambios.
- Cola de GenieACS (`GET /tasks`, solo lectura): `[]` — vacía. Ninguna
  tarea de configuración se envió en esta tarea.
- Volumen `olt_telemetry` (Docker named volume, persistente entre
  despliegues) respalda `/var/lib/smartrayco-olt` — el historial de Hosts
  que esta corrección empieza a construir **no se pierde** al reconstruir
  el contenedor backend.

## 8. Historial de Hosts — comportamiento (punto 7 de la tarea)

Sin repetir el diseño ya documentado: un host ausente del árbol en vivo del
CPE se conserva visible con su **última lectura real tal cual** (nunca se
le asigna un valor nuevo de conexión/estado); las funciones ya existentes
`hostStatusLabel`/`hostConnectionLabel` (sin cambios en esta corrección)
resuelven solas a **"Sin confirmar"** en cuanto esos datos superan los 10
minutos de vigencia — nunca se declara "Conectado" ni "Desconectado" sin
una lectura reciente real. Verificado con la suite de pruebas (punto 5) que
reproduce exactamente este escenario con los 5 Hosts reales de la
evidencia del 28/10.

## 9. Sin polling (punto 8 de la tarea)

Sin cambios en el mecanismo de consulta: Hosts solo se consulta al abrir
su sección o pulsar "Actualizar" (confirmado por la prueba frontend
`render de Hosts cerrado no contiene tabla, datos o botón de consulta ni
ejecuta peticiones` y la prueba de apertura/cierre del panel, ambas sin
modificar). Ninguna tarea TR-069 nueva se envió durante esta tarea
(cola GenieACS vacía antes y después, verificado en el punto 7).

## 10. Rollback disponible (no ejecutado)

```
node scripts/frontend-consolidation-release.cjs rollback
```
Restaura backend y frontend a `...:ac511d7c70c8` (las imágenes que
corrían justo antes de este despliegue), respaldadas en
`/opt/smartrayco-staging/frontend-consolidado-tr069-eb96f77-040b6dbcfc/`.

## 11. Imágenes — antes/después

| Servicio | Antes | Después |
|---|---|---|
| Backend | `smartrayco-backend-wifitrial:ac511d7c70c8` (`sha256:a83fcef6...`) | `smartrayco-backend-wifitrial:eb96f77b7dca` (`sha256:442fa457...`) |
| Frontend | `smartrayco-frontend-consolidado:ac511d7c70c8` (`sha256:1f2c7b2c...`) | `smartrayco-frontend-consolidado:eb96f77b7dca` (`sha256:8a34d94e...`) |

## 12. Pendiente

Validación visual del panel — la realiza el propietario directamente,
fuera de esta tarea. Ninguna lectura activa de Hosts contra la Huawei real
se ejecutó en esta tarea (ni falta hacerla: la corrección es de
presentación/memoria local, no de lectura TR-069).
