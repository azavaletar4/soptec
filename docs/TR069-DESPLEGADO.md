# TR-069: inventario ACS actual desplegado

Corrección `30bbb54` desplegada el 2026-10-27 ~16:14 UTC (11:14 Perú), con
autorización expresa del propietario. Separa inventario ACS actual de
registros históricos en la caché `tr069_devices`; nunca borra ni desvincula
ausentes — solo una lectura NBI completa acredita ausencias.

## Imágenes activas

- Backend: `smartrayco-backend-tr069:30bbb54-20261027T161415Z`
  (`FROM smartrayco-backend-counters:16831c6-20261026T162650Z` +
  `server/src/routes/tr069sync.ts`, `server/src/services/tr069Inventory.ts`
  (nuevo), `src/types/tr069Inventory.ts` (nuevo, compartido)). El resto del
  árbol de la rama `diagnostico/tr069-genieacs-readonly` (asistencia, puntos,
  mikrotik, clientes, etc.) **no** se desplegó — solo estos 3 archivos.
- Frontend: `smartrayco-tr069:30bbb54-20261027T161438Z`
  (`FROM smartrayco-campo-direccion:fc9047f-20261027T145104Z` + `dist/`
  compilado desde `30bbb54`, que entre `fc9047f` y `30bbb54` solo difiere en
  los 4 archivos propios de esta corrección — confirmado sin otros commits
  intermedios).
- `clientLifecycle.ts` (dependencia de `tr069sync.ts`) ya estaba presente en
  el backend productivo por un despliegue selectivo anterior — coincide
  byte a byte con la versión en `30bbb54`; no requirió copiarse de nuevo.

## Comprobaciones (todas de solo lectura, sin escrituras)

- `docker compose config` diff: solo `services.backend.image` y
  `services.frontend.image` cambian; caddy/genieacs/mongo sin tocar
  (`StartedAt` idéntico antes/después).
- Backend arrancó sin errores (`/api/health` → 200); ruta nueva
  `GET /api/tr069-sync/inventory` registrada (401 sin token, como las demás
  rutas de staff).
- NBI de GenieACS: `GET /devices` → HTTP 200, lista vacía (0 CPE), antes y
  después del despliegue.
- `tr069_devices`: 2 filas (sin cambios), `service_contract_id` igual que
  antes (1 vinculado, 1 sin vincular) — el scheduler automático corrió una
  vez tras el reinicio y reportó "0 nuevos, 0 actualizados, 0 en GenieACS"
  (comportamiento esperado: la ausencia en el NBI no sobrescribe ni retira
  el histórico).
- Frontend: `caddy` → `frontend` sirve `index.html` con el bundle nuevo
  (`index-C_EzobKH.js`, `Tr069View-D0JQgZYR.js` presente en `assets/`).

## No se ejecutó

Sin migraciones, sin operaciones sobre ONTs/OLT/MikroTik, sin cambios de
configuración de GenieACS, sin merge a main, sin force push.

## Pendiente

La Huawei nueva (registro TR-069 de punta a punta) sigue sin probarse — es
posterior y separada de este despliegue.

## Rollback preparado, no usado

```json
// recovery/backend.rollback.json
{"services": {"backend": {"image": "smartrayco-backend-counters:16831c6-20261026T162650Z"}}}
// recovery/frontend.rollback.json
{"services": {"frontend": {"image": "smartrayco-campo-direccion:fc9047f-20261027T145104Z"}}}
```

Restaurar con la misma cadena de 7 overrides + `tr069-30bbb54-20261027/promotion/backend.override.json`
reemplazado por `recovery/backend.rollback.json` (y análogo para frontend),
`up -d --no-build --no-deps --pull never <servicio>`. Imágenes anteriores
conservadas localmente en el host; también respaldadas en
`/opt/smartrayco-staging/tr069-30bbb54-20261027/recovery/{backend,frontend}.tar`.
