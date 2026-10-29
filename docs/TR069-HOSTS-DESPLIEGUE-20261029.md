# TR-069 Hosts bajo demanda — DESPLEGADO en producción (2026-10-29)

Autorización expresa del propietario: "Autorizo el despliegue exclusivo de
Hosts TR-069 bajo demanda en la VM de producción, siempre que pasen las
verificaciones de seguridad y preservación de módulos." Commit fuente:
`ac511d7c70c8a11700d3553f331af5bb2930926a` (función `e2c7bf7` + guard por
serial `ac511d7`).

## 1. Estado previo verificado (antes de tocar nada)

- GitHub/`main` local sincronizados en `9e90c94`, sin commits pendientes de
  publicar, sin divergencia (`git fetch` + comparación de ambas puntas).
- VM en vivo: backend `smartrayco-backend-wifitrial:d6ce2c2f578f`
  (`sha256:1e6ab34c...`), frontend `smartrayco-frontend-consolidado:5d48a10ea497`
  (`sha256:eaa37bca...`) — coincide exactamente con lo documentado en
  `ESTADO_DESARROLLO.md`. Caddy/Mongo/GenieACS reiniciados por la VM
  (arranque `2026-10-29T16:51:49Z`) pero **mismas imágenes**, sin cambios
  de contenido.

## 2. Alcance del candidato confirmado exclusivo de Hosts

`git diff --stat` del candidato `ac511d7` contra el backend y el frontend
en vivo confirma que los únicos archivos funcionales tocados son:

Backend: `server/src/routes/genieacsSync.ts`,
`server/src/routes/tr069HostsOnDemand.ts`,
`server/src/services/tr069Hosts.ts`,
`server/src/services/tr069HostsOnDemand.ts`,
`server/src/services/tr069HostsSignal.ts` (+ pruebas).
Frontend: `src/lib/tr069Hosts.ts`, `src/lib/tr069HostsPanel.ts`,
`src/stores/tr069.ts`, `src/views/tr069/Tr069View.vue` (+ pruebas).

Ningún archivo de Asistencia, Puntos, Campo, OLT, Rutinas, WiFi, PPPoE, WAN,
VLAN ni MikroTik aparece en el diff. `deploy/consolidation-release-scope.json`
declara exactamente esos archivos de fuente y los dos ajustes de entorno
(`TR069_HOSTS_ON_DEMAND_ENABLED`, `TR069_HOSTS_ON_DEMAND_SERIALS`), nunca
WiFi ni credenciales.

## 3. Pruebas y compilación (antes de preparar nada)

- `npm run test:provisioning` (servicios backend): **318/318 PASS**.
- `npm run test:fetch-timeout` (lib frontend, incluye Hosts): **497/497 PASS**
  — incluye el caso que prueba que abrir/cerrar el panel o refrescar el
  render sin abrir Hosts **no** dispara ninguna consulta, y que solo
  "Actualizar"/apertura explícita la dispara una vez.
- `node scripts/tests/consolidation-release-contract.test.cjs`: **31/31 PASS**.
- `npx tsc --noEmit -p tsconfig.server.json`: limpio.
- `npx vue-tsc -p tsconfig.app.json --noEmit`: limpio.

## 4. Hallazgo durante `build` — resuelto sin tocar código de la app

El primer intento de `build` (reutilizando un `prepare` ya hecho en la
sesión del 28/10) falló con `SERVICE_DRIFT_frontend`: la VM se reinició
entre sesiones, así que el contenedor en vivo tiene un `Id`/`StartedAt`
nuevo aunque la **imagen** es idéntica (mismo sha256). El control de drift
de `frontend-consolidation-release.py` (`unchanged()`) compara también
`Id`/`StartedAt`, no solo la imagen — correctamente, exige que el respaldo
describa el contenedor exacto que corre ahora antes de construir sobre él.

No se modificó el script ni se relajó el control. Se movió (no se borró)
el directorio de staging de la sesión anterior
(`/opt/smartrayco-staging/frontend-consolidado-tr069-ac511d7-25b428d7a4` →
`...-superseded-20261029-pre-restart`, `mv` simple, solo área de staging,
ningún contenedor ni dato de cliente) y se ejecutó `prepare` de nuevo,
limpio, contra el estado real actual. `build` pasó después sin más cambios.

## 5. Resultado real de las 4 fases

