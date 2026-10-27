# Registro de versiones productivas — SmartRayco

Archivo de continuidad para **Claude Code y Codex por igual**. Objetivo: que
ninguna de las dos herramientas sobrescriba por accidente un trabajo ya
aprobado y en vivo de la otra. Antes de desplegar backend O frontend,
**leer este archivo primero** y actualizarlo después de cada despliegue real
(no al preparar/probar — solo cuando algo se promueve de verdad a
producción).

Verificado por lectura directa de los contenedores/imágenes reales de la VM
el 2026-10-26; actualizado tras activar la corrección de contadores y verificar
el primer muestreo de contadores; frontend de devoluciones verificado a las
17:16 UTC — no es una suposición desde git.

## Estado actual (2026-10-26)

| | Backend | Frontend |
|---|---|---|
| Commit base real | `b379028` + Fase 175 `53f284c` + corrección local `16831c6` | `87ddfd3` + Fase 175 `99dc78b` + custodia `fb56057` (`c11f6a8`) + A0/A1 `711a7fc` + visual `4db50f9` + aprobación `263f66e` + diseño bandeja `cd0d0c9` + widget personal `070c777` |
| Commit anterior | `53f284c` | `263f66e` |
| Imagen activa | `smartrayco-backend-counters:16831c6-20261026T162650Z` | `smartrayco-asistencia-polish:070c777-20261026T220705Z` |
| Construida vía | Overlay exclusivo de `trafficAnalyticsService.ts` sobre la imagen backend Fase 175 activa; runtime/dependencias conservados | Fuente real (`070c777`, sobre `263f66e`) + corrección visual de las tarjetas SUPERADMIN (`class="input"` inexistente → `field-input`/`field-label`) y del formulario personal ADMIN/TECNICO_RED (mismo bug); nada más tocado |
| Desplegado | 2026-10-26 16:27:41 UTC | 2026-10-26 22:07:05 UTC |
| Funcionalidades incorporadas | Fase 36…174b + Fase 175 + lectura de contadores en lotes de 100 UUID | Puntos + Analítica + Devoluciones + Asistencia A0/A1 (exclusión SUPERADMIN, desplegable móvil, aprobación/rechazo corregidos, bandeja SUPERADMIN y formulario personal con diseño correcto) |
| Rollback | `fase175-counters-16831c6-20261026T162650Z/recovery/backend.tar`, tag `smartrayco-backend-counters-rollback:20261026T162650Z` | `/opt/smartrayco-staging/asistencia-polish-070c777-20261026T220705Z/recovery/frontend.tar`, tag `smartrayco-asistencia-polish-rollback:20261026T220705Z` (apunta a la imagen `263f66e` previa) |

### Asistencia A0/A1 — migración aplicada y frontend desplegado (2026-10-26)

- Migración `supabase/migrations/20261027010000_asistencia_a0_a1.sql`
  **APLICADA** a Supabase de producción ~20:27 UTC. 113 marcaciones
  históricas verificadas idénticas antes/después (mismo hash); permisos
  re-verificados de solo lectura tras aplicar.
- Frontend en 2 pasos selectivos, sin push a GitHub:
  1. `711a7fc` (A0/A1 + exclusión SUPERADMIN) sobre `c11f6a8` →
     `smartrayco-asistencia-a0a1:711a7fc-20261026T203334Z`.
  2. `4db50f9` (simplificación visual móvil) sobre el paso 1 →
     `smartrayco-asistencia-visual:4db50f9-20261026T211911Z`.
- **Incidente real en el paso 1**: la primera promoción omitió el override
  del backend (`backend.override.json`) y Compose regresionó el backend a
  `smartrayco-backend:latest`, perdiendo la corrección de contadores de
  Fase 175. Sin caída de API, sin pérdida de datos. Corregido reaplicando
  con ambos overrides juntos. **Lección aplicada en el paso 2**: siempre
  pasar `-f <backend.override.json> -f <frontend.override.json>` juntos y
  verificar `docker compose ... config` ANTES de aplicar — en el paso 2 se
  confirmó así, y el log del despliegue mostró `backend Running` (no
  recreado), ID de contenedor y `StartedAt` idénticos antes/después.
- Backend nunca reconstruido ni reiniciado en ningún paso de Asistencia.
  Analítica de Tráfico confirmada operativa (~670+ muestras por ciclo, sin
  error) después de los 3 despliegues de frontend.
