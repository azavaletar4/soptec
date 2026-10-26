# Fase 175 — corrección de contadores activada

Resultado verificado a las 16:28:52 UTC (11:28:52 Perú) del 2026-10-26:
**backend corregido activo y primer muestreo automático con 360 muestras
nuevas confirmadas en base de datos**. Frontend y otros servicios conservados.

**Estado compartido para Claude Code y Codex:** Fase 175 está desplegada y
operativa; el HTTP 400 por URL excesiva está corregido con lotes de 100.
Los fallos y rollbacks previos son antecedentes. Las 17/17 pruebas incluyen
3.000, 3.001 y 5.000 contratos ficticios; esa simulación se distingue de la
validación real de 360 muestras nuevas exclusivamente del Administrador.
La migración SQL de optimización
`20261026130000_fase175_traffic_anomalies_lateral.sql` no está aplicada según
la evidencia disponible. Seguimiento de ciclos y certificación integral de
3.000 clientes siguen pendientes y no invalidan la recuperación confirmada.
Para iniciar sesiones, ver `CLAUDE.md`, `ESTADO_DESARROLLO.md` y
`docs/REGISTRO-VERSIONES-PRODUCTIVAS.md`; no repetir el diagnóstico resuelto.

## Qué se hizo

Se continuó desde el diagnóstico ya resuelto, sin repetir auditorías.
Se verificó que el archivo antes de corregirlo coincide con el backend
real de Fase 175 y se selló el cambio en un worktree aislado limpio:

- Commit local: `16831c6c3597c1e7495a4f2230566a44c3e2b2cd`.
- Padre: `53f284c70c967b164ff4fa7a8403f3238c2bfbc7`.
- Rama local: `release/fase175-counter-batches-20261026`.
- Contenido del commit: exclusivamente `trafficAnalyticsService.ts` y su
  archivo de pruebas de contadores. No push, merge ni cambio de rama main.

Se construyó una imagen independiente sobre la imagen backend activa de
Fase 175, sustituyendo únicamente `server/src/services/trafficAnalyticsService.ts`.
La comparación de los 99 archivos fuente backend detectó exactamente ese
cambio; los layers anteriores, runtime y dependencias se conservaron.
SHA256 del archivo nuevo:
`1fb58751f160188639ea29f331be1e8a58165972edd41c7e267939832bfc86f5`.

Se respaldó la imagen saliente, inspección del contenedor y configuración
Compose efectiva. Se conservaron todos los overrides existentes. Antes de
promover se revalidaron imágenes, hashes de ambos tar, archivos Compose,
entorno y contenedores. El override cambia solo `services.backend.image`.

Promoción exclusivamente de backend con
`up -d --no-deps --no-build --pull never backend`. No se construyó,
reemplazó ni reinició el frontend. No hubo migraciones ni cambios en clientes,
contratos, facturación, órdenes, MikroTik, OLT o credenciales. No se ejecutó
muestreo manual ni se alteraron muestras históricas.

## Versión desplegada y respaldo

- Imagen: `smartrayco-backend-counters:16831c6-20261026T162650Z`.
- ID: `sha256:6631d4a124b631f7bedd3d8c2b6f6c8ab7e524e264385ae2fae2b46e3f67047e`.
- Contenedor: `1a0c00376d3b2cd5ff623e90e8050bc092deb7602976b35d852179cb54f360a9`.
- Arranque: `2026-10-26T16:27:41.085443964Z`.
- Stage: `/opt/smartrayco-staging/fase175-counters-16831c6-20261026T162650Z`.
- SHA256 de `candidate.image.tar`:
  `a81b4afe7b4b011372f648a677310c50f410821c719260ae00b8e1b6d7ec6a24`.
- Backend anterior: `smartrayco-backend-fase175:53f284c-20261026T154532Z`,
  ID `sha256:e0bb1e7b2e3011675a5b0d8484a00ee7106302a25094996098a5297df4c3f6bd`.
- Tag de recuperación: `smartrayco-backend-counters-rollback:20261026T162650Z`.
- Respaldo: `recovery/backend.tar`, SHA256
  `54931a43ee1660c0bd7eff39f156ccb46056ad82fb1383d3cf4ea15976b7e07f`.
- Frontend conservado: `smartrayco-frontend-fase175:99dc78b-20261026T154532Z`,
  ID `sha256:3155f928b6b5492c9f4398e3a7601ad442a0b5b6f866bbbe637d89b7df05d959`.
- Contenedor frontend conservado:
  `5b261cea1e1aaf1c76078bc25d43bfe41ec4111c2ebe6ac2571509124e9af4f4`,
  arranque original `2026-10-26T15:57:46.709174656Z`.

## Pruebas y requisito de 3.000 clientes

**17/17 PASS**, tanto localmente como dentro de la imagen candidata con
Node/runtime reales, red deshabilitada, filesystem de solo lectura y recursos
limitados. TypeScript focalizado PASS; diff sin errores de espacios.

| Contratos ficticios | Peticiones | Máximo de ruta+query | Estados existentes recuperados |
|---|---|---|---|
| 3.000 | 30 | 4.023 bytes | 1.500 de 1.500 |
| 3.001 | 31 | 4.023 bytes | 1.500 de 1.500 |
| 5.000 | 50 | 4.023 bytes | 2.500 de 2.500 |

El fixture deja deliberadamente la mitad de los contratos sin estado previo.
Se validan los UUID solicitados, todos los estados esperados, contadores y
timestamps sin alteraciones, ausencia de URLs grandes y lecturas GET
exclusivas de contadores. Un error en los lotes finales 30, 31 o 50 devuelve
error y `data=null`; nunca permite continuar con estados parciales.
Se preservan las pruebas previas de 711 contratos, límites de lote, lista vacía,
timeouts y errores MikroTik. El tiempo medido con HTTP simulado no se usa
para afirmar rendimiento de la red o de Supabase.

