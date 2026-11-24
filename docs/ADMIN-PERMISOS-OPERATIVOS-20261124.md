# Ampliación de permisos operativos de ADMIN (paridad con SUPERADMIN) — 24/11/2026

**Ajuste final de alcance (mismo día, antes de publicar):** el propietario
pidió que 4 operaciones queden EXCLUSIVAS de SUPERADMIN, sin ampliar a
ADMIN — se revirtieron solo esas 4, en frontend, backend/RPC, triggers y
RLS, conservando toda la auditoría ya agregada. Este documento refleja el
**alcance final**, no el intermedio. Ver sección 2 para la lista exacta.

Implementado y probado **solo localmente**, en rama aislada
`feature/admin-permisos-operativos-20261124` (worktree
`scripts/inventory-auth-lab/runtime/admin-permisos-worktree`), sobre la
base REAL en producción (`origin/main` al momento de empezar, confirmado
con `git fetch`). **No desplegado, no aplicado en Supabase real, no
publicado en GitHub.**

## 1. Metodología

Antes de escribir una sola línea, se auditó la implementación REAL (no
supuesta) en 3 frentes en paralelo — frontend (62 archivos con
"SUPERADMIN"), backend (26 archivos) y Supabase (políticas RLS +
funciones RPC + triggers, leídos con `pg_get_functiondef`/`pg_policies`
contra la base real `mzupdnjegfwmpajywckd`, solo lectura). Cada hallazgo
de la auditoría se **reverificó en vivo** antes de tocar nada — varias
veces el hallazgo inicial no coincidía con el estado real (ver sección 6,
"Correcciones durante la propia auditoría").

## 2. Matriz de permisos — actual vs. nueva

| Módulo | Acción | Antes | Ahora | Mecanismo real |
| --- | --- | --- | --- | --- |
| Inventario | Desactivar producto | SUPERADMIN | **+ADMIN** | trigger `guard_inventory_product_deactivation` |
| Inventario | Eliminar unidad serializada | ADMIN (ya) | ADMIN (ya) | policy `inventory_admin_only` — sin cambio de permiso, solo se agregó auditoría |
| Inventario | Revertir movimiento de Kardex | ADMIN (ya, UI bloqueaba) | **+ADMIN (UI)** | sin RLS propia; cambio solo de frontend |
| Clientes/Contratos | Eliminar contrato | ADMIN (ya) | ADMIN (ya) | `service_contracts_staff_only` — sin cambio de permiso, solo de frontend |
| Clientes/Contratos | **Cancelar contratación no instalada** | SUPERADMIN | **SUPERADMIN (sin cambio — decisión final)** | RPC `contract_cancel_unfulfilled`, revertida antes de publicar |
| Facturación | Editar factura ya creada | ADMIN (ya, UI bloqueaba) | **+ADMIN (UI)** | sin RLS propia; cambio solo de frontend (`canEditInvoice`) |
| Facturación | **Eliminar factura** | SUPERADMIN | **SUPERADMIN (sin cambio — decisión final)** | policy `invoices_delete_superadmin`, revertida antes de publicar (`canDeleteInvoice` en frontend) |
| Altas | Editar/reabrir una instalación `completed`/`cancelled` (edición excepcional) | SUPERADMIN | **+ADMIN** | policy `installations_update_staff` |
| Altas | Tocar la cuadrilla de una instalación cerrada | SUPERADMIN | **+ADMIN** | policy `job_assignees_write_dispatch` |
| Altas | Formulario web "Completar instalación" | SUPERADMIN | **sin cambio, a propósito** | decisión deliberada de Fase 166 — ver sección 5 |
| Averías/Rutinas | Editar orden resuelta/cerrada | ADMIN (ya) | ADMIN (ya) | `tickets_update_staff`/`routines_update_staff` nunca excluyeron a ADMIN — sin cambio |
| Mapa de red | **Eliminar NAP/MUFA/cable/hilo del mapa en vivo** | SUPERADMIN | **SUPERADMIN (sin cambio — decisión final)** | RPC `remove_from_network_map`, revertida antes de publicar (`canDeleteMapPassive` en frontend) |
| Mapa de red | **Desvincular extremo de cable ya conectado** | SUPERADMIN | **SUPERADMIN (sin cambio — decisión final)** | trigger `guard_cable_endpoint_unlink`, revertido antes de publicar (sin gate de frontend, nunca lo tuvo) |
| Mapa de red | Baja digital de elementos pasivos (catálogo) | ADMIN/TECNICO_RED (ya) | sin cambio | `guard_map_passive_delete` ya los incluía |
| Asistencia | Configurar horarios personales/feriados | SUPERADMIN | **+ADMIN** | triggers `asistencia_horario_personal_guard`/`asistencia_feriado_guard` + policy de escritura |
| Asistencia | Resolver ausencias reportadas | SUPERADMIN | **+ADMIN** | RPC `resolver_ausencia` (+ bug de auditoría corregido, ver sección 4) |
| Asistencia | Programar/cancelar intercambios de turno | SUPERADMIN | **+ADMIN** | RPC `asistencia_intercambio_crear`/`_cancelar` |
| Asistencia | Crear/cancelar novedades (vacaciones, descansos, permisos) | SUPERADMIN | **+ADMIN** | RPC `asistencia_novedad_crear`/`_cancelar` |
| Asistencia | Ver horarios/intercambios/novedades/solicitudes de TODO el personal (no solo las propias) | SUPERADMIN | **+ADMIN** | policies `asistencia_*_lectura` ampliadas |
| Asistencia | Ver el historial de auditoría de configuración | SUPERADMIN | **+ADMIN** | policy `asistencia_config_auditoria_lectura` |
| ONT/OLT/TR-069 | Todo | ADMIN (ya) | ADMIN (ya) | ya compartido en frontend, backend y SQL — nada que ampliar |
| Técnicos | Todo | sin cambios | sin cambios | fuera de alcance a propósito (punto 7 del pedido) |