- Rollback de la migración preparado y verificado en Postgres aislado:
  `scripts/sql/asistencia-a0-a1-rollback.sql` (no usado, no aplicado).

#### Paso 3: corrección de aprobación/rechazo SUPERADMIN (2026-10-26 ~21:38 UTC)

Problema real reportado: solicitud "Pendiente de justificar" visible, pero
Aprobar/Rechazar deshabilitados sin explicación — el campo de comentario
exigido por `resolver_ausencia()` (igual para ambas decisiones) no era
identificable en el formulario. Corrección 100% frontend, **sin
migración**: Aprobar ya no exige texto (usa un comentario por defecto que
sigue cumpliendo la regla de auditoría del backend); Rechazar sigue
exigiendo texto real, ahora con aviso visible; se agrega quién
aprobó/rechazó y cuándo (hora de Perú).

- `263f66e` sobre `4db50f9` → `smartrayco-asistencia-approve:263f66e-20261026T213734Z`.
  Confirmado antes de promover (grep sobre el JS compilado) que la imagen
  conserva simplificación visual, A0/A1 y Devoluciones.
- Misma disciplina que el paso 2: configuración efectiva verificada antes
  de aplicar, `backend Running` (no recreado) en el log del despliegue, ID
  de contenedor y `StartedAt` idénticos antes/después.
- Rollback del frontend preparado, no usado: tag
  `smartrayco-asistencia-approve-rollback:20261026T213734Z` (imagen
  `4db50f9` respaldada en
  `/opt/smartrayco-staging/asistencia-approve-263f66e-20261026T213734Z/recovery/frontend.tar`).
- Pruebas (commit `263f66e`, previas al despliegue, datos ficticios/Postgres
  aislado, ninguna solicitud real resuelta): 9/9 unitarias + 9/9 navegador
  (incluye el caso exacto reportado) + `vue-tsc` limpio. **Pendiente**:
  validación funcional real del propietario desde panel web y celular
  Android (App de Campo).

#### Paso 4: corrección visual combinada — bandeja SUPERADMIN y formulario personal ADMIN/TECNICO_RED (2026-10-26 ~22:07 UTC)

Problema real reportado (visual únicamente, aprobación/rechazo ya
funcionaban desde el paso 3): tanto la bandeja de administración de
SUPERADMIN como el formulario personal de reporte de ausencia (ADMIN/
TECNICO_RED) usaban `class="input"` — una clase que **no existe** en
`style.css` (la real es `field-input`/`field-label`) — por eso ambos se
veían sin estilo, diminutos y amontonados. Corrección 100% visual, sin
tocar lógica/RPC/RLS/historial:

- Bandeja SUPERADMIN (`cd0d0c9`): tarjetas anchas (`.surface`) en grilla,
  una por solicitud, con comentario de decisión en `textarea.field-input`,
  Aprobar/Rechazar en `md:grid-cols-[2fr_1fr]`, muestra quién resolvió y
  cuándo (`formatFechaHora`, hora de Perú).
- Formulario personal ADMIN/TECNICO_RED (`070c777`): mismo patrón
  `field-label`/`field-input` en Motivo (select) y Observación (textarea);
  se conserva el desplegable compacto (`v-show`, no `v-if`) y el
  historial "Mis solicitudes".
- `070c777` sobre `cd0d0c9` sobre `263f66e` →
  `smartrayco-asistencia-polish:070c777-20261026T220705Z`. Confirmado por
  grep sobre el JS compilado, ANTES de promover, que la imagen conserva
  las 5 funcionalidades: formulario personal corregido, tarjetas
  SUPERADMIN corregidas, aprobación/rechazo del paso 3, A0/A1 y
  Devoluciones+Puntos.
- Misma disciplina que los pasos 2 y 3: `docker compose ... config`
  verificado con ambos overrides (`backend.override.json` +
  `frontend.override.json`) ANTES de aplicar — sin incidentes. Backend
  `smartrayco-backend-1` confirmado con el mismo ID de contenedor
  (`cd577bcaa95c...`) y el mismo `StartedAt`
  (`2026-10-26T20:44:49.856235867Z`) antes y después del despliegue. API
  responde `{"status":"ok",...}`; panel alcanzable (HTTP 200).
- Rollback del frontend preparado, no usado: tag
  `smartrayco-asistencia-polish-rollback:20261026T220705Z` (imagen
  `263f66e` previa, respaldada en
  `/opt/smartrayco-staging/asistencia-polish-070c777-20261026T220705Z/recovery/frontend.tar`).