### `prepare`
```json
{"prepared":true,"rollbackTested":true,
 "backupFiles":{"backend":".../backend-before.image.tar",
                "frontend":".../frontend-before.image.tar"},
 "sourceCommit":"ac511d7c70c8a11700d3553f331af5bb2930926a",
 "declaredServices":["backend","frontend"],"servicesChanged":false}
```

### `build`
```json
{"built":true,"reproducible":true,"contractGuardValidatedReadOnly":true,
 "artifactCount":126,
 "frontendChangedAssets":["assets/Tr069View.js","assets/tr069.js"],
 "frontendImage":"sha256:1f2c7b2c0be5e6f7aabc6d5074d3923cf5006bde9bb77aa976764e719ef5ab12",
 "backendImage":"sha256:a83fcef6c57c4bd71ce9b22b34978822d47f83323de21ba76c31fd64af172725",
 "servicesChanged":false}
```

### `deploy` (2026-10-29T18:45:53.879Z)
```json
{"validation":{"routes":["/","/tr069","/asistencia","/campo",
  "/campo/mi-custodia","/puntos","/soporte","/mikrotik","/analitica",
  "/rutinas","/olt"],"artifactsVerified":126,
  "servicesChanged":["backend","frontend"],
  "unauthenticatedStatus":401,"ssidTasksSent":0}}
```
Backend y frontend arrancaron `2026-10-29T18:45:39Z`; Caddy/Mongo/GenieACS
sin tocar (mismo arranque `16:51:49Z` de antes del deploy).

### `verify` (posterior, lectura)
Mismo resultado que `deploy`: 126 artefactos, 11 rutas, `401` sin auth,
`ssidTasksSent:0`.

## 6. Confirmaciones adicionales en vivo (solo lectura)

- `docker ps`: `smartrayco-frontend-1` y `smartrayco-backend-1` con tag
  `...:ac511d7c70c8`, `Up` y sanos.
- `GET /api/health`: `{"status":"ok","service":"smartrayco-api"}`.
- `printenv` del backend (solo las 2 claves relevantes, sin volcar el
  entorno completo): `TR069_HOSTS_ON_DEMAND_ENABLED=true`,
  `TR069_HOSTS_ON_DEMAND_SERIALS=HWTC1D3691B7` — exactamente el alcance
  autorizado, ninguna otra Huawei habilitada.
- Cola de GenieACS (`GET /tasks`, solo lectura): `[]` — vacía, cero tareas
  pendientes ni generadas por el despliegue.
- Sin migraciones SQL, sin cambios de configuración de OLT/ONT/MikroTik/
  PPPoE/WAN/VLAN/WiFi en esta tarea.

## 7. Rollback disponible (no ejecutado)

```
node scripts/frontend-consolidation-release.cjs rollback
```
Restaura backend a `smartrayco-backend-wifitrial:d6ce2c2f578f` y frontend a
`smartrayco-frontend-consolidado:5d48a10ea497` desde los `.tar` respaldados
en el `prepare` fresco de este despliegue (no desde el stage superseded).

## 8. Imágenes — antes/después

| Servicio | Antes | Después |
|---|---|---|
| Backend | `smartrayco-backend-wifitrial:d6ce2c2f578f` (`sha256:1e6ab34c...`) | `smartrayco-backend-wifitrial:ac511d7c70c8` (`sha256:a83fcef6...`) |
| Frontend | `smartrayco-frontend-consolidado:5d48a10ea497` (`sha256:eaa37bca...`) | `smartrayco-frontend-consolidado:ac511d7c70c8` (`sha256:1f2c7b2c...`) |

Esta release **sí es un build completo** del commit `ac511d7` para ambos
servicios (no un overlay selectivo de 1 archivo como la anterior
`d6ce2c2`) — `build` lo confirma con `"reproducible":true` y
`"artifactCount":126` sobre el checkout completo del commit declarado en
`release-source.json`.

## 9. Pendiente

Validación visual del panel desde el navegador — la realiza el propietario
directamente, fuera de esta tarea. No se repite ninguna lectura activa de
Hosts (GPV/refreshObject) contra la Huawei real en esta tarea: la prueba
real de 5 dispositivos ya quedó cerrada en la sesión anterior
(`docs/TR069-HOSTS-ACTIVE-READ-20261028.md`,
`docs/TR069-HOSTS-RELEASE-VERIFICADO-20261028.json`).
