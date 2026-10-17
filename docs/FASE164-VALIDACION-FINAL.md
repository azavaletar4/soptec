# Fase 164: validación final — custodia de equipos y materiales por técnico

17/10/2026, 15:00 h Lima. Continúa desde `7587c0d`/`d26b050`. No se repitieron
las 18 pruebas SQL aisladas ya aprobadas (`technicianCustody.sql.test.ts`) —
esta tarea cubre la capa que esas pruebas no ejercitan (HTTP/PostgREST con
JWT reales) y las verificaciones explícitas pedidas.

## 1. Compatibilidad exacta con Cloud (solo lectura + réplica verificada)

Lectura en Cloud (`mzupdnjegfwmpajywckd`) confirma: Fase 163, Etapa 3 y
cierre RLS **ya están aplicados** (desplegados en una tarea anterior de
esta misma sesión) — `installation_postponements`/`campo_inventory_operations`
presentes, 5 políticas `inventory_admin_only`. Fase 164 **sigue ausente**,
lista para aplicar. Cero escrituras de inventario desde el 16/10 23:27:10
(idéntico a los chequeos de hoy temprano). **Cero operaciones de Campo
activas en este instante** (0 sesiones abiertas, 0 Altas/Averías/Rutinas
`in_progress`).

Para validar las migraciones de Fase 164 contra el estado *exacto* de
Cloud (no una aproximación), se reutilizó el laboratorio local ya
construido (`scripts/inventory-auth-lab/`, PostgreSQL+GoTrue+PostgREST
reales, Docker local, sin red externa) sobre su base `inventory_security_lab`
— confirmado **byte a byte igual a Cloud** antes de tocar nada: el MD5
normalizado de `apply_inventory_unit_event`, `campo_inventory_operation` y
`apply_routine_inventory_event` en esa base coincide exactamente con el
MD5 leído hoy de Cloud. Fase164a y Fase164 se aplicaron ahí sin ningún
error — sus guardas de deriva (mismo patrón que Fase 162) pasaron
limpiamente, lo que en sí mismo es la confirmación de compatibilidad.

## 2. Validación con JWT reales — 4 roles pedidos

`scripts/inventory-auth-lab/fase164-validate.mjs` (nuevo): JWT reales
emitidos por GoTrue (login real, no simulado) para ADMIN, SUPERADMIN,
técnico asignado (`leader`, en la cuadrilla de la Alta de prueba) y
técnico ajeno (`outsider`, sin relación con esa orden) — mismo mecanismo
ya aprobado en `security-validate.mjs`. **12/12 PASS**, incluyendo de
paso SOPORTE/FACTURACION (confirmando que no obtienen acceso
administrativo de custodia — no se desarrolló nada para esos roles, como
indica la guía del proyecto):

- ADMIN entrega un equipo en bodega al técnico asignado → `with_technician`.
- Técnico ajeno: denegado al solicitar devolución de un equipo que no es
  suyo, denegado al entregarse equipo a sí mismo, denegado al confirmar
  recepciones.
- Técnico asignado instala en su Alta el equipo que tenía en custodia
  (ruta real de Etapa 3 ensanchada) — vía HTTP real, no solo SQL aislado.
- Técnico solicita devolución de un segundo equipo; **solo** ADMIN/SUPERADMIN
  pueden confirmar la recepción (técnico denegado al intentarlo).
- `my_inventory_custody`: el técnico ve únicamente lo propio (0 filas
  para el ajeno).
- `inventory_custody_summary`: exclusivo de ADMIN/SUPERADMIN, técnico
  denegado.

## 3. Duplicados y consistencia stock/Kardex

- Reintentar la misma entrega de un equipo (`deliver_unit_to_technician`
  dos veces) es **rechazado** (el equipo ya no está en bodega) — el
  Kardex (`inventory_unit_events`) queda con **1 sola fila**, no 2.
- Reintentar la misma operación de instalación (`campo_inventory_operation`
  con idéntico `operation_id`) es **idempotente** — misma respuesta exacta
  las dos veces, **1 sola fila** nueva en el Kardex, no duplicada.
- Entregar material a un técnico **no mueve `inventory_products.current_stock`**
  ni crea ninguna fila en `inventory_movements` — confirmado leyendo
  ambos directamente tras la entrega. Entrega ≠ consumo, verificado en
  producción simulada real, no solo en el diseño.

## 4. Regresión: Altas/Averías/Rutinas