## 3. Se mantiene exclusivo de SUPERADMIN

**Por pedido final del propietario (ajuste del mismo día, antes de publicar) — revertido después de haberse ampliado:**

- **Cancelar una contratación no instalada** (`contract_cancel_unfulfilled`).
- **Eliminar una factura** (`invoices_delete_superadmin`).
- **Eliminar un elemento del mapa en vivo** — NAP/MUFA/cable/hilo (`remove_from_network_map`).
- **Desvincular un extremo de cable ya conectado** (`guard_cable_endpoint_unlink`).

Las 4 fueron ampliadas a ADMIN en un primer pase, probadas, y luego
revertidas EXACTAMENTE antes de publicar — frontend, RPC, triggers y RLS.
La auditoría agregada para estas 4 (`log_admin_audit` dentro de
`remove_from_network_map`, y el log ya existente de
`fo_cable_endpoint_unlink_log`) **se conservó intacta** — solo se revirtió
quién puede ejecutar la acción, nunca el registro de quién la ejecutó.
Verificado expresamente con la suite SQL aislada que ADMIN no puede
ejecutar ninguna de las 4 ni por acceso directo a Postgres/RLS (ver
sección 8).

**A propósito, no tocado (sin relación con el ajuste de arriba):**

- **Gestión de roles/cuentas de staff** (`routes/users.ts`, `UsuariosView.vue`): crear, editar, eliminar cuentas, cambiar el rol de alguien, resetear contraseña ajena.
- **Guarda anti-escalamiento** `trg_profiles_authorization_guard`/`guard_profile_authorization()` — ya aplicada en producción (vive en la rama `fix/profiles-role-security-20261119`, no en `main`); **no se tocó, no se recreó, no se debilitó**. Solo se le agregó un trigger de auditoría nuevo e independiente (`trg_profiles_audit_role_change`) que no cambia quién puede hacer qué.
- **Cierre administrativo definitivo** (`guard_final_work_order()`/`work_order_point_confirmations`): bloquea a TODOS, incluido SUPERADMIN, una vez que una orden tiene confirmación administrativa de puntos. No es una distinción de rol — es una guarda de integridad que no se tocó.
- **Infraestructura sensible**: Proxmox, XUI, credenciales — ya estaban fuera del `SUPERADMIN`-exclusivo (Proxmox ya comparte con ADMIN) o son configuración de infraestructura, no se tocaron.
- **Exención de asistencia de SUPERADMIN** (`exentoDeAsistencia`): es una regla de identidad (SUPERADMIN no marca asistencia), no una capacidad operativa — no aplica ampliarla.

## 4. Acciones sin auditoría detectadas y corregidas

Antes de este cambio, estas 4 acciones críticas no dejaban ningún rastro
de quién/cuándo/qué (más allá de un `updated_at` genérico o nada en
absoluto):

1. **Eliminar una factura** — el `DELETE` no dejaba ninguna fila ni log.
2. **Desactivar un producto de inventario** — el trigger solo bloqueaba o permitía, nunca registraba.
3. **Eliminar una unidad serializada** — mismo problema, `DELETE` sin rastro (el Kardex de movimientos SÍ tiene buena trazabilidad; esto era aparte).
4. **La edición excepcional de una Alta ya cerrada** — el `UPDATE` pasaba sin dejar registro de qué cambió ni por qué, más allá de `updated_at`.

