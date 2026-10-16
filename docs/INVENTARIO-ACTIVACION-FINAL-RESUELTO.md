# Activación final de Inventario — bloqueos resueltos

17/10/2026. Continúa desde el commit `7c33b49` y
`docs/INVENTARIO-ACTIVACION-FINAL-PREFLIGHT.md`. No se repitieron las 25
pruebas del laboratorio real ni las 51 anteriores. Sin Cloud DDL/DML, sin
push, sin despliegue, sin nueva fase.

## Veredicto

**LISTO PARA AUTORIZAR** la activación conjunta (búsqueda + Etapa 3 + cierre
RLS), sujeta a: (a) autorización explícita en el turno en que se vaya a
aplicar — regla permanente del proyecto, no implícita en esta preparación —
y (b) ejecutar la ventana de aplicación+despliegue descrita en la sección 2
sin pausas largas entre sus pasos (ver riesgo de Campo en la sección 6).

Los dos bloqueos de `INVENTARIO-ACTIVACION-FINAL-PREFLIGHT.md` quedan
resueltos en esta sesión:

1. **Dependencia de Etapa 3**: confirmado que su migración y la de cierre
   RLS son compatibles entre sí y con Fase 162 — ver sección 1.
2. **Respaldo desactualizado**: hay un respaldo nuevo, verificado restaurable
   en aislamiento, que refleja el estado real actual — ver sección 4-5.

## 1. Dependencias exactas de Etapa 3 con Fase 162 y el cierre RLS

Releída `supabase/migrations/20261016010000_campo_inventory_operations.sql`
(Etapa 3) completa junto a las dos migraciones de Fase 162 y la de cierre
RLS:

- **Etapa 3 no depende de Fase 162 ni del cierre RLS** — solo de tablas base
  ya existentes en Cloud (`profiles`, `installations`, `tickets`,
  `job_assignees`, `service_contracts`, `inventory_products/movements/
  units/unit_events`), todas confirmadas compatibles en la sesión anterior.
  Es la pieza fundacional: puede aplicarse sola, en cualquier momento.
- **El cierre RLS depende de Etapa 3, no al revés**: `inventory_ticket_review`
  hace `insert into public.campo_inventory_operations(...)` — esa tabla
  **tiene que existir primero**. El resto del cierre RLS (políticas de las 5
  tablas, `inventory_order_read`, `inventory_get_albums`) no toca nada de
  Etapa 3 ni de Fase 162.
- **Fase 162 y Etapa 3 ya convivían por diseño**: los triggers de Fase 162
  sobre `inventory_movements`/`inventory_units`/`inventory_unit_events`
  (`guard_routine_inventory_*`) solo actúan cuando `routine_id`/`operation_id`
  no son nulos — las inserciones de Etapa 3 (Altas/Averías) nunca los usan,
  caen al branch original de Fase 151 sin cambios. Confirmado leyendo el
  código, no solo por comentario.
- **Las tres piezas YA conviven y se probaron juntas**, no solo por separado:
  el laboratorio real (`inventory_security_lab`, el mismo de
  `INVENTARIO-CIERRE-RLS-VALIDACION-FINAL.md`) se construye aplicando Etapa 3
  primero (`schema.mjs` → `20261016010000_campo_inventory_operations.sql`),
  después Fase 162 (`security-prepare.mjs` → sus dos migraciones) y por
  último el cierre RLS (`security-fixture.mjs`). Confirmado ahora mismo, sin
  repetir las 25 pruebas: el contenedor sigue vivo y las cuatro funciones
  (`campo_inventory_operation`, `campo_inventory_operations`,
  `routine_inventory_operation`, `inventory_order_read`) coexisten en la
  misma base — exactamente la combinación que preocupaba resolver.

## 2. Orden mínimo de instalación

1. **Respaldo fresco** (sección 4-5) — ya hecho en esta sesión.
2. **Etapa 3** (`20261016010000_campo_inventory_operations.sql`) en Cloud.
3. **Cierre RLS** (`20261016220000_inventario_contextual_rls_admin.sql`) en
   Cloud, inmediatamente después — el orden entre ambas migraciones ya es el
   natural por su nombre/timestamp si se usa un runner secuencial estándar.
4. **Postchecks** (sección 6) con sesiones reales, antes de continuar.
5. **Despliegue del frontend/backend compatible** (sección 7) — lo más
   pegado posible al paso 3, idealmente en la misma ventana de mantenimiento;
   ver el riesgo concreto de dejar un hueco entre 3 y 5 en la sección 6.

Ningún paso de esta lista se ejecutó en esta sesión.

## 3. Validación de dependencias cruzadas (sin repetir pruebas aprobadas)

No se reconstruyó el laboratorio ni se repitieron los 25 casos. Se
reutilizó el que ya estaba en pie (ver sección 1): se confirmó por consulta
directa al contenedor vivo que Etapa 3 + Fase 162 + cierre RLS coexisten
ahí mismo, y que esos 25 casos —incluidos explícitamente "Campo transactions
concurrent authorized technicians **under closed RLS**" y "Routine
transactional RPC and retry remain compatible with closed inventory RLS"—
ya ejercitaban exactamente esta combinación. No había una dependencia
cruzada pendiente de validar que esos 25 casos no cubrieran ya.