Con JWT real del técnico asignado, un `consume` normal de Avería
(`campo_inventory_operation`, acción `consume`, sin ninguna custodia de
por medio) descontó exactamente la cantidad pedida de
`inventory_products.current_stock` — el flujo original sigue intacto por
la vía HTTP real. Las pruebas SQL locales ya aprobadas (23 de Fase 163,
18 de Fase 164, más las de Etapa 3/Fase 162 ya existentes) cubren el
resto de combinaciones; no se repitieron.

## 5. Técnico solo ve su propia custodia

Confirmado en la sección 2 (`my_inventory_custody`) y además por RLS
directa: `technician_material_custody`/`_events`/`_return_requests` tienen
policy `using (ADMIN/SUPERADMIN o technician_id = auth.uid())` — un
técnico nunca puede filtrar por otro `technician_id` y obtener filas
ajenas (ya lo aplica Postgres, no el RPC).

## 6. Respaldo, rollback y orden exacto

**Respaldo — RESUELTO (17/10/2026, 15:05 h Lima)**: `respaldar-activacion-final-privado.ps1`
es no interactivo (credencial DPAPI, nunca por chat); se detuvo con
`ORIGEN_INESPERADO` porque su precheck quedó fijado al estado de Cloud
**antes** de la activación de Fase 163/Etapa 3/RLS de esta sesión —
comportamiento correcto, no un error. Se preparó su sucesor exacto,
`scripts/respaldar-fase164-pre-activacion-privado.ps1` (mismo
procedimiento byte a byte: DPAPI, TLS `verify-full`, `pg_dump` de solo
lectura, restauración aislada sin red; **solo** cambia qué estado exige
el precheck — ahora Fase 162/163/Etapa 3/RLS presentes y Fase 164
ausente, el checkpoint real de hoy) y se ejecutó:

```
RESPALDO VERIFICADO: fase164_pre_activacion_completo_20261017_200422_837da96f
```

- **Tamaño**: 38.449.204 bytes. **SHA-256**: `5E3EFDD6892BD732895229B9AC219E139690BA273774D2C4BA9C3975F26FFEE4`.
- **Origen confirmado**: Fase 162 ✓, Fase 163 (`installation_postponements`) ✓,
  Etapa 3 (`campo_inventory_operations`) ✓, cierre RLS (`inventory_order_read`) ✓,
  Fase 164 (`technician_material_custody`) **ausente** ✓ — exactamente el
  checkpoint buscado.
- **Restauración aislada** (sin red, tmpfs, sin credenciales reales):
  `RESTORE_EXIT=0`; conteos idénticos a Cloud en vivo — 32 productos,
  275 movimientos, 128 unidades, 302 eventos.
- **Respaldos anteriores**: los 7 directorios previos
  (`activacion_final_*`, `fase162_*`, `fase161_*`, `cuadrillas_*`) se
  conservan intactos, ninguno se tocó ni se borró.

**Rollback de Fase 164** (si falla después de aplicar):

```sql
-- Objetos nuevos (sin consumidores aún — seguro):
drop function if exists public.confirm_material_return(uuid, boolean, text);
drop function if exists public.request_material_return(uuid, numeric, text);
drop function if exists public.deliver_material_to_technician(uuid, uuid, numeric, text);
drop table if exists public.technician_material_return_requests;
drop table if exists public.technician_material_custody_events;
drop table if exists public.technician_material_custody;
drop function if exists public.receive_unit_return(uuid, text, text);
drop function if exists public.request_unit_return(uuid, text);
drop function if exists public.deliver_unit_to_technician(uuid, uuid, text);
drop function if exists public.inventory_custody_summary();
drop function if exists public.my_inventory_custody();
-- Restaurar las 3 funciones ensanchadas a su version anterior exacta
-- (copiar tal cual desde los archivos ya desplegados, sin el "OR" agregado):
--   apply_inventory_unit_event()      <- supabase/migrations/20261015180000_fase162_inventario_rutinas.sql
--   campo_inventory_operation(...)    <- supabase/migrations/20261016010000_campo_inventory_operations.sql
--   apply_routine_inventory_event(...)<- supabase/migrations/20261015180000_fase162_inventario_rutinas.sql
drop function if exists public.apply_technician_custody_event(public.inventory_unit_events);
alter table public.inventory_units drop column if exists custody_technician_id;
```

Si ya hubo entregas reales antes del rollback: **no** ejecutar el DROP de
las tablas de custodia (se perdería el historial) — revertir solo las 3
funciones ensanchadas y dejar los equipos ya entregados en
`with_technician` hasta resolverlos manualmente. Los valores de enum
(`with_technician`, `pending_return`) no se pueden retirar limpiamente en
Postgres — quedan inertes si no se usan, igual que ya pasó con enums de
fases anteriores.

