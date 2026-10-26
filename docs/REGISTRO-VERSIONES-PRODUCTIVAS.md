# Registro de versiones productivas — SmartRayco

Archivo de continuidad para **Claude Code y Codex por igual**. Objetivo: que
ninguna de las dos herramientas sobrescriba por accidente un trabajo ya
aprobado y en vivo de la otra. Antes de desplegar backend O frontend,
**leer este archivo primero** y actualizarlo después de cada despliegue real
(no al preparar/probar — solo cuando algo se promueve de verdad a
producción).

Verificado por lectura directa de los contenedores/imágenes reales de la VM
el 2026-10-26 (sin modificar nada) — no es una suposición desde git.

## Estado actual (2026-10-26)

| | Backend | Frontend |
|---|---|---|
| Commit base real | `b379028` (Fase 174b) | `87ddfd3` (fix puntos: cierre administrativo) |
| Commit anterior | — | `397484c` |
| Imagen activa | `smartrayco-backend:latest` | `smartrayco-single-close:87ddfd3-20261026T054949Z` |
| Construida vía | `docker compose build` normal, checkout `/opt/smartrayco` | build multi-stage + override, `/opt/smartrayco-staging/single-close-87ddfd3-20261026T054949Z/` |
| Desplegado | 2026-10-24 ~21:25 UTC | 2026-10-26 05:58:19 UTC |
| Funcionalidades incorporadas | Fase 36…174b (hasta alertas de enlace WAN del balanceador) | Todo lo anterior + módulo "Puntos" (fidelización/órdenes) hasta `WorkOrderPointsEditor.vue` (cierre administrativo en 1 acción) |
| Rollback | ver abajo | `recovery/` del mismo stage (imagen previa `397484c` ya respaldada en tar) |

**Importante — backend y frontend NO están en el mismo commit.** El
frontend va 1-2 commits de "Puntos" adelante del backend porque esos
commits solo tocaban Vue, nunca `server/`. Esto es intencional (despliegue
incremental por Codex), no un error — pero significa que **cualquier
despliegue que reconstruya "todo desde main" sin cuidado retrocedería uno
de los dos componentes**.

### Fase 175 (Analítica de Tráfico / diagnóstico MikroTik)
Preparada y probada en 2 worktrees aislados — **NO desplegada todavía**:
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
   activo de frontend hoy (`single-close.override.json`) es el 3er eslabón
   sobre 2 overrides anteriores de "Puntos" — cada uno documenta su propio
   `code`/`previousCode` (commit promovido / commit anterior).

**Esto es exactamente lo que permite desplegar Fase 175 sin tocar Puntos**:
un override nuevo, de 1 solo servicio a la vez, nunca reconstruye el otro.

## Procedimiento concreto para desplegar Fase 175 sin perder Puntos

**No ejecutado todavía — requiere autorización explícita por separado.**

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
- Ejecutar lo anterior (build + override + verificación) — pendiente de
  autorización explícita, paso por paso.
- Confirmar con Codex/el equipo que este documento refleja su propio
  mecanismo correctamente antes de que Claude lo use para desplegar algo
  por primera vez.