## 4. Respaldo nuevo (procedimiento privado DPAPI, sin credenciales por chat)

Nuevo script `scripts/respaldar-activacion-final-privado.ps1` — mismo patrón
ya documentado (`.env` → `PGPASSWORD_DPAPI_FILE`, descifrado DPAPI atado a
este usuario de Windows y a este proyecto, TLS verify-full, `pg_dump` dentro
de un contenedor Docker aislado, credenciales solo por stdin, nunca mostradas
ni registradas). Precheck de origen integrado: antes de respaldar, confirma
por lectura real que Fase 162 sigue presente y que Etapa 3/cierre RLS siguen
ausentes — si alguien los hubiera aplicado fuera de esta conversación, el
script se detiene en vez de respaldar sobre una base distinta de la
documentada.

**Dos fallas reales encontradas y corregidas al construirlo** (ninguna
expuso una credencial; evidencia en archivos de resultado sin datos
sensibles):

1. El cliente Docker de Windows antepone un BOM UTF-8 (`EF BB BF`) al primer
   dato de un `stdin` redirigido en modo `-i` sin terminal — rompía el primer
   `read` (el certificado CA) en cualquier script que siga este patrón.
   Reproducido de forma aislada con texto de prueba (sin credenciales) antes
   de tocar la conexión real. Corregido retirando ese BOM si aparece, antes
   de decodificar.
2. La función compartida `Invoke-PrivateDocker` corta a los 60 segundos —
   insuficiente para un `pg_dump` completo (~38MB) por el pooler real; el
   intento anterior se detuvo a medio volcado. Se agregó una copia local con
   240 segundos **solo para este script**, sin modificar la función
   compartida que usan los demás scripts privados ya existentes.

Resultado: **RESPALDO VERIFICADO**,
`activacion_final_completo_20261016_230124_a3f1e0d4`, 38.392.396 bytes,
SHA-256 `4248F4A3149AE24683012A8A9AE88B9D300F49DE71AE7045C297EAF00D2F5FDA`.
Los cuatro respaldos anteriores (`cuadrillas_*`, `fase161_*` ×2,
`fase162_completo_*`) permanecen intactos, sin sobrescribir.

## 5. Integridad y restauración aislada

`pg_dump` exit 0; `pg_restore --list` e `--file=/dev/null` sin errores; hash
verificado antes y después de la restauración (idéntico). Restauración
completa dentro de un `supabase/postgres:17.6.1.136` efímero, sin red, sin
puertos publicados, con el respaldo montado solo lectura — exit 0,
transacción única, sin filtros ni `--no-owner`/`--no-acl`. Tras restaurar:
32 productos, 271 movimientos, 128 unidades, 301 eventos — coincide
exactamente con los conteos leídos en vivo de Cloud en la sesión anterior y
con el precheck de origen de este mismo respaldo. Fase 161/162 confirmadas
restauradas (`routine_returns`/`return_routine` y
`routine_inventory_operation` presentes). Limitaciones conocidas y ya
documentadas en los respaldos anteriores: sin archivos de Storage, atributos
globales de roles ni claves externas de Vault.

## 6. Postchecks, rollback y comportamiento de Campo si falla el despliegue

**Riesgo concreto a evitar**: aplicar el cierre RLS cambia permisos de forma
global e inmediata — no espera a que el frontend nuevo esté desplegado. Si
las migraciones se aplican y el despliegue del frontend/backend (paso 5 de
la sección 2) se demora, falla o se detiene a medio camino, cualquier
técnico que en ese momento tenga abierta una Alta, Avería o Rutina en la App
de Campo (el mismo panel web, WebView, home `/soporte`) deja de poder leer o
registrar materiales/equipos de esa orden — verá listas vacías o un error de
"no autorizado"/"función no encontrada", nunca datos de otro cliente ni una
escritura a medias (las RPC son atómicas; no hay estado intermedio corrupto).
Mitigación: ejecutar los pasos 2-3-5 de la sección 2 en la misma ventana,
sin pausas evitables; si el despliegue del frontend no puede completarse en
minutos, revertir el cierre RLS (no Etapa 3, que es aditivo e inocuo) con
`scripts/rollback-inventario-contextual-rls-admin.sql` — ya preparado, usa
las 10 políticas y el `inventory_get_albums` exactos capturados de Cloud en
esta sesión, no inventados. No borra ningún movimiento, evento ni recibo.