**Orden exacto de activación** (Fase 163/Etapa 3/RLS ya están aplicados,
no se repiten):

1. Confirmar de nuevo, justo antes de ejecutar, que no haya
   Altas/Averías/Rutinas `in_progress` ni sesiones de Campo abiertas
   (mismo chequeo de la sección 1 — repetirlo solo porque el tiempo pasa,
   no porque haya cambiado el método).
2. `20261017020000_fase164a_custodia_estados.sql` (ALTER TYPE, ya separado
   por la restricción de Postgres de no usar el valor en la misma
   transacción en que se crea).
3. `20261017030000_fase164_custodia_tecnicos.sql`.
4. Postcheck: `custody_technician_id` existe, las 9 funciones/tablas
   nuevas existen, los 3 MD5 de las funciones ensanchadas cambiaron
   exactamente como se preparó (comparar contra el nuevo cuerpo, no el
   anterior), conteos de inventario sin alterar.
5. Desplegar frontend (candidato a preparar con el mismo método de
   índice aislado ya usado para `ef8adfa`, incluyendo ahora también
   `InventarioCustodiaView.vue`/`CampoCustodiaView.vue`/`technicianCustody.ts`)
   — no preparado todavía en esta tarea, queda como siguiente paso
   explícito si se autoriza continuar.

## 7. Los ocho TV Box históricos

No se tocaron. `inventory_custody_summary()` sigue mostrando los conteos
reales del sistema sin ajustar ni inventar ninguna diferencia —
confirmado de nuevo en el laboratorio (fila `ONT MODELO-SAFE`/equipos de
prueba, nunca datos reales de TV Box). Ninguna consulta de esta tarea
tocó Cloud con escritura alguna.

## 8. Paquete final de despliegue (17/10/2026, 15:15 h Lima)

Producción confirmada corriendo `ef8adfa` en frontend y backend (misma
revisión que quedó activa tras la activación de Fase 163/Inventario). Se
preparó el candidato de Fase 164 **sobre esa base real**, no sobre
`main` a secas — commit local `b4d8abb`, tag `candidato-fase164`, mismo
método de índice aislado que `ef8adfa`/`4e967d0` (no tocó `HEAD` ni los
fuentes de trabajo).

Los 9 archivos que Fase 164 y el paquete ya desplegado tocan en común
(`router/index.ts`, `domain.ts`, `ClientServiceDetailView.vue`,
`InventarioAlbumView.vue`, `InventarioProductoView.vue`,
`InventarioView.vue`, `InventorySearchResults.vue`, `CampoLayout.vue`,
`DevolucionesView.vue`) son **byte a byte idénticos** entre el ancestro
de Fase 164 (`c525616`) y `ef8adfa` — verificado con `git diff
--ignore-space-at-eol` (un único caso con diferencia de fin de línea
CRLF/LF, cero diferencia de contenido real). No hizo falta ninguna
fusión de tres vías: se tomó la versión de Fase 164 directamente para
esos 9 archivos, más los 5 exclusivos
(`technicianCustody.ts`, `CampoCustodiaView.vue`,
`InventarioCustodiaView.vue`, las 2 migraciones). Las protecciones de
Fase 161/162/163, el hotfix de cuadrillas y los 31 archivos de
Inventario ya desplegados quedan intactos — ninguno se modificó en este
commit.

`vue-tsc -p tsconfig.app.json --noEmit` y `vite build` limpios **sobre
el candidato real** (worktree desechable del tag `candidato-fase164`, ya
eliminado) — confirmado que el bundle final incluye de verdad el código
nuevo (`deliver_unit_to_technician`/`my_inventory_custody` presentes en
`dist/assets/technicianCustody-*.js`). No se repitieron las 18 pruebas
SQL ni las 12 de JWT reales ya aprobadas.

## 9. Operaciones técnicas activas — verificación final

Solo lectura, 15:14 h Lima: **cero** actividad por cualquier medida —
`pg_stat_activity` sin consultas activas ajenas, `pg_locks` sin
bloqueos relevantes (ni de fila ni *advisory*), cero sesiones de Campo
abiertas, cero Altas/Averías/Rutinas `in_progress`, cero equipos
`pending_approval` sin resolver. A diferencia de la vez que esto se
bloqueó por una Alta real en curso, aquí **ambas verificaciones
coinciden**: ni el estado de las órdenes ni la actividad SQL real
muestran nada pendiente. No existe un modo de mantenimiento técnico en
el código (ya se buscó antes); la garantía es la ausencia de actividad
verificada dos veces hoy, no una promesa de que no pueda aparecer una
escritura en el instante exacto de la ventana — mismo criterio ya
aceptado para la activación anterior.

