# Ventana combinada: Fase 163 (postergar Altas) + Inventario

17/10/2026, 13:20 h Lima. Continúa desde `4bbfa9a`/`b9fb172` (Fase 163) y
`11ca0ca`/`docs/INVENTARIO-PRODUCCION-VENTANA.md` (Inventario). **BLOQUEADO
para iniciar** — misma causa que ayer, trabajo técnico real distinto: hay
operaciones de Campo en curso. No se ejecutó ninguna migración ni
despliegue. No se tocó la orden real de Jadir.

## 1. Estado de Campo (solo lectura, 17/10/2026 13:15 h Lima)

- **2 sesiones de Campo abiertas**: la Alta de **Jadir Zavaleta**
  (`installations.id 39a453b0…`, `job_work_sessions.id 665db122…`, iniciada
  11:01 h Lima — el mismo caso real de esta Fase 163, **sigue activa, sin
  modificar**) y una Rutina (`id 9260605f…`, iniciada 13:07 h Lima).
- 0 Averías en progreso, 0 Instalaciones completadas de más.
- No se cerró, pausó ni reasignó ninguna orden para hacer este chequeo.

## 2. Dependencias entre piezas (verificado, no solo documentado)

| Pieza | Depende de | Verificado |
| --- | --- | --- |
| Fase 163 (`installation_postponements`/`postpone_installation`) | Nada | Aislada: no toca inventario ni Etapa 3/RLS |
| Etapa 3 (`campo_inventory_operations`) | Nada | Permite operar sobre `installations.status='pending'` (ya existía antes de Fase 163; Fase 163 no amplía ni reduce ese permiso) |
| Cierre RLS (`inventory_order_read`, `inventory_get_albums`, `inventory_admin_only`) | Etapa 3 (`inventory_ticket_review` inserta en `campo_inventory_operations`) | Ya confirmado en sesión previa (`ESTADO_DESARROLLO.md`, "Bloqueos de activación final resueltos") |

Las tres piezas son compatibles entre sí: ninguna modifica los mismos
objetos que otra, y los permisos de Etapa 3/RLS sobre `installations`
(estado `pending`, igual que deja una Alta postergada) ya existían antes
de esta tarea — Fase 163 no cambia ese comportamiento.

## 3. Hallazgo nuevo de esta sesión: hotfix de cuadrillas ausente de `main`

Producción (revisión activa `592d282`, confirmada igual que ayer vía SSH
read-only) tiene un hotfix de cierre de cuadrilla **ya aplicado en
Supabase Cloud** (confirmado por lectura: existen
`set_current_job_crew`, `assert_current_job_operator`,
`guard_job_completion_crew`, `lock_job_crew_parent`) que **no está en el
historial de `main`** — vive en la rama/worktree separada
`hotfix/cierre-alta-cuadrilla` (`revision-fase2/hotfix-cierre-alta/`,
documentada en `docs/CUADRILLAS-DESPLIEGUE-RESULTADO.md` de esa misma
rama, desplegada y estable, con validación de sesión real pendiente —
nada de esto se tocó). El ancestro común real de `main` y `592d282` es
`ccdf94f`, no `592d282` en sí.

Fase 163 se desarrolló sobre `main` (que no conoce este hotfix). Antes de
declarar compatibilidad, se verificó **de forma empírica, no solo por
lectura del SQL**: `server/tests/installationPostponementHotfixCompat.sql.test.ts`
(4 pruebas nuevas, no repite las 23 ya aprobadas) carga los triggers
reales del hotfix junto a la migración de Fase 163 en PostgreSQL 17
aislado — las 4 pasan, incluida la reasignación posterior por
administración con el RPC real `set_current_job_crew` (no un `insert`
directo). **Compatible, confirmado.**

Recomendación (no ejecutada en esta tarea, fuera de alcance): fusionar
`hotfix/cierre-alta-cuadrilla` a `main` en algún momento para que el
historial de migraciones deje de estar incompleto — es una tarea de
higiene de git, no funcional, y no se abrió como fase nueva aquí.

## 4. Paquete exacto preparado

Commit local `ef8adfa6e552af7696bf9819a89e5d7fe3b790cf`, tag
`candidato-inventario-fase163`, padre `592d282` (índice aislado, no tocó
`HEAD` ni los fuentes de trabajo — mismo método que `4e967d0`).
`vue-tsc -p tsconfig.app.json --noEmit` y `vite build` limpios sobre este
candidato exacto (worktree desechable, ya eliminado).

Contenido: los 31 archivos ya validados de Inventario (`4e967d0`, sin
cambios) **más**:

- **Fusión real de tres vías** (`git merge-file`, 0 conflictos, sin
  marcadores) en `CampoTrabajoDetailView.vue`, `installations.ts`,
  `jobAssignees.ts`, `campo.ts` — base `ccdf94f` (ancestro común
  verificado sin deriva para estos 4 archivos), una rama es el hotfix
  (`592d282`), la otra es Fase 163 (`4bbfa9a`).
- `InstalacionDetailView.vue`, `domain.ts`, `InstalacionesView.vue`: 3
  archivos donde Fase 163 es la única rama que los toca (verificado sin
  diff competidor de Inventario ni del hotfix) — se usa su versión
  directa.
- `supabase/migrations/20261017010000_fase163_postergar_instalaciones.sql`
  agregada al paquete.

Nada ajeno: no se incluyó ningún archivo de "Devolver rutinas" (Fase 161)
ni de las 73 sesiones de preparación de Inventario sin commitear — mismo
criterio de exclusión ya documentado en `ESTADO_DESARROLLO.md`.

## 5. Orden exacto propuesto

1. **Respaldo** — el de `activacion_final_completo_20261016_233807_8dda07bc`
   sigue vigente: inventario sin ninguna escritura desde entonces
   (verificado de nuevo hoy, mismos conteos/última escritura). No se
   generó uno nuevo porque no hace falta todavía; sí se debe tomar uno
   fresco inmediatamente antes de ejecutar, igual que la práctica ya
   documentada.
2. **Fase 163** (`20261017010000_fase163_postergar_instalaciones.sql`) —
   va primero por ser la más chica, la más nueva y completamente aislada
   (ninguna otra pieza la toca); sirve de verificación de que la ventana
   está realmente libre de actividad antes de tocar inventario.
3. **Etapa 3** (`20261016010000_campo_inventory_operations.sql`).
4. **Cierre RLS** (`20261016220000_inventario_contextual_rls_admin.sql`) —
   depende de que Etapa 3 ya esté aplicada.
5. **Postchecks** — además de los ya documentados para Etapa 3/RLS:
   confirmar `to_regprocedure('public.postpone_installation(uuid,text)')`
   y la tabla `installation_postponements` existen, RLS activa, y que la
   RPC/trigger del hotfix de cuadrillas sigue con el mismo MD5 (sin
   deriva — no se reaplica ni se toca ese hotfix).
6. **Desplegar frontend/backend** desde el candidato `ef8adfa`
   (`candidato-inventario-fase163`), con `--no-deps --no-build --pull
   never frontend backend`, igual que el plan ya aprobado para
   Inventario.

## 6. Rollback de Fase 163

Trivial por ser objetos nuevos sin consumidores todavía:

```sql
BEGIN;
DROP FUNCTION IF EXISTS public.postpone_installation(uuid, text);
DROP TABLE IF EXISTS public.installation_postponements;
COMMIT;
```

Sin riesgo de pérdida de datos reales (nada la referencia aún). Si ya se
usó en producción antes de un rollback, **no** ejecutar el DROP — se
perdería el historial de postergaciones reales; revertir solo el
frontend y dejar la función/tabla intactas (mismo criterio que el
rollback de Fase 161 ya documentado).

## 7. Pruebas funcionales preparadas (sin repetir las 23 ya aprobadas)

- **Postergación + permisos**: las 23 pruebas ya aprobadas
  (`test:installation-postponements-sql`) + las 4 nuevas de
  compatibilidad con el hotfix real (`installationPostponementHotfixCompat.sql.test.ts`,
  no tiene script npm todavía, se corre con
  `node --import tsx --test server/tests/installationPostponementHotfixCompat.sql.test.ts`).
- **Búsqueda por serie/MAC/nombre/modelo**: `src/lib/__tests__/inventorySearch.test.ts`
  (15 pruebas, ya existente — nombre/modelo/serie completa y parcial/MAC
  con cualquier separador/álbumes/paginación/denegación RLS) — **15/15
  en verde**, confirmado hoy, sin tocar su código.

## 8. Estado

**BLOQUEADO para ejecutar** — única causa pendiente: coordinar que
terminen o se pausen la Alta de Jadir y la Rutina activa. Todo lo demás
(dependencias, compatibilidad con el hotfix de cuadrillas, paquete exacto,
orden, respaldo, rollback, pruebas) está verificado y listo. En cuanto no
haya instalaciones/averías/rutinas en `in_progress` ni sesiones de Campo
abiertas, se puede autorizar la ventana con el orden de la sección 5.