- Pruebas (commit `070c777`, previas al despliegue, datos ficticios/
  Postgres aislado, ninguna solicitud real resuelta): 9/9 navegador +
  `vue-tsc` limpio. Verificación visual adicional a 390px (mobile) y
  escritorio vía captura de pantalla local (fixture temporal, nunca
  comiteado). **Pendiente**: validación funcional real del propietario
  desde panel web y celular Android.
- **Commits locales, sin push a GitHub**: toda la cadena
  `feature/asistencia-a0-a1-local` (incluido `070c777` y este registro
  documental) permanece exclusivamente local — `git ls-remote
  --heads origin feature/asistencia-a0-a1-local` sigue vacío.

### Devoluciones implementadas, desplegadas y validadas — flujo cerrado

- Causa: /campo/mi-custodia retenía la vista de solo consulta. La corrección
  fb56057 ya estaba en GitHub; el artefacto selectivo no la había incorporado.
- Publicado c11f6a8838faade40a605927818df4b67f5e4f11 por push normal;
  documentación anterior publicada en `6a8dadd`.
- Frontend activo: `smartrayco-campo-returns:c11f6a8-20261026T171151Z`; ID `sha256:b6c98bc654906516d8a72eb4d5cdf21d2380d6eda7e1aaffddaff03a0858f84a`.
- Contenedor: `db47bfa3e71cfcfab8a61dd7a1b1bcb6e0d1e1934cc4a1b8958177438343f533`; arranque `2026-10-26T17:14:07.85212786Z`.
- Backend conservado: 16831c6; imagen `sha256:6631d4a124b631f7bedd3d8c2b6f6c8ab7e524e264385ae2fae2b46e3f67047e`;
  mismo contenedor y arranque `2026-10-26T16:27:41.085443964Z`.
- Solo tres fuentes modificadas: CampoMiCustodiaView.vue, CampoCustodiaView.vue
  y custodyReturns.ts. Otros archivos fuente, Puntos, Analítica y nginx intactos.
- 25/25 SQL/unitarias previas reutilizadas; candidato compilado y público PASS
  con devoluciones ficticias y bloqueo técnico de Inventario general. Puntos,
  Altas, Averías y Rutinas PASS; panel HTTPS/API sanos. Sin mutaciones reales.
- Sin SQL/migraciones, permisos nuevos ni reinicio de backend u otros servicios.
- Estado: devoluciones de materiales y equipos seriados implementadas,
  desplegadas y validadas funcionalmente. Frontend `c11f6a8`, backend `16831c6`.
- Validación expresa del propietario el **26/10/2026**: devolución desde App
  de Campo en Android y recepción administrativa probadas satisfactoriamente.
  **Ambas pruebas COMPLETADAS; flujo probado y cerrado.**
- No registrar devolución o recepción como pendientes ni repetir pruebas
  anteriores. Las notas antiguas de aceptación pendiente son antecedentes
  superados por este cierre. No se hicieron nuevas pruebas, despliegues,
  consultas productivas ni cambios de datos en esta actualización.
- Rollback preparado, no usado. Conservar toda la cadena existente y añadir
  al final `/opt/smartrayco-staging/campo-returns-c11f6a8-20261026T171151Z/frontend.override.json`.
- Respaldo verificable: `/opt/smartrayco-staging/campo-returns-c11f6a8-20261026T171151Z/recovery/frontend.tar`;
  SHA256 `bf917fd96b749f9c9ff97816c1c76496537063260324fb6456ad31cd6edb8f58`. Candidato y respaldo OCI verificados.
- Informe y comando exacto de rollback:
  `docs/CUSTODIA-DEVOLUCIONES-CORRECCION-LOCAL.md`.

### Resultado vigente: corrección de contadores activada (2026-10-26 16:28 UTC)

**Muestreo recuperado: 360 filas nuevas confirmadas en base de datos.**
Fase 175 está desplegada y operativa. El HTTP 400 por URL excesiva quedó
corregido mediante consultas de contadores por lotes de 100 UUID. No sigue
siendo un incidente activo: los intentos fallidos que aparecen más abajo
son antecedentes. La migración SQL de optimización
`20261026130000_fase175_traffic_anomalies_lateral.sql` permanece sin aplicar
según la evidencia registrada; la recuperación no dependió de ella.
Commit local aislado `16831c6c3597c1e7495a4f2230566a44c3e2b2cd`, padre
`53f284c70c967b164ff4fa7a8403f3238c2bfbc7`; no se hizo push ni merge.

