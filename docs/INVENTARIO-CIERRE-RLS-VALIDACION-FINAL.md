# Cierre de permisos de Inventario — validación final

16-17/10/2026. Continúa desde el commit `c2f34b9`. Base de la migración:
`supabase/migrations/20261016220000_inventario_contextual_rls_admin.sql`.

## Veredicto

**LISTO PARA AUTORIZAR** la migración `20261016220000_inventario_contextual_rls_admin.sql`
— con dos condiciones obligatorias antes de aplicarla en cualquier entorno real
(ver «Antes de aplicar» más abajo). No se aplicó en ningún entorno real en esta
sesión (ni Cloud ni un Supabase local propio del proyecto — no existe uno
separado del laboratorio efímero descrito aquí). La búsqueda por
nombre/modelo/serie/MAC ya estaba lista y probada (commit `c2f34b9` y antes);
sin cambios funcionales en esta sesión.

## 1-4. Verificación en PostgreSQL aislado con JWT reales

Laboratorio: `scripts/inventory-auth-lab/security-*` (ya existente de la sesión
anterior, continuado aquí) — PostgreSQL 17 + GoTrue v2.197.0 + PostgREST
v14.18 reales, red Docker interna sin acceso a Internet ni a Cloud. Base
`inventory_security_lab`, clon por `pg_dump`/`pg_restore` del esquema base del
laboratorio (mismas tablas/triggers/funciones que produce la cadena normal de
migraciones del repo) — no es un esquema inventado a mano.

**Reconstruido desde cero en esta sesión** (no se reutilizó el resultado previo
sin volver a correrlo): se descartó la base y los contenedores de la corrida
anterior, se repreparó, se insertaron de nuevo los datos ficticios y se
reaplicó la migración ACTUAL (con las dos correcciones de esta sesión, ver
«Hallazgos corregidos» abajo) antes de validar. Evidencia:
`docs/INVENTARIO-CIERRE-RLS-LAB.json` — `jwtReal:true`, `cloudAccess:false`,
`fase162RpcUnchanged:true`, **25/25 PASS**, sin campo `failure` residual (a
diferencia del archivo que dejó la sesión anterior, que tenía un `failure` de
una corrida intermedia fallida junto a un `status:"PASS"` final — confirmado
como inofensivo pero se regeneró limpio para no dejar esa ambigüedad).

Cuentas con JWT reales firmados por GoTrue (no simulados, no `service_role`):
ADMIN, SUPERADMIN, SOPORTE, FACTURACION, y cuatro técnicos (`leader`/`support`
asignados vigentes, `removed` retirado de la cuadrilla, `outsider` ajeno).

Cubre explícitamente lo pedido:

- **ADMIN/SUPERADMIN**: `SELECT` directo a las 5 tablas administrativas y
  `inventory_get_albums()` — PASS. Búsqueda real (`inventorySearch.ts`) por
  nombre/modelo, serie y MAC, con paginación de álbum sin duplicar resultados
  — PASS.
- **Técnicos**: `SELECT` directo y `inventory_get_albums()` deniegan a los
  cuatro roles técnicos + SOPORTE + FACTURACION (cero filas, no solo error)
  — PASS. Lectura contextual (`inventory_order_read`) en Altas/Averías/Rutinas
  para `leader`/`support` — PASS; para `removed` (retirado) — denegado en las
  tres órdenes — PASS; `outsider`/FACTURACION denegados — PASS.
- **Altas/Averías/Rutinas conservan sus operaciones**: `campo_inventory_operation`
  concurrente entre dos técnicos autorizados, reintento exacto devuelve el
  mismo recibo (RETURNING/idempotencia), corrección y reversión conservan
  stock/Kardex, cierre de orden bloquea nuevas operaciones — todo PASS.
  `routine_inventory_operation` (Fase 162) probado consumiendo con reintento
  exacto tras reasignar la cuadrilla de la rutina — PASS, **y su definición
  SQL es *byte-identical* antes/después de aplicar esta migración** (hash
  comparado en `security-fixture.mjs`, `fase162RpcUnchanged:true`).
- Revisión de oficina (`inventory_ticket_review`) para SOPORTE, con reintento
  exacto y rechazo a `outsider`/FACTURACION — PASS. Equipo de otro contrato
  nunca aparece en el DTO de una orden — PASS. Administrador inactivo pierde
  tabla/álbum/contextual — PASS.

## Hallazgos corregidos en esta sesión (antes de validar)

1. **Fuga de notas administrativas a técnico/oficina.** Mi primera versión
   (sesión anterior) agregaba `'notes',u.notes` al DTO de unidad de
   `inventory_order_read` para no perder esa información en
   `InstalacionDetailView.vue` tras migrarla al RPC. El propio laboratorio lo
   detectó: su prueba de fuga ya exigía que `price`/`balance_after`/
   `total_value`/`notes`/`document_number` nunca aparezcan como clave en una
   lectura contextual de técnico. Corregido: la clave `notes` ahora se omite
   por completo (no solo su valor en `null`) salvo que el rol sea
   ADMIN/SUPERADMIN (`jsonb_build_object(...) || case when rol in
   ('ADMIN','SUPERADMIN') then jsonb_build_object('notes',u.notes) else '{}'
   end`). `InstalacionDetailView.vue` sigue mostrando las notas para
   ADMIN/SUPERADMIN exactamente igual que antes; un técnico simplemente no
   recibe esa clave (como ya le pasaba con precio/valor).