Corregidas con una tabla genérica reutilizable `admin_audit_log` (actor,
rol del actor, tabla, acción, entidad, antes/después en JSON, motivo
opcional, fecha) — insert-only, sin política de `update`/`delete` para
ningún rol (mismo patrón ya probado en `olt_alert_log`/
`fo_cable_endpoint_unlink_log`). También se agregó auditoría a los
**cambios de rol/activación de cuentas** (`profiles`), que tampoco tenían
ningún rastro — ver limitación conocida abajo.

**Bug de auditoría encontrado y corregido de paso**: `resolver_ausencia()`
insertaba el texto literal `'SUPERADMIN'` como `actor_rol` en
`asistencia_solicitud_eventos`, sin importar quién de verdad resolvía. Con
ADMIN habilitado, el registro habría mentido sobre el actor real. Ahora usa
el rol real de quien ejecuta la acción.

**Limitación conocida, documentada en la propia migración**: el cambio de
rol vía `PATCH /users/:id` (`server/src/routes/users.ts`) usa el cliente
`service_role` del backend, que no lleva el JWT del admin actuante — para
ESE camino específico, `admin_audit_log` registra el cambio con
`actor_id` NULL (se sabe QUÉ cambió y CUÁNDO, no QUIÉN desde la base).
Mejora futura **fuera de este alcance**: que ese endpoint pase el actor
explícito a la base.

## 5. Decisión deliberada que se dejó SIN ampliar

`canCompleteInstallationForm` (formulario web "Completar instalación" en
`InstalacionDetailView.vue`) sigue exclusivo de SUPERADMIN. Esto fue una
decisión explícita de **Fase 166**, documentada en el propio código: ADMIN
ya tiene una vía equivalente para marcar la instalación completada (el
selector de Estado, `canEditStatus`, que SÍ es compartido) — restringir
este formulario alternativo no le quita a ADMIN ninguna capacidad real. No
se tocó porque no es un vacío de permisos, es una redundancia evitada a
propósito. Si el propietario prefiere igualarlo también, es un cambio de
una línea (`auth.role === 'SUPERADMIN'` → `auth.isAdminOrAbove`).

## 6. Correcciones durante la propia auditoría (hallazgos reverificados)

- `inventory_units_delete_staff` (reportado por el primer pase como
  SUPERADMIN-exclusivo): al verificar contra la base real, esa policy **no
  existe** — la vigente es `inventory_admin_only` (`FOR ALL`), que **ya**
  incluye a ADMIN. No se tocó, solo se agregó la auditoría que faltaba.
- `fase151_proteger_ordenes_cerradas.sql` (migración candidata, su propio
  encabezado dice "PROPUESTA, no aplicada"): el mecanismo REAL y vigente en
  producción es la policy `installations_update_staff`, con una forma
  distinta a la de ese archivo candidato — se leyó y modificó la versión
  REAL, no el archivo de migración desactualizado.
- `guard_cable_endpoint_unlink()`/`fo_cable_endpoint_unlink_log` no existen
  en `main` — viven solo en la rama ya desplegada
  `release/mapa-control-total-superadmin-20261121`. Se recrearon en esta
  migración con el mismo comportamiento real verificado en producción
  (`pg_get_functiondef` contra la base real), sin arrastrar el resto de esa
  rama ni su historial de commits.
- `contract_cancel_unfulfilled` (RPC exclusiva de SUPERADMIN) **no apareció
  en el primer pase** de la auditoría de Clientes/Contratos — se encontró
  después, al revisar `server/tests/contractCancelUnfulfilled.sql.test.ts`
  (que sí la prueba) y se confirmó su definición real contra la base antes
  de ampliarla.

## 7. Archivos modificados

**SQL (nuevos):**
- `supabase/migrations/20261124120000_admin_operational_parity.sql`
- `supabase/rollback/20261124120000_admin_operational_parity_rollback.sql`
- `server/tests/adminOperationalParitySchema.sql`
- `server/tests/adminOperationalParity.sql.test.ts`

**Frontend:**
- `src/stores/auth.ts` (nuevo getter `isAdminOrAbove`, `isSuperAdmin` sin cambios)
- `src/views/inventario/InventarioView.vue`
- `src/views/inventario/InventarioProductoView.vue`
- `src/views/clientes/ClientServiceDetailView.vue`
- `src/views/instalaciones/InstalacionDetailView.vue`
- `src/views/facturacion/FacturacionView.vue`
- `src/lib/mapPassiveDeletion.ts` (ampliado y luego revertido — queda SUPERADMIN-only)
- `src/components/facturacion/FacturacionZoneAccordion.vue` (prop `isSuperadmin` separado en `canEdit`/`canDelete`)
- `src/views/asistencia/AsistenciaView.vue`
- `src/components/asistencia/AusenciasPanel.vue`
- `src/components/asistencia/HorariosPersonalesPanel.vue`
- `src/components/asistencia/IntercambiosPanel.vue`
- `src/components/asistencia/NovedadesPanel.vue`