- Backend: `sha256:6631d4a124b631f7bedd3d8c2b6f6c8ab7e524e264385ae2fae2b46e3f67047e`.
- Contenedor: `1a0c00376d3b2cd5ff623e90e8050bc092deb7602976b35d852179cb54f360a9`.
- Primer muestreo: `2026-10-26T16:28:28.173+00:00`; 360 muestras nuevas,
  665 contratos comprobados, solo Administrador 2116 (`pppoe_admin`), sin
  errores reportados. Run `bec0e794-242c-4517-a753-22463bdc0a2d`.
- Panel/API saludables; Puntos (Avería/Alta/Rutina) PASS con datos ficticios.
  Frontend, Caddy, Mongo y GenieACS sin sustituciones ni reinicios.
- Balanceador independiente: 24 muestras nuevas tras el arranque del backend,
  todas online, última observada `2026-10-26T16:28:08.425+00:00`.
- Pruebas: 17/17 locales y del runtime candidato aislado. Casos 3.000,
  3.001 y 5.000 contratos; URLs máximas de ruta+query 4.023 bytes; fallos
  tardíos descartan resultados parciales.
- Requisito permanente: SmartRayco debe escalar a al menos 3.000 clientes.
  La prueba valida esta lectura de contadores; falta validar el muestreo
  integral a esa escala, la consulta inicial de contratos sin paginación y
  el presupuesto de latencia del watchdog de 120 segundos. No se certifica
  capacidad integral productiva de 3.000 clientes con pruebas de transporte simulado.
- Seguimiento de ciclos y certificación integral son pendientes separados;
  no impiden reconocer la recuperación productiva ya confirmada.
- No se aplicó SQL ni se reconstruyó frontend. Rollback preparado y no ejecutado.
- Informe y comandos exactos: `docs/FASE175-CONTADORES-ACTIVADOS-20261026.md`.

Conservar todos los overrides anteriores y agregar al final el nuevo
`/opt/smartrayco-staging/fase175-counters-16831c6-20261026T162650Z/backend.override.json`.
El frontend conserva su configuración previa; al operar Compose desde otro
servicio no se debe omitir el override nuevo del backend.

### Histórico: resultado del reintento único (2026-10-26 16:03 UTC)

**Al terminar ese reintento ambas imágenes de Fase 175 estaban activas; Analítica todavía no estaba corregida.**
No hubo rollback en este reintento ni fallos críticos de disponibilidad.
Se aprobaron las pruebas positivas y negativas del comparador Env antes de
promover. Se revalidaron hashes de candidatos y respaldos, sin reconstruir.

- Backend: `sha256:e0bb1e7b2e3011675a5b0d8484a00ee7106302a25094996098a5297df4c3f6bd`.
- Frontend: `sha256:3155f928b6b5492c9f4398e3a7601ad442a0b5b6f866bbbe637d89b7df05d959`.
- Panel/API saludables; tres pantallas de Puntos PASS con datos ficticios,
  cero mutaciones y excepciones. Caddy, Mongo y GenieACS sin reinicios.
- Primer ciclo automático a las 15:58:19 UTC: un router (Administrador 2116),
  cero muestras, `Bad Request`. Base confirma cero muestras nuevas.
- Diagnóstico focalizado de solo lectura: Administrador responde y entrega
  668 interfaces; consulta de contratos entrega 711. El HTTP 400 procede de
  Supabase al leer `/rest/v1/mikrotik_traffic_counters_state`, cuerpo
  `Bad Request`, tipo `text/plain; charset=utf-8`, sin details/hint/code.
  No es un HTTP 400 del router en esta reproducción.
- Balanceador: 144 muestras nuevas posteriores al arranque, última
  `2026-10-26T16:02:33.115+00:00`; monitoreo independiente operativo.
- Sin SQL, cambios en routers, push/merge ni muestras históricas modificadas.
- Estos antecedentes se conservan en esta sección; el resultado vigente
  está en `docs/FASE175-CONTADORES-ACTIVADOS-20261026.md`.

Overrides: conservar la cadena original de Puntos y ambos overrides
`backend.override.json` / `frontend.override.json` del stage Fase 175.
El backend conserva además `backend.rollback.json` antes de su override
candidato; el último override determina la imagen. No usar safe-update.sh.