2. **Puerto de GoTrue desalineado en la utilería del laboratorio.** El
   laboratorio (de la sesión anterior) usaba `createClient(...).auth.signUp/
   signInWithPassword`, que antepone `/auth/v1` — pero este GoTrue, detrás de
   Caddy, se expone sin ese prefijo (confirmado: `/token` y `/signup` en la
   raíz responden 200; `/auth/v1/token` da 404). Esto habría impedido obtener
   JWT reales en cualquier corrida nueva. Corregido en
   `security-prepare.mjs`/`security-fixture.mjs`/`security-validate.mjs`: se
   pide el token/cuenta por la ruta real de GoTrue con `fetch` directo — el
   JWT sigue siendo igual de real (firmado por el mismo GoTrue), solo cambia
   cómo se obtiene. También se corrigió `common.mjs`/`config.json` (puerto
   54381→54382, el que el laboratorio realmente publica — `compose.json` ya
   lo tenía así desde el principio, era `common.mjs` el desalineado) y se hizo
   idempotente el primer paso del validador (antes fallaba al reconstruir
   desde cero por un `ADD CONSTRAINT`/`INSERT` no repetible). Todo esto es
   infraestructura de laboratorio bajo `scripts/inventory-auth-lab/runtime/`
   (en `.gitignore`) y los archivos `.mjs` del propio laboratorio — no toca
   ningún archivo de producción ni del panel.

## 5. Presentación del error en instalaciones canceladas

El RPC niega a propósito `materials`/`assigned` a un técnico cuando la orden
está `cancelled` (no está en la lista de estados cerrados que sí permite
lectura, a diferencia de `completed`) — es el comportamiento correcto, no un
bug. Antes de este cambio, `InstalacionDetailView.vue` mostraba ese 403 como
un mensaje de error en rojo («No se pudo cargar el inventario de esta
instalación»), alarmante para algo que no es un fallo.

Corrección **solo de presentación**, sin tocar autorización: nuevo helper
`src/lib/installationInventoryError.ts`
(`presentInstallationInventoryError(status, error)`) — si la instalación está
`cancelled`, no muestra ningún mensaje de error y deja que la vista caiga en
su estado normal de «sin materiales registrados» / «sin equipos asignados»
(ya existente, sin cambios); cualquier otro caso (retirado de la cuadrilla,
sesión vencida, orden completada, etc.) conserva su mensaje real sin
modificar. No hay lectura alterna, no hay dato mostrado de más, no hay ninguna
operación nueva habilitada — solo deja de alarmar por algo que no requiere
acción. 5/5 pruebas nuevas en `src/lib/__tests__/installationInventoryError.test.ts`.

## 6. Pruebas focalizadas nuevas (no se repiten las 51 ya aprobadas)

- `src/lib/__tests__/installationInventoryError.test.ts` — 5/5 PASS (punto 5).
- Laboratorio real `scripts/inventory-auth-lab/security-*` — 25/25 PASS con
  JWT reales (puntos 1-4), reconstruido desde cero en esta sesión.
- `vue-tsc -p tsconfig.app.json --noEmit` — limpio.
- No se repitieron las 51 pruebas sintéticas/TS ya aprobadas en `c2f34b9`
  (`orderInventory`, `fieldInventoryOperation`, `routineInventoryRequest`,
  `inventorySearch`, `inventoryAuthorization`, `fieldInventory`) — nada en su
  alcance cambió en esta sesión.

## 7. Rollback y postchecks

**Rollback** (si alguna vez se aplica y hay que revertir): esta migración
sustituye TODAS las políticas RLS existentes de `inventory_products`,
`inventory_categories`, `inventory_units`, `inventory_movements` e
`inventory_unit_events` por una sola política `inventory_admin_only`. Antes de
aplicarla en cualquier entorno con datos reales, **capturar primero las
políticas/grants exactos vigentes en ese entorno** (`pg_policies`/`pg_proc`
para `inventory_get_albums`) — no se incluye aquí un rollback SQL genérico
porque no se conoce el estado real de Cloud desde esta sesión (sin acceso a
Cloud). El propio laboratorio (`security-prepare.mjs`) deja ver exactamente
qué objetos tocó: 2 funciones nuevas (`inventory_order_read`,
`inventory_ticket_review`), 1 función reemplazada (`inventory_get_albums`,
solo agrega el guard de rol + revoke de EXECUTE público) y las políticas de
las 5 tablas. Revertir = restaurar esas políticas/grants exactos capturados
antes, y `drop function` de las dos funciones nuevas.

**Postchecks** (si se aplica alguna vez): repetir, con sesiones reales de ese
entorno, los 5 bloques del laboratorio — ADMIN/SUPERADMIN siguen viendo
catálogo y álbumes; un técnico con asignación vigente sigue viendo su orden;
un técnico retirado ya no ve nada; `campo_inventory_operation`/
`routine_inventory_operation` siguen aceptando consumos/reintentos; búsqueda
administrativa sigue funcionando para ADMIN/SUPERADMIN y sigue vacía para los
demás roles.

## Qué falta para autorizar la aplicación real (no se hace en esta sesión)

1. Decidir el entorno destino (Cloud de producción es el único real en este
   proyecto — no hay un Supabase local separado) y pedir explícitamente, en
   ese mismo turno, aplicar la migración — regla permanente del proyecto.
2. Antes de aplicar: respaldo fresco (mismo patrón ya usado para Fase 161/162)
   y captura de políticas/grants vigentes como se describe arriba.
3. Después de aplicar: correr los postchecks anteriores con sesiones/roles
   reales de ese entorno, no solo del laboratorio sintético.

No se tocó Cloud, no se hizo push, no se desplegó. No se abrió ninguna fase
nueva.