Ningún archivo de `routes/users.ts`, `UsuariosView.vue`, `auth.ts`
(`isSuperAdmin`), Proxmox/XUI, ni la guarda anti-escalamiento fue tocado.

## 8. Pruebas

- **`server/tests/adminOperationalParity.sql.test.ts`** (PostgreSQL 17
  real en Docker, aislado, sin red, sin datos reales) — **28/28 PASS**:
  cada ampliación real (ADMIN ahora SÍ puede) con su contraparte negativa
  (TECNICO_RED sigue SIN poder); para las **4 operaciones revertidas**,
  prueba explícita de que **ADMIN sigue SIN poder** ejecutarlas por acceso
  directo a Postgres/RLS (lo más cercano a "API/Supabase directo" que se
  puede verificar en un entorno aislado) y que **SUPERADMIN sí puede**,
  sin cambios de comportamiento ni pérdida de auditoría; verificación de
  auditoría generada con el contenido correcto, el bug de
  `resolver_ausencia` corregido, inmutabilidad de `admin_audit_log` (ni
  SUPERADMIN puede editar/borrar una fila), visibilidad del historial
  restringida a ADMIN/SUPERADMIN, y un rollback de punta a punta (revierte
  el rol exacto de las operaciones SÍ ampliadas, confirma que NO borra
  auditoría ya escrita).
- Regresión, sin tocar: `server/tests/closedOrders.sql.test.ts` (20/20
  PASS) y `server/tests/contractCancelUnfulfilled.sql.test.ts` (14/14
  PASS) — ambos cargan su propio estado histórico de forma aislada, no se
  vieron afectados.
- `npm run test:fetch-timeout` (toda la suite `src/lib/__tests__`) —
  **596/596 PASS**, sin regresión por los cambios de frontend.
- `vue-tsc -p tsconfig.app.json --noEmit` — limpio, 0 errores.

**Límite de cobertura, declarado con honestidad**: no se agregó una prueba
SQL aislada específica para la ampliación de visibilidad de lectura en
Asistencia (`asistencia_*_lectura`, que ahora deja ver TODAS las filas a
ADMIN) — se verificó por lectura directa del SQL (antes/después) pero no
con un test ejecutado; mismo caso para la auditoría de cambios de rol vía
el camino `service_role` real de `users.ts` (se simuló el escenario, no se
tocó el backend real).

## 9. Procedimiento de despliegue (NO ejecutado — requiere autorización explícita)

1. Confirmar de nuevo, en vivo, que `main`/`origin/main` y la base real no
   divergieron desde esta auditoría (mismo principio que las sesiones
   anteriores — nunca asumir desde memoria).
2. Aplicar `supabase/migrations/20261124120000_admin_operational_parity.sql`
   contra Supabase real (`mzupdnjegfwmpajywckd`) — es solo SQL de roles/
   auditoría, no migra datos, no toca el frontend/backend desplegado.
3. Verificar en vivo (solo lectura): las 28 aserciones de la suite aislada
   tienen su equivalente real verificable por `pg_get_functiondef`/
   `pg_policies` tal como quedaron aplicadas.
4. No hace falta reconstruir ni redesplegar frontend/backend — los cambios
   de UI (`isAdminOrAbove`) solo destraban botones ya presentes; se
   publican con el siguiente release de frontend normal, cuando se
   autorice.
5. Actualizar `ESTADO_DESARROLLO.md` marcando esta fase como DESPLEGADA
   recién cuando el paso 2 se ejecute de verdad contra producción.

## 10. Rollback

`supabase/rollback/20261124120000_admin_operational_parity_rollback.sql` —
revierte CADA rol a su valor exacto anterior (texto literal verificado
en vivo), **sin borrar ninguna tabla ni fila de auditoría** (revertir
permisos nunca debe destruir historial ya escrito). Probado de punta a
punta en la suite aislada (aplicar migración → ejercer ADMIN → aplicar
rollback → confirmar que ADMIN vuelve a estar bloqueado → confirmar que la
auditoría previa sigue intacta → reaplicar la migración).

## 11. Commit

Local, sin push, sin aplicar a Supabase real, en la rama
`feature/admin-permisos-operativos-20261124` (worktree
`scripts/inventory-auth-lab/runtime/admin-permisos-worktree`), sin mezclar
los commits pendientes de `fix/mapa-eliminacion-pasivos-20261119`
(mapa-eliminación-pasivos, altas-contrato-obligatorio) ni ningún otro
cambio ajeno presente en el árbol de trabajo principal.