**Importante — backend y frontend NO están en el mismo commit.** Se
conservan bases productivas por servicio: Puntos en el frontend y la
corrección `16831c6` en el backend. Esto es intencional (despliegue
selectivo por servicio), pero significa que **cualquier
despliegue que reconstruya "todo desde main" sin cuidado retrocedería uno
de los dos componentes**.

### Intento autorizado de Fase 175 y rollback (2026-10-26 15:51 UTC)

**Histórico del primer intento: Fase 175 no permaneció activa al terminar ese intento.**
El candidato backend `smartrayco-backend-fase175:53f284c-20261026T154532Z`
se promovió brevemente; el verificador comparó `Config.Env` como lista y
detectó una diferencia de orden. Se ejecutó rollback inmediato conforme a
la autorización. La verificación posterior confirmó igualdad por nombre y
valor (ninguna variable diferente); el control fue corregido, sin reintentar.
El frontend candidato nunca se promovió.

- Backend activo: `sha256:9d7993fab63ebe5f525c7bb5202f6c71c9d2bfc39bed77cb0d68fbe0212a194d`.
- Contenedor backend restaurado: `4a7bdc84180a171ebae2efd269885f9028f6801d32b49a947ad8bdbc6fd2cb95`.
- Frontend, Caddy, Mongo y GenieACS: mismos contenedores, imágenes y fechas
  de arranque del preflight.
- Cadena Compose del backend restaurado: conservar los cuatro archivos
  originales del frontend (base + tres overrides de Puntos), más
  `/opt/smartrayco-staging/fase175-20261026T154532Z/backend.rollback.json`.
- Panel/API y rutas de Puntos: HTTP 200; API `ok`.
- Balanceador: 24 muestras nuevas posteriores al rollback, 24 online,
  última `2026-10-26T15:52:16.133+00:00`.
- Analítica restaurada: cero muestras nuevas; última muestra sigue en
  `2026-10-15T16:24:34.152+00:00`. Scheduler anterior informa
  `Administrador 2116: Bad Request`; no informa código HTTP ni detalle.
- No se aplicaron migraciones, configuraciones de routers ni cambios de datos
  manuales. El muestreo y monitoreo automático existente continuó normalmente.
- Antecedente conservado aquí; la activación posterior está documentada en
  `docs/FASE175-CONTADORES-ACTIVADOS-20261026.md`.

Antes del reintento se debía revalidar contra ese estado restaurado,
no exigir el ID/arranque backend anterior al rollback. Las imágenes candidatas
y respaldos permanecen disponibles. No usar `safe-update.sh`.

### Preparación original de Fase 175 (histórico; promovida en el reintento anterior)
Preparada y probada en 2 worktrees aislados:
- `b4856fd` → `8bfbefd` → `147c515` → `da9a6bc` (en ese orden), ya en
  `origin/main` (push autorizado y confirmado).
- Verificada limpia (cherry-pick sin conflictos, `vue-tsc`, `vite build`,
  11/11 pruebas unitarias, 6/6 equivalencia SQL) tanto sobre `b379028`
  (backend) como sobre `87ddfd3` (frontend) — ver sesión del 2026-10-26.
- Migración SQL (`20261026130000_fase175_traffic_anomalies_lateral.sql`)
  preparada, con rollback probado, **sin aplicar**.

## El mecanismo real de despliegue (verificado por lectura directa, no inventado)

SmartRayco en producción usa **2 mecanismos distintos**, y hay que saber
cuál corresponde a cada caso:

### A. Despliegue completo (el "oficial", documentado en `deploy/`)
`deploy/safe-update.sh <commit>` — exige exactamente 1 commit entrante
(o `DEPLOY_ALLOW_MULTI_COMMIT=1` explícito), reconstruye **ambos** servicios
desde el checkout `/opt/smartrayco` (que sigue la rama `main`), y respalda
las imágenes salientes con un tag `rollback-<timestamp>`. Rollback:
`deploy/rollback.sh <tag>`.
**Riesgo para hoy**: si se usa esto apuntando a `main`/`da9a6bc`, arrastra
los 34 commits pendientes — no usar así mientras eso no esté autorizado.

### B. Despliegue selectivo por servicio (el que Codex usó para "Puntos")
No está en `deploy/` ni en git — es una **convención**, repetida en
`/opt/smartrayco-staging/<nombre>-<sha-corto>-<timestamp>/` para cada
candidato:

1. **`source/`**: checkout del commit exacto a promover (no de todo `main`).
2. **Build multi-stage** con nombres propios del candidato:
   `smartrayco-<nombre>-build:<tag>` (compilado) y
   `smartrayco-<nombre>-base:<tag>` (runtime) → combinados por un
   `promotion/Dockerfile` minimo (`FROM ...-build AS compiled` + `FROM
   ...-base` + `COPY --from=compiled ...`) en la imagen final
   `smartrayco-<nombre>:<tag>`.
3. **Override de Compose** de 1 solo servicio — archivo tipo
   `{"services": {"frontend": {"image": "smartrayco-<nombre>:<tag>"}}}` —
   aplicado con
   `docker compose -f docker-compose.onprem.yml -f <override>.json up -d --no-build <servicio>`.
   Esto **nunca reconstruye ni toca los demás servicios** (confirmado: los
   manifiestos reales de Codex incluyen `"backendNotRestarted": true,
   "otherServicesUnchanged": true`).
4. **Respaldo antes de promover**: `recovery/` guarda la imagen saliente
   completa (`.tar`) + un snapshot del compose/estado anterior +
   `recovery-record-private.json`. Rollback = volver a aplicar el override
   que apunta a esa imagen anterior (ya tarreada, no hay que reconstruir).
5. Las promociones de un mismo servicio **se encadenan**: el override
   de frontend del antecedente Puntos (`single-close.override.json`) fue el 3er eslabón
   sobre 2 overrides anteriores de "Puntos" — cada uno documenta su propio
   `code`/`previousCode` (commit promovido / commit anterior).

**Esto es exactamente lo que permite desplegar Fase 175 sin tocar Puntos**:
un override nuevo, de 1 solo servicio a la vez, nunca reconstruye el otro.

## Procedimiento concreto para desplegar Fase 175 sin perder Puntos

**Procedimiento original; el resultado ejecutado vigente está documentado arriba.**

### Backend (independiente del frontend)
1. Construir `smartrayco-backend-fase175:<sha-corto>-<timestamp>` desde el
   worktree aislado ya verificado (`scripts/inventory-auth-lab/runtime/
   fase175-trafico-selective-worktree`, base `b379028` + los 4 commits).
2. `recovery/`: respaldar la imagen saliente actual
   (`smartrayco-backend:latest`) como `.tar` + metadata, igual que el patrón
   ya usado para frontend.
3. Override de 1 solo servicio: `{"services": {"backend": {"image":
   "smartrayco-backend-fase175:<tag>"}}}`, aplicado con `up -d --no-build
   backend` — el frontend (y su imagen `single-close`) nunca se toca.

### Frontend (independiente del backend, preservando Puntos)
1. **No partir de `b379028`** — partir de la base REAL activa (`87ddfd3`,
   la misma que ya corre). Ya está construido y probado en el segundo
   worktree aislado (`.../fase175-frontend-base-worktree`), que YA incluye
   todo "Puntos" + Fase 175 encima.
2. Build multi-stage igual al patrón de `single-close` →
   `smartrayco-frontend-fase175:87ddfd3+fase175-<timestamp>`.
3. `recovery/`: respaldar la imagen `single-close` actual (o reusar su tar
   si Codex lo conservó).
4. Nuevo override, **encadenado sobre `single-close.override.json`** (no en
   su lugar): `{"services": {"frontend": {"image":
   "smartrayco-frontend-fase175:<tag>"}}}`, aplicado con `up -d --no-build
   frontend`.

### Por qué un despliegue no puede sustituir al otro por accidente
Cada paso usa `--no-build <servicio-especifico>` sobre una imagen ya
construida y nombrada — Compose nunca reconstruye un servicio que no se
menciona en el comando. Mientras no se use `docker compose up -d --build`
(sin especificar servicio) desde `/opt/smartrayco` apuntando a `main`, los
34 commits pendientes y ningún otro servicio se ven afectados.

## Qué falta
- Observar continuidad de ciclos posteriores y calidad de tasas tras los
  estados antiguos; el primer ciclo nuevo ya está confirmado.
- Validar capacidad integral de al menos 3.000 clientes: recuperación completa
  de contratos, límites REST/paginación y carga real dentro del watchdog.
- No ampliar el cambio desplegado ni aplicar SQL sin nueva autorización.