## 10. Rollback compatible con el estado actual

Igual que el ya documentado en la sección 6, con la misma salvedad
explícita: **si ya hubo entregas/devoluciones reales antes de un
rollback, no ejecutar los `DROP TABLE` de custodia** (se perdería ese
historial) — revertir únicamente las 3 funciones ensanchadas
(`apply_inventory_unit_event`, `campo_inventory_operation`,
`apply_routine_inventory_event`) a su versión anterior exacta y dejar
los equipos ya entregados en `with_technician`/`pending_return` para
resolverlos manualmente con administración. El `DROP` completo (sección
6) solo aplica si Fase 164 se revierte **antes** de que exista ninguna
entrega/devolución real registrada.

## 11. DESPLEGADO Y VALIDADO (17/10/2026, 15:22 h Lima)

Autorización explícita recibida y ejecutada en el orden indicado.

**Migraciones aplicadas en Cloud** (guardas de deriva en verde, cero
error):
1. `fase164a_custodia_estados` — `with_technician`/`pending_return`.
2. `fase164_custodia_tecnicos` — `custody_technician_id`, las 9
   funciones/tablas nuevas, el ensanche de `apply_inventory_unit_event`/
   `campo_inventory_operation`/`apply_routine_inventory_event`.

**Postchecks, todos en verde**: las 8 RPC + 3 tablas nuevas existen con
sus grants correctos; `custody_technician_id` existe; 3 nuevas políticas
RLS; enum con los 2 valores nuevos; cierre RLS de inventario (5 políticas
`inventory_admin_only`) intacto; `postpone_installation`/
`campo_inventory_operation`/`routine_inventory_operation` siguen
presentes y llamables; inventario **sin alterar** (32 productos/128
unidades/275 movimientos/302 eventos, idéntico antes y después);
`technician_material_custody` con **0 filas** (ninguna entrega ficticia).

**Commit desplegado**: `b4d8abb` (tag `desplegado-fase164-20261017`),
padre `ef8adfa`. Build en `/opt/smartrayco-staging/fase164-20261017/`:
ambas imágenes construidas con el candidato exacto, rollback etiquetado
desde las imágenes `ef8adfa` previas (confirmado por aserción del
propio script antes de construir), swap con `--no-deps --no-build
--pull never frontend backend`, el resto de contenedores (Caddy,
GenieACS, Mongo) sin cambios, HTTPS y 3 assets de entrada verificados
por `curl`.

**Verificación de acceso** (sin crear entregas ficticias ni operar sobre
datos reales — no hay sesión real de usuario disponible en esta tarea
para un click-through completo, misma limitación ya aceptada antes):
confirmado dentro del contenedor ya desplegado que el bundle real sirve
"Custodia de técnicos" (`InventarioCustodiaView.vue`, `InventarioView.vue`)
y el módulo `technicianCustody.js`; `my_inventory_custody()` tiene
EXECUTE otorgado a `authenticated` (así llega el técnico desde App de
Campo); `inventory_custody_summary()` solo ejecutable por quien además
pasa su propio chequeo de rol ADMIN/SUPERADMIN dentro de la función.

**Altas/Averías/Rutinas**: `campo_inventory_operation`,
`routine_inventory_operation` y `postpone_installation` siguen
presentes y ejecutables tras el despliegue — sin ninguna orden real
activa en este momento (0 en progreso) no se forzó ninguna operación
real para "probarlo en vivo"; la regresión funcional ya quedó validada
con JWT reales (sección 2) y no se repitió.

Cero escrituras a existencias/movimientos/órdenes/contratos reales. No
se operó OLT ni MikroTik. No hubo push ni cambios ajenos al candidato.

## Estado

**DESPLEGADO Y VALIDADO.** Fase 164 — custodia de equipos y materiales
por técnico — está en producción (`b4d8abb`, frontend y backend).
Rollback disponible y no usado
(`smartrayco-frontend:rollback-fase164-20261017`,
`smartrayco-backend:rollback-fase164-20261017`, apuntando exactamente a
las imágenes `ef8adfa` anteriores) — con la salvedad ya documentada de
no borrar las tablas de custodia si llegan a tener datos reales.
