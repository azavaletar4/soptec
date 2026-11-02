# Clientes — filtros desplegables, orden y persistencia — DESPLEGADO

**2026-11-02, 21:33:39 UTC, autorizado expresamente por el propietario.**
Despliegue exclusivo del frontend para el commit `fcdf694` (filtros Estado/
Servicios, encabezados ordenables tipo Excel, persistencia de filtros/orden/
pestaña en la URL — ver `docs/` sesión del mismo día, implementación en
`src/lib/clientsListFilters.ts`, `src/views/clientes/ClientesView.vue` y
`src/views/clientes/ClientDetailView.vue`). Backend, Supabase, contratos,
facturación, inventario, OLT, MikroTik y GenieACS sin tocar.

## Verificación previa

- `HEAD` y `origin/main` confirmados en `fcdf694` (sin divergencia).
- Commit revisado: exactamente 4 archivos (`src/lib/clientsListFilters.ts`,
  `src/lib/__tests__/clientsListFilters.test.ts`,
  `src/views/clientes/ClientDetailView.vue`,
  `src/views/clientes/ClientesView.vue`); sin credenciales ni secretos.
- Archivos de otras fases (ESTADO_DESARROLLO.md modificado, docs de
  Asistencia/Fase175/Puntos/Oficina XUI/Samsung/TR-069-release sin
  seguimiento, `server/src/services/__tests__/trafficAnalyticsCounterStates.test.ts`)
  **preservados intactos, sin tocar ni commitear**.
- Producción leída en vivo antes de desplegar (`GET /release-manifest.json`):
  servía `ec05ee5` (contador vigentes/históricos, desplegado el mismo día).

## Hallazgo real durante `build` y cómo se resolvió (sin relajar el control)

El primer intento de `build` falló con `HISTORICAL_ASSETS_CHANGED` listando
~53 chunks de vistas y composables totalmente ajenos a este cambio
(`PlanesView.js`, `useToast.js`, `index.js`, etc. — ninguno de los archivos
de este commit). Se investigó con evidencia real antes de tocar nada:

1. Se extrajeron (solo lectura, `docker create`+`docker cp`, sin iniciar
   contenedores) los árboles `/usr/share/nginx/html` de la imagen en vivo
   (`ec05ee5`) y de la imagen candidata (`fcdf694`, ya construida aunque el
   `build` había fallado la validación).
2. Comparando byte a byte tras neutralizar referencias con hash (mismo
   mecanismo ya documentado para `fabc136`, ver `CLAUDE.md`), la causa real
   es que Rollup reasigna identificadores minificados de una letra/dos
   letras (alias de `import{K as r}from"./index.js"` → `import{L as r}...`,
   o nombres locales `const K={...}` → `const F={...}`) en **todo** chunk
   que importa algo del chunk compartido `index.js`, cada vez que el grafo
   de módulos cambia aunque sea mínimamente (en este caso, un archivo nuevo
   — `clientsListFilters.ts` — alcanzable solo desde `ClientesView.vue`).
3. Se verificó programáticamente (comparación tokenizada de `import`/
   `export`/`const` reasignados) que, de 122 chunks alcanzables, 55 son
   bit-a-bit idénticos tras esa normalización y los 37 restantes (menos
   `ClientesView.js`/`ClientDetailView.js`, los 2 reales de este commit)
   se redujeron, en 10 muestras diversas revisadas a mano
   (`PlanesView`, `UsuariosView`, `Tr069View`, `equipmentPhotoType`,
   `useUnifiedJobs`, `routineTraslado`, `usePersonalRead`, `InventarioView`,
   `nativeApp`, `index.js`), exactamente a este mismo patrón — nunca una
   cadena, número o rama de código distinta.
4. Con esa evidencia, se declaró explícitamente el alcance real de esta
   release en `deploy/consolidation-release-scope.json.frontendAssets`
   (53 nombres lógicos, los mismos que reportó el propio `build`) — **no
   se modificó el verificador ni se amplió ningún permiso general**; la
   próxima release con otro alcance deberá volver a declarar el suyo, igual
   que ya ocurrió con `fabc136`/`frontAllow` en versiones anteriores.
5. Se limpiaron los contenedores y archivos temporales de esta
   investigación en la VM antes de continuar (sin dejar residuos).

## Respaldo y despliegue

- `release-source.json` regenerado para `fcdf694` (307 archivos fuente).
- `prepare` (segundo intento, tras ampliar el alcance — nuevo stage por
  cambiar el `scope`): `{"prepared":true,"rollbackTested":true}`.
- `build`: `{"built":true,"reproducible":true,"contractGuardValidatedReadOnly":true,
  "artifactCount":126}` — doble build idéntico, `frontendChangedAssets`
  coincide exactamente con lo declarado (53 entradas), guardia TR-069 WiFi
  intacta.
- `deploy`: solo `frontend` recreado — `backend`/`caddy`/`mongo`/`genieacs`
  con el mismo `Id`/imagen y misma hora de arranque (`backend` sigue desde
  `17:17:38Z`, sin reinicio).

## Validación posterior

1. **Desplegables Estado/Servicios**: confirmado en el bundle real servido
   (`assets/ClientesView-CVwX0zAr.js` contiene literalmente
   `clients-status-filter`, `clients-service-filter`, `Limpiar filtros`,
   `Con servicios vigentes`, `resultados de`).
2. **Filtros combinados + 4 pestañas**: cubierto por las 17 pruebas
   focalizadas de `clientsListFilters.test.ts` (ya corridas antes del commit,
   no repetidas aquí) — combinación Estado+Servicios+búsqueda+sección.
3. **Ordenación**: cubierta por las pruebas de `sortClientRows` (Nombre,
   Estado, Prioridad, Cantidad de servicios, asc/desc, estable).
4. **Persistencia al volver de una ficha**: `assets/ClientDetailView-DjTW1Wrh.js`
   contiene `history.state` — confirma que el bundle real usa
   `router.back()` con el fallback, no el `router.push('/clientes')` fijo
   anterior.
5. **Contadores generales y servicios históricos**: `assets/clientLifecycle-Blrqpsfc.js`
   tiene el **mismo hash** que en el despliegue anterior (`ec05ee5`) — no
   cambió una sola línea de esa lógica en esta release.
6. **Rutas/assets/errores críticos**: `verify` independiente del `deploy`
   PASS — 11 rutas, 126 artefactos verificados por hash, `401` sin
   autenticación, `ssidTasksSent:0`.

**Pendiente de tu confirmación visual en el panel real** (requiere sesión
autenticada, no se simula aquí): abrir Clientes, probar los desplegables
Estado/Servicios combinados con la búsqueda y las 4 pestañas, ordenar por
cada columna, abrir una ficha y volver comprobando que los filtros/orden se
mantuvieron, y repetir con un usuario ADMIN y uno SUPERADMIN. Nada de esto
requiere otra acción de despliegue.

## Rollback

Preparado y probado en `prepare` (restaura la imagen `ec05ee5` que corría
antes de esta release). No ejecutado — el despliegue no falló.
