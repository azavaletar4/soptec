# Clientes — contador de servicios (vigentes/históricos) — DESPLEGADO

**2026-11-02, 20:55:24 UTC, autorizado expresamente por el propietario.**
Despliegue exclusivo del frontend para el commit `ec05ee5` (columna
"Servicios" de Clientes: distingue contratos vigentes —activo/suspendido—
de históricos —cancelados—, ver `src/lib/clientLifecycle.ts`
`countServicesByVigencia`/`formatServiceCounts` y
`src/views/clientes/ClientesView.vue`). Backend, OLT, MikroTik, GenieACS y
Supabase sin tocar.

## Verificación previa

- `HEAD` y `origin/main` confirmados en `ec05ee5` (sin divergencia).
- Commit revisado: solo 3 archivos (`src/lib/clientLifecycle.ts`,
  `src/lib/__tests__/clientLifecycle.test.ts`,
  `src/views/clientes/ClientesView.vue`); sin credenciales ni secretos.
- Archivos de otras fases (ESTADO_DESARROLLO.md modificado, docs de
  Asistencia/Fase175/Puntos/Oficina XUI/Samsung/TR-069-release sin
  seguimiento, `server/src/services/__tests__/trafficAnalyticsCounterStates.test.ts`)
  **preservados intactos, sin tocar ni commitear**.
- Producción leída en vivo antes de desplegar (`GET /release-manifest.json`):
  servía `e31e260` (clasificación de 4 secciones, desplegada hoy mismo antes
  de esta tarea).

## Respaldo y despliegue

- `release-source.json` regenerado para `ec05ee5` (305 archivos fuente,
  snapshot local, no se publica — `.gitignore`).
- `deploy/consolidation-release-scope.json.sourceCommit` actualizado de
  `e31e260` a `ec05ee5` (mismos 3 `frontendSources` y 2 `frontendAssets`,
  `backendSources` vacío).
- `prepare`: `{"prepared":true,"rollbackTested":true}` — imagen frontend e
  imagen backend en vivo respaldadas (`.image.tar`), rollback reconstruido y
  verificado byte a byte antes de construir nada nuevo.
- `build`: `{"built":true,"reproducible":true,"contractGuardValidatedReadOnly":true,
  "frontendChangedAssets":["assets/ClientesView.js","assets/clientLifecycle.js"],
  "artifactCount":126}` — doble build idéntico, único overlay cambiado
  exactamente el declarado, guardia `validateWifiTrialContract` (TR-069
  WiFi) sigue pasando sin tocarla.
- `deploy`: servicios recreados `["frontend"]` únicamente — `backend`,
  `caddy`, `mongo`, `genieacs` con el mismo `Id`/imagen y misma hora de
  arranque de antes (`backend` sigue iniciado `17:17:38Z`, sin reinicio).

## Validación posterior

- `verify` (independiente del `deploy`): 11 rutas PASS (`/`, `/tr069`,
  `/asistencia`, `/campo`, `/campo/mi-custodia`, `/puntos`, `/soporte`,
  `/mikrotik`, `/analitica`, `/rutinas`, `/olt`), 126 artefactos verificados
  por hash, `401` sin autenticación en las rutas protegidas,
  `ssidTasksSent:0`.
- `GET /release-manifest.json` en vivo: `"commit":"ec05ee5..."`.
- Contenido real servido verificado por texto (no solo el manifiesto):
  `assets/clientLifecycle-Blrqpsfc.js` descargado de producción contiene
  literalmente `vigente`/`vigentes` — confirma que el bundle nuevo está
  siendo servido, no una caché vieja.
- 22/22 pruebas focalizadas (`node --import tsx --test
  src/lib/__tests__/clientLifecycle.test.ts`) y `vue-tsc` limpios antes de
  publicar — no repetidas aquí, ya corridas en el commit de implementación.

**Pendiente de confirmación visual del propietario en el panel real**
(datos reales de clientes, no se simulan aquí): Jheraldin Vidal Cruz y
Daniel Gavidia Romero mostrando "0 vigentes · 1 histórico", un cliente con
2 contratos vigentes mostrando "2 vigentes", un cliente con 1 vigente + 1
cancelado mostrando "1 vigente · 1 histórico", las 4 pestañas de Clientes,
los indicadores del Dashboard y el módulo Prospectos sin regresión. Nada de
esto requiere otra acción de despliegue — es solo observación visual.

## Rollback

Preparado y probado en `prepare` (restaura exactamente la imagen frontend
de `e31e260` que corría antes de esta release, sin tocar `backend`). No
ejecutado — el despliegue no falló, no fue necesario.