## Salud y muestreo real

- API `ok`, también por dominio público HTTPS; panel HTTP 200.
- `/analitica`, `/mikrotik`, `/soporte`, `/soporte/instalaciones`,
  `/soporte/rutinas`, `/campo`: HTTP 200 e índice frontend idéntico al anterior.
- Puntos: Avería, Alta y Rutina PASS con recursos públicos y datos ficticios;
  un botón Confirmar cierre, cero mutaciones y excepciones.
- Frontend, Caddy, Mongo y GenieACS mantienen imagen, contenedor y fecha de
  arranque. Cero errores críticos de backend observados.
- Balanceador independiente: 24 muestras nuevas desde el arranque backend,
  todas online, última observada `2026-10-26T16:28:08.425+00:00`.

Primer ciclo automático:

```text
2026-10-26T16:28:32.973812033Z
[traffic-analytics-scheduler] OK: 360 muestras (665 contratos, 1 routers)
```

La base confirmó 360 filas nuevas posteriores al arranque, exclusivamente
del `Administrador 2116`, rol `pppoe_admin`:

- `sampled_at`: `2026-10-26T16:28:28.173+00:00` (11:28:28 Perú).
- `run_id`: `bec0e794-242c-4517-a753-22463bdc0a2d`.
- Sin errores reportados en el primer ciclo; no reapareció HTTP 400.
- Aproximadamente 4,8 segundos desde `sampled_at` al mensaje de finalización;
  es el ciclo real actual y no una prueba de carga de 3.000 clientes.

Esto confirma recuperación de la inserción automática, sin extrapolar la
corrección a todas las pantallas/RPC de Analítica ni a tasas históricas.

## Qué falta y riesgos de escala

**Requisito permanente:** SmartRayco debe escalar a por lo menos 3.000 clientes
con estabilidad y rendimiento. Esta corrección valida la lectura de estados
con 3.000 y 5.000 contratos, pero no certifica todo el muestreo a esa escala.

- La consulta inicial de `service_contracts` sigue sin paginación explícita.
  Es necesario contrastar el máximo de filas efectivo de REST y garantizar
  que se recuperen los 3.000 contratos completos. La prueba del helper recibe
  los 3.000 IDs y no prueba esa consulta previa. No se amplió el parche
  autorizado para cambiarla en este despliegue.
- A 3.000 contratos, 30 lecturas secuenciales deben compartir el presupuesto
  del watchdog de 120 segundos con lectura del router, contratos, inserción
  y actualización de contadores. Falta una prueba integral con latencia real,
  timeouts, errores y carga sostenida; no basta el fixture rápido.
- Revisar límites de payload y latencia de inserts/upserts masivos cuando
  crezca el número de clientes. Esas escrituras existentes no se modificaron.
- Los primeros deltas parten de estados antiguos y la lógica de intervalos
  existente se mantiene; no interpretar automáticamente el primer ciclo como
  una tasa instantánea normal. No se recalcularon ni corrigieron históricos.
- Falta observar continuidad de ciclos posteriores; el primer ciclo ya
  quedó demostrado. No hay otra corrección o despliegue pendiente autorizado.

## Desvíos y rollback

- El sandbox bloqueó `uv_os_get_passwd` y las referencias Git; las pruebas y
  el sellado local pasaron con la ejecución permitida fuera del sandbox.
- El primer build de preparación falló al usar `FROM sha256:...` como
  referencia Docker. Se corrigió usando un tag nuevo fijado a la misma imagen
  saliente. No se sustituyó ningún contenedor en ese intento. Su stage
  incompleto `fase175-counters-16831c6-20261026T162559Z` se conservó sin usar.
- No hubo fallos críticos durante la promoción; **rollback no ejecutado**.
  El respaldo y override por servicio permanecen disponibles.

Comandos exactos (ejecutar desde `/opt/smartrayco`):

```bash
compose=(docker compose -p smartrayco --project-directory /opt/smartrayco
 -f /opt/smartrayco/docker-compose.onprem.yml
 -f /opt/smartrayco-staging/points-final-20261026T001656Z/points-approved-activation.override.json
 -f /opt/smartrayco-staging/points-fix-397484c-20261026T050348Z/points-fix.override.json
 -f /opt/smartrayco-staging/single-close-87ddfd3-20261026T054949Z/single-close.override.json
 -f /opt/smartrayco-staging/fase175-20261026T154532Z/backend.rollback.json
 -f /opt/smartrayco-staging/fase175-20261026T154532Z/backend.override.json
 -f /opt/smartrayco-staging/fase175-20261026T154532Z/frontend.override.json)
stage=/opt/smartrayco-staging/fase175-counters-16831c6-20261026T162650Z
# Promoción ya ejecutada:
"${compose[@]}" -f "$stage/backend.override.json" up -d --no-deps --no-build --pull never backend
# Rollback preparado, no ejecutado:
"${compose[@]}" -f "$stage/backend.override.json" -f "$stage/backend.rollback.json" up -d --no-deps --no-build --pull never backend
```

Si faltara el tag de recuperación, cargar primero `recovery/backend.tar`.
Antes de futuras operaciones revalidar que la cadena efectiva conserva el
override nuevo del backend; no usar `safe-update.sh`.

Evidencia: `prepared.json`, `candidate-tests.log`, `deployed.json`,
`observation.json`, archivos privados de Compose/inspección y tar en el stage;
copias locales en `scripts/inventory-auth-lab/runtime/fase175-counters-*`.
