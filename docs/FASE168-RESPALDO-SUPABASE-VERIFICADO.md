# Fase 168 — Respaldo de Supabase verificado (Pendiente 2)

Fecha: 2026-10-21. No modifica datos reales, no sobrescribe
`docs/FASE168-RESPALDO-PRE-DESPLIEGUE.json` (se agrega como documento
nuevo, complementario).

## Qué respalda este documento

Las dos únicas funciones que las migraciones 166 y 167 reemplazan, y sus
dependencias reales (permisos, RLS, triggers) — confirmado leyendo el
estado REAL desplegado en Supabase (`pg_get_functiondef`/`pg_policy`,
nunca los archivos de migración históricos, que pueden haber quedado
desactualizados).

| Objeto | Hash (MD5 del cuerpo, sin comentarios ni espacios) | Rol |
|---|---|---|
| `assert_no_rejected_materials(text,uuid)` | `3ecf94d3f4f0f8c004b8208acb98592d` | Bloquea/desbloquea el cierre por rechazos de materiales (Fase 166 la reemplaza) |
| `validate_installation_completion()` | `4427ab7a21ba1c2a39f46310e4d8086e` | Exige equipo serializado al completar una Alta (Fase 167 la reemplaza) |

**Dependencias confirmadas (sin cambios por estas migraciones):**
- Triggers en `installations`: `guard_material_installation` (Fase 165/166) y
  `trg_installations_validate_completion` (Fase 167) coexisten junto a 8
  triggers más (`trg_installations_completed_at`, `trg_installations_current_crew`,
  etc.) — ninguno se toca.
- RLS de `material_inventory_rejections`: una sola política (`material_inventory_rejections_read`),
  ADMIN/SUPERADMIN ven todo, TECNICO_RED solo lo propio (`actor_id=auth.uid()`) — intacta, Fase 166/167 no tocan RLS.
- `EXECUTE` de `assert_no_rejected_materials`: solo `postgres`/`service_role`
  (función interna, nunca llamada directo por un cliente). `validate_installation_completion`
  tiene `EXECUTE` amplio (`PUBLIC`/`anon`/`authenticated`) — normal para una
  función de trigger, invocada solo por el propio trigger, nunca por un
  cliente directo; sin cambios.

## Respaldo recuperable

El respaldo ES el código fuente de la versión actual (capturado literal,
no un resumen): ya vive en `scripts/rollback-fase166-materiales-no-bloquean-cierre.sql`
y `scripts/rollback-fase167-equipo-serializado-obligatorio-cierre.sql` —
cada uno recrea la función exacta de producción de hoy, con una guarda
MD5 que aborta si el estado real difiere del esperado (nunca sobrescribe
a ciegas). Se agrega `scripts/respaldo-funciones-fase166-167-restauracion-completa.sql`,
que encadena ambos en el orden seguro para una restauración de un solo
comando cuando se necesite revertir las dos fases juntas.

## Restauración probada en entorno aislado

Ejecutado en un contenedor Postgres 17 descartable (`--network none`, sin
acceso a Supabase ni a la VM de producción, destruido al finalizar):

1. Se recreó el estado real de producción (mismos cuerpos de función,
   confirmados MD5-idénticos a los de la tabla arriba).
2. Se aplicaron `20261021190000_fase166...sql` y `20261021200000_fase167...sql`
   (simulando el despliegue).
3. Se ejecutó el archivo combinado real (`psql -f scripts/respaldo-funciones-fase166-167-restauracion-completa.sql`,
   no solo los pasos por separado) — usa `\ir` para encadenar ambos
   rollbacks en el orden correcto.
4. **Resultado**: los MD5 de ambas funciones volvieron a ser
   EXACTAMENTE `4427ab7a21ba1c2a39f46310e4d8086e` y
   `3ecf94d3f4f0f8c004b8208acb98592d` — restauración byte-exacta
   confirmada, no solo teórica. Ninguna fila de ninguna tabla se tocó en
   todo el ejercicio (ambas funciones son `CREATE OR REPLACE`, nunca
   `DELETE`/`UPDATE` de datos).

## Procedimiento de rollback (si algo falla después de desplegar)

1. Revertir solo Fase 167 (equipos): `psql <produccion> -f scripts/rollback-fase167-equipo-serializado-obligatorio-cierre.sql`
2. Revertir solo Fase 166 (materiales): `psql <produccion> -f scripts/rollback-fase166-materiales-no-bloquean-cierre.sql`
3. Revertir ambas en un solo paso: `psql <produccion> -f scripts/respaldo-funciones-fase166-167-restauracion-completa.sql`

Cada script valida contra el MD5 exacto que espera antes de tocar nada —
si la realidad no coincide (por ejemplo, alguien ya aplicó un cambio
distinto encima), aborta con un mensaje claro en vez de sobrescribir a
ciegas.

## Límite declarado (sin cambios desde el informe anterior)

No se verificó un punto de restauración PITR real de Supabase Cloud (no
hay herramienta en esta sesión para listar/forzar uno sin una acción
adicional no solicitada explícitamente, como crear una rama de Supabase).
La restauración verificada arriba cubre el **código** (las dos funciones
y sus dependencias) de forma completa y probada; para los **datos**
(tablas), la garantía sigue siendo el backup automático de Supabase
Cloud — se recomienda confirmar manualmente en su dashboard (Database →
Backups) que exista un punto reciente antes de autorizar el despliegue.