**Postchecks tras aplicar** (con sesiones reales, no del laboratorio): un
ADMIN ve catálogo/álbumes y la búsqueda administrativa; un técnico con
cuadrilla vigente abre una Alta/Avería/Rutina y ve/registra sus materiales y
equipos; el mismo técnico retirado de esa cuadrilla ya no puede; oficina
aprueba/rechaza equipo entrante de una avería; `routine_inventory_operation`
sigue aceptando consumos. `scripts/rollback-campo-inventory-etapa3.sql` ya
existía de la sesión que implementó Etapa 3 (revoca el `EXECUTE`, conserva
todo recibo/movimiento/evento) — sigue siendo el rollback correcto si hiciera
falta deshacer solo esa pieza.

## 7. Archivos exactos a desplegar

Corrección de conteo al retomar desde `65bd12d`: la lista que sigue contiene
**25 archivos frontend, 4 backend y 2 migraciones: 31 en total**, no 28.
Ver `INVENTARIO-ACTIVACION-MANIFIESTO.json` para los nombres y SHA-256 exactos.
El manifiesto enumera fuentes de esta activación; no autoriza ejecutar
`deploy/update.sh` sobre toda la rama ni aplicar todas las migraciones.
La evidencia local `FASE161-DESPLIEGUE-RESULTADO.md` registra el frontend
desplegado desde `ccdf94f`, conservado como base del paquete seleccionado.
`b128e42` es la referencia de `origin/main`; no debe confundirse con esa
imagen desplegada. Ver `INVENTARIO-CONTINUIDAD-CODEX.md` para la corrección.

51 archivos de código cambiaron desde el último commit realmente desplegado
(`b128e42`, confirmado por `git diff --name-only` acotado a `src/`,
`server/` y `supabase/migrations/` — sin ruido de otras fases, ese rango no
tocó nada ajeno a inventario). De esos, **se excluyen explícitamente** los
de Fase 161 («Devolver orden» de Rutinas, ya aplicada en Cloud y sin relación
con esta activación) y las dos migraciones de Fase 162 (ya aplicadas; no hay
nada que desplegar de ellas) — y, por supuesto, todo lo de
`scripts/inventory-auth-lab/` y `docs/*.md` de laboratorio, que nunca se
despliegan.

**Backend (Hono) — 4 archivos:**
`server/src/index.ts` (registra la ruta nueva), `server/src/routes/
fieldInventory.ts`, `server/src/routes/inventorySignals.ts`,
`server/src/services/fieldInventory.ts`.

**Migraciones — 2 archivos, en este orden:**
`supabase/migrations/20261016010000_campo_inventory_operations.sql` (Etapa
3), `supabase/migrations/20261016220000_inventario_contextual_rls_admin.sql`
(cierre RLS).

**Frontend (Vue/TS) — 25 archivos:**
`src/components/inventario/InventorySearchResults.vue`,
`src/components/inventario/RoutineInventory.vue`,
`src/components/layout/AppLayout.vue`,
`src/lib/api.ts`,
`src/lib/fieldInventoryClient.ts`,
`src/lib/fieldInventoryOperation.ts`,
`src/lib/installationInventoryError.ts`,
`src/lib/inventoryAccess.ts`,
`src/lib/inventoryAdministrativeSearch.ts`,
`src/lib/inventoryRefresh.ts`,
`src/lib/inventorySearch.ts`,
`src/lib/inventorySignals.ts`,
`src/lib/orderInventory.ts`,
`src/lib/routineInventoryRequest.ts` (helper de Fase 162 que
`RoutineInventory.vue` ya usa — no es Fase 162 "ajena", es una dependencia
directa del archivo que sí hace falta desplegar aquí),
`src/router/index.ts`,
`src/stores/inventory.ts`,
`src/stores/ticketApprovals.ts`,
`src/types/fieldInventory.ts`,
`src/views/campo/CampoTrabajoDetailView.vue`,
`src/views/clientes/ClientServiceDetailView.vue`,
`src/views/instalaciones/InstalacionDetailView.vue`,
`src/views/inventario/InventarioAlbumView.vue`,
`src/views/inventario/InventarioProductoView.vue`,
`src/views/inventario/InventarioView.vue`,
`src/views/soporte/TicketDetailView.vue`.

**Explícitamente excluidos de este despliegue** (cambiaron en la misma
ventana de tiempo pero no son parte de esta activación):
`src/views/soporte/RutinasView.vue`, `src/stores/campo.ts` (solo la función
`returnRoutine`), `src/stores/jobAssignees.ts` (solo `returnRoutine`),
`src/stores/routines.ts` (solo el join a `routine_returns`),
`src/types/domain.ts` (solo el tipo `RoutineReturn`) — los cinco son
exclusivamente la funcionalidad "Devolver orden" de Fase 161, sin relación
con búsqueda/Etapa 3/cierre RLS. Las migraciones de Fase 161/162 también se
excluyen por estar ya aplicadas. Archivos `*.test.ts`/`*.sql.test.ts` no se
listan: son pruebas, no se despliegan.

## 8. Resumen

LISTO PARA AUTORIZAR. Nada se aplicó en Cloud, no hubo push ni despliegue.
Ningún dato operativo, cliente, contrato ni equipo real se modificó. El único
cambio de estado de esta sesión es el respaldo nuevo (sección 4) y los
archivos locales descritos aquí.
