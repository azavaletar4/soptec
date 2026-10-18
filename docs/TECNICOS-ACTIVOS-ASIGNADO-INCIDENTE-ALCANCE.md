# Incidente de alcance — despliegue de "Asignado" en Técnicos activos (2026-10-18)

**Estado: INCIDENTE ABIERTO.** No declarar cerrado hasta que el usuario confirme
visualmente, con su propia sesión administrativa, que Operaciones de Hoy,
Rutinas, Asistencia e Inventario funcionan correctamente.

## Lo autorizado

El usuario autorizó desplegar **únicamente** la corrección visual de
"Técnicos activos" (`TechnicianStatusBar.vue` + `src/lib/jobStatus.ts` +
`src/lib/technicianDispatchStatus.ts`, commit `bdf3df2`): cambia la etiqueta
"En camino" por "Asignado" para órdenes que todavía no inician. Sin tocar
estados de órdenes, App de Campo, base de datos ni permisos. Caso real:
RUT-2026-00071 (Jairo Bernabe).

## Lo que realmente se desplegó

`deploy/update.sh` hace `git pull --ff-only` sobre el checkout real de la VM.
La VM estaba en `b128e42` — muchos commits detrás de `origin/main` por
despliegues pendientes de sesiones anteriores, no solo del commit del fix de
hoy. El pull trajo **272 archivos, ~27 000 líneas**, incluyendo
funcionalidad completa nunca antes desplegada en esta VM:

- Fase 161 — devolver rutinas (`routine_returns`, `return_routine`)
- Fase 162 — inventario de rutinas + autorización de recibos
  (`routine_inventory_operations`, `routine_inventory_operation`,
  `check_routine_inventory_receipt`)
- Fase 163 — postergar instalaciones
- Fase 164 — custodia de técnicos

Esto excede claramente lo autorizado para este despliegue.

## Verificación de riesgo (solo lectura, sin rollback, sin nueva migración, sin push)

Hecha porque el usuario pidió "mantener temporalmente el despliegue actual" +
verificaciones de solo lectura, no porque se considere aceptable exceder el
alcance.

- **Commit real en la VM**: `git log --oneline -1` en `/opt/smartrayco` →
  `bdf3df2` (el HEAD esperado tras el pull). Ambos contenedores
  (`smartrayco-backend-1`, `smartrayco-frontend-1`) con `Created` ~17:49:48Z,
  consistente con la corrida de `update.sh`.
- **El fix SÍ está en el bundle servido**: `grep -rl "asignado, sin iniciar"`
  dentro de `smartrayco-frontend-1` encontró la cadena en
  `OperacionesHoyView-DK-Omdes.js` — el chunk real que el navegador carga.
- **Los objetos de BD que el código nuevo necesita YA EXISTÍAN en Supabase
  producción antes de este despliegue** (verificado con `to_regclass`/
  `to_regprocedure` contra el catálogo real, no por nombre de migración —
  el tracking de migraciones de este proyecto no es 1:1 con lo aplicado
  realmente, ver sección de causa raíz):
  - `routine_returns` (tabla) y `return_routine(uuid,text)` (función): existen.
  - `routine_inventory_operations` (tabla),
    `routine_inventory_operation(uuid,uuid,text,jsonb)` y
    `check_routine_inventory_receipt(uuid,uuid)`: existen.
- **Logs de los últimos 10 minutos tras el despliegue** (`docker logs
  --since 10m`, filtrando error/fail/exception): sin errores nuevos. El
  único "error" que aparece (`traffic-analytics-scheduler ... fetch failed`,
  MikroTik) es preexistente, no relacionado a este despliegue.
- **`docker image prune -f` liberó 0B** — las imágenes previas siguen
  intactas. Rollback preparado y disponible si se decide usarlo:
  - tag git `rollback-20261018174723` → commit previo `b128e42`
  - imagen `smartrayco-frontend:rollback-pre-tecnico-asignado-b128e42`
- **RUT-2026-00071**: sigue `status='scheduled'`, sin cambios.

## Lo que NO se verificó (pendiente, por eso el incidente sigue abierto)

No hay verificación visual/funcional en el navegador con sesión
administrativa real de ninguna de las pantallas afectadas — ni la del fix
(Operaciones de Hoy, Rutinas, Asistencia) ni las de las fases que llegaron
sin querer (Inventario → Conciliación/Custodia, Instalaciones → Postergar,
devolver Rutinas). No se entra con credenciales reales de producción por
cuenta propia. **El usuario revisará esto directamente con su sesión.**

## Causa raíz — por qué `deploy/update.sh` permitió esto

1. El script no fija ningún commit objetivo: `git pull --ff-only` trae
   *todo* lo que haya en `origin/main` en ese momento, sin distinguir "el
   commit que acabo de autorizar" de "lo que se acumuló en sesiones
   anteriores sin desplegar".
2. No hay ningún paso de *preview*: no se lista qué commits/archivos entrarían
   antes de aplicarlos — el `git pull` y el rebuild ocurren en el mismo paso,
   sin punto de corte para revisar.
3. No hay registro de "qué commit tiene realmente la VM" fuera de lo que el
   propio `git log` de la VM pueda mostrar en el momento — nada avisa de
   antemano que la VM estaba _N_ commits y _M_ fases atrás.
4. Sesiones anteriores (ver historial en `ESTADO_DESARROLLO.md`, ej. los
   despliegues de Conciliación) sí seguían una disciplina mucho más estricta
   para desplegar: candidato aislado en un worktree separado con *solo* los
   archivos autorizados, verificado byte a byte contra el commit de origen,
   imagen propia con hash de `dist` confirmado antes de reemplazar nada en
   vivo. Hoy se usó en cambio `deploy/update.sh` directo sobre el checkout
   real de la VM — el camino rápido, sin ese aislamiento — y por eso el pull
   trajo todo lo acumulado en main, no solo el commit autorizado.

## Protección propuesta (NO implementada — queda pendiente de autorización)

- **Pin explícito de commit**: cambiar `deploy/update.sh` para que reciba el
  SHA a desplegar como argumento obligatorio (`bash deploy/update.sh <sha>`)
  y haga `git fetch` + `git checkout <sha>` en vez de `git pull` de lo que
  sea que esté en la punta de `main` en ese momento.
- **Paso de preview obligatorio**: antes de aplicar, hacer `git fetch` y
  mostrar `git log --oneline <HEAD_actual>..<sha_objetivo>` — si la lista
  tiene más de 1 commit o toca archivos fuera de lo autorizado, requerir
  confirmación explícita en vez de seguir automáticamente.
- **Chequeo de drift**: un script corto (`scripts/check-deploy-drift.sh` o
  similar) que compare el commit real de la VM contra `origin/main` y avise
  cuántos commits/archivos de diferencia hay — para detectar este tipo de
  acumulación ANTES de que un despliegue cualquiera la arrastre entera.
- **Volver la disciplina de "candidato aislado" la via por defecto**: el
  patrón ya usado para Conciliación (worktree separado, solo los archivos
  autorizados, diff verificado, imagen propia) debería ser el camino
  normal para cualquier despliegue — `deploy/update.sh` tal como está hoy
  (pull directo sobre el checkout real) debería quedar como excepción manual
  explícita, no la primera opción.

Nada de esto se implementó todavía — queda para que el usuario decida si
quiere aplicarlo.
