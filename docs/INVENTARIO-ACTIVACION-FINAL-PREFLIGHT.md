# Activación final de Inventario (búsqueda + cierre RLS) — preflight Cloud

17/10/2026. Continúa desde el commit `5e9626b` y
`docs/INVENTARIO-CIERRE-RLS-VALIDACION-FINAL.md` (25/25 PASS con JWT reales,
**no se repitieron**). Esta entrega es exclusivamente lectura de Supabase Cloud
(`mzupdnjegfwmpajywckd`, proyecto "SMARTRAYCO") + revisión local. Sin DDL/DML
en Cloud, sin push, sin despliegue, sin tocar OLT/MikroTik/datos operativos.

## Veredicto

**BLOQUEADO para la activación completa** — no por la migración de RLS en sí
(esa parte sigue LISTO, confirmada compatible con el esquema real de Cloud
punto por punto, ver sección 1-2), sino por **dos condiciones externas a la
migración** que esta revisión de solo lectura encontró y que la sesión
anterior no había cubierto:

1. Una dependencia dura que el *frontend ya comprometido localmente* tiene con
   una migración distinta (Etapa 3, `campo_inventory_operations`) que **nunca
   se aplicó en Cloud** — ver sección 4.
2. El respaldo privado más reciente es anterior a que Fase 162 se confirmara
   en Cloud y a datos reales escritos desde entonces — ver sección 3.

La búsqueda por nombre/modelo/serie/MAC no requiere migración y puede
activarse de forma independiente (ver sección 4, orden propuesto) — **no**
depende de resolver los dos puntos anteriores.

## 1-2. Políticas, funciones y dependencias reales de Cloud (solo lectura)

Confirmado por consulta directa a `mzupdnjegfwmpajywckd` (no por lo que digan
los documentos previos):

- **RLS ya habilitado** en las 5 tablas administrativas; **10 políticas
  amplias reales** confirmadas por nombre (`inventory_products_staff_only`,
  `inventory_categories_staff_only`, `inventory_movements_staff_select`/
  `_insert`, `inventory_unit_events_staff_select`/`_insert`,
  `inventory_units_select_staff`/`_insert_staff`/`_update_staff`/
  `_delete_staff`) — todas permiten SUPERADMIN/ADMIN/TECNICO_RED/SOPORTE/
  FACTURACION salvo `DELETE` (solo SUPERADMIN). El bloque `do $$ ... drop
  policy ... $$` de la migración es genérico por nombre real (no hardcodea
  estos 10 nombres), así que los elimina correctamente sean los que sean.
- **`inventory_get_albums()` hoy es ejecutable por `anon` y PUBLIC** —
  confirmado también por `get_advisors` (WARN
  `anon_security_definer_function_executable`). Es un hallazgo real y vigente,
  no solo documentado: cualquier petición sin sesión puede leer hoy conteos y
  **valor total en soles** de cada álbum. La migración lo corrige exactamente
  (revoke de `public`/`anon`/`service_role`, guard interno de rol).
  Comparado carácter por carácter: el cuerpo de la consulta de
  `inventory_get_albums()` en Cloud es **idéntico** al que la migración
  reemplaza (misma UNION ALL, mismos tres bloques) — solo cambia el lenguaje
  (`sql`→`plpgsql` para poder validar el rol antes) y se envuelve en un
  subselect con casts explícitos (`::bigint`/`::numeric`) que `plpgsql`
  exige y `sql` no.
- `current_user_role()` y el enum `user_role` (SUPERADMIN, ADMIN,
  TECNICO_RED, SOPORTE, FACTURACION, CLIENTE) coinciden con lo usado por la
  migración y por el laboratorio ya validado.
- Columnas que `inventory_order_read`/`inventory_ticket_review` necesitan —
  `inventory_units.notes`/`routine_id`/`contract_id`/`ticket_id`,
  `installations`/`tickets`/`routines.status`/`client_id`/`contract_id`,
  `job_assignees.job_type`/`job_id`/`technician_id`/`role`,
  `profiles.role`/`active` — **todas presentes** en Cloud con el tipo
  esperado. El FK `inventory_units_contract_id_fkey` que usa la búsqueda
  (`inventorySearch.ts`) también existe.
- Volumen actual (tamaño pequeño, sin riesgo de rendimiento por sí mismo):
  32 productos, 5 categorías, 128 unidades, 271 movimientos, 301 eventos.
- El archivo de migración en disco, en `HEAD` de git y lo que se validó en el
  laboratorio real en la sesión anterior son **el mismo contenido exacto**
  (hash `1e79cdd2...` coincide en los tres). No hubo deriva entre lo aprobado
  y lo que se propone aplicar.

Hallazgo aparte, **no introducido por esta migración y fuera de su alcance**:
`get_advisors` marca varias funciones trigger de inventario
(`apply_inventory_movement`, `apply_inventory_unit_event`,
`guard_inventory_product_deactivation`,
`guard_inventory_units_onu_limit_on_contract_update`,
`reverse_inventory_on_installation_cancel/delete`,
`reverse_inventory_on_ticket_delete`) como ejecutables directamente por
`anon`/`authenticated` vía RPC (son `SECURITY DEFINER`, pensadas solo para
disparar desde un trigger). Llamarlas directo sin contexto de trigger
(`NEW`/`OLD`/`TG_OP` nulos) debería fallar sola, pero no se verificó aquí —
queda anotado para revisión aparte, no se toca en este alcance.

## 3. Respaldo — NO satisface "actualizado"

Respaldo privado más reciente localizado:
`fase162_completo_20261016_202712_1abe24f6` (38.350.028 bytes, SHA-256 ya
verificado en la sesión que lo creó). **Es anterior a que Fase 162 quedara
confirmada en Cloud** (se tomó como paso previo a esa instalación, no
después) y por lo tanto no refleja:

- Los objetos de Fase 162 ya confirmados en Cloud
  (`routine_inventory_operation`, `routine_inventory_operations`,
  `check_routine_inventory_receipt`, `apply_routine_inventory_event`).
- Ningún dato real escrito desde esa instalación — el inventario ya tiene más
  unidades hoy (128) que las ~124 contadas en la validación de búsqueda del
  15/10, consistente con uso real continuo.

**No se creó un respaldo nuevo en esta sesión** — tomar un `pg_dump` completo
de Cloud no es una consulta de solo lectura equivalente a las anteriores (es
una operación pesada contra producción) y esta sesión no tiene la cadena de
conexión/credencial de base de datos disponible para hacerlo siguiendo el
mismo patrón privado que las sesiones anteriores (nunca se trae esa
credencial a este contexto, ver regla de manejo de credenciales). **Pendiente
antes de autorizar**: repetir el mismo procedimiento privado ya usado para
Fase 161/162 (`scripts/respaldar-*-privado.ps1`) para un respaldo fresco,
verificado restaurable, sin sobrescribir los cuatro existentes en
`C:\Users\USER\AppData\Local\SmartRaycoBackups\`.

También pendiente de **reconfirmar con el usuario**: el estado del respaldo
automático propio de Supabase (`Last Backup` reportado como "No backups" el
14/10 — información de hace tres días, no se pudo verificar de nuevo en esta
sesión por solo lectura: no hay una herramienta de listado de respaldos
administrados en las herramientas disponibles aquí).

## 4. Orden de ejecución y dependencia encontrada

**Hallazgo central de esta revisión**: el código ya comprometido localmente
(commits `6326203`, `a8afd6a`, y todo lo migrado a RPC en `c2f34b9`/`5e9626b`)
asume que la RPC `campo_inventory_operation` existe — `CampoTrabajoDetailView.vue`
y `ticketApprovals.ts` ya la llaman para **todas** las escrituras de
Altas/Averías (consumir material, asignar/retirar equipo, aprobar/rechazar
entrante). Esa RPC y su tabla de recibos (`campo_inventory_operations`) vienen
de la migración `20261016010000_campo_inventory_operations.sql` (Etapa 3) —
**confirmado por consulta directa que NINGUNA de las dos existe en Cloud
todavía**. Etapa 3 quedó históricamente "LISTO en laboratorio; BLOQUEADO para
activación independiente" (`INVENTARIO-ENTREGA-CONSOLIDADA-PROPUESTA.md`,
sesión anterior) — esta revisión no la reabre ni la vuelve a probar, solo
confirma que sigue sin aplicarse y que ahora es una dependencia dura, no
opcional, para desplegar el frontend actual.

Consecuencia práctica: **no se puede desplegar el frontend/backend ya
construidos sin aplicar también Etapa 3** — si se desplegara el frontend
actual contra el Cloud de hoy (sin Etapa 3), cualquier técnico que intente
registrar material o equipo en una Alta/Avería recibiría un error de RPC
inexistente de inmediato. Y a la inversa: aplicar solo el cierre RLS sin
desplegar el frontend nuevo rompe el frontend **actualmente en producción**
(que todavía lee/escribe inventario por tabla directa) para TECNICO_RED/
SOPORTE/FACTURACION. Confirmado que nada de esto se desplegó aún:
`origin/main` sigue en `b128e42`, muy por detrás de los ~40+ commits locales
de esta e historial de sesiones anteriores.

Orden mínimo correcto, una vez autorizado (no se ejecuta aquí):

1. **Paquete de búsqueda, independiente y sin riesgo de ruptura**: la
   búsqueda por nombre/modelo/serie/MAC no necesita ninguna migración — puede
   desplegarse (push + `deploy/update.sh`) sola, en cualquier momento, sin
   coordinar con lo siguiente.
2. Respaldo fresco + captura exacta de las 10 políticas/grants reales listados
   arriba (sección 3).
3. Aplicar **Etapa 3** (`20261016010000_campo_inventory_operations.sql`) en
   Cloud — repetir su propio preflight contra el esquema real (no solo contra
   un laboratorio clonado); esta sesión no lo hizo, está fuera de su alcance.
4. Aplicar el cierre RLS (`20261016220000_inventario_contextual_rls_admin.sql`)
   inmediatamente después, en la misma ventana — no deja a nadie sin acceso
   entre un paso y el otro porque ninguno de los dos se usa aún desde
   producción.
5. Postchecks (sección 5) con sesiones reales.
6. Solo entonces, push + despliegue coordinado del frontend que ya depende de
   ambas RPC.

Ningún paso de esta lista se ejecutó en esta sesión.

## 5. Rollback, pruebas mínimas e impacto en App de Campo

**Rollback** (si se aplica y hay que revertir el cierre RLS puntualmente):
restaurar exactamente las 10 políticas listadas en la sección 1 (nombre, cmd,
roles, qual/with_check ya capturados arriba — textual, no hay que inventarlos)
y `drop function inventory_order_read`/`inventory_ticket_review`; restaurar el
`EXECUTE` de `inventory_get_albums` a `anon`/`authenticated`/`service_role`
tal como está hoy si hiciera falta volver atrás también en eso. Revertir
Etapa 3 por separado: `drop table campo_inventory_operations`, `drop function
campo_inventory_operation` — solo si Etapa 3 se aplicó junto y falla.

**Pruebas funcionales mínimas tras aplicar** (con sesiones/roles reales de
Cloud, no del laboratorio): un ADMIN ve catálogo/álbumes; un técnico con
cuadrilla vigente abre una Alta y ve/registra materiales y equipo; el mismo
técnico retirado de esa cuadrilla ya no puede; una Avería permite aprobar/
rechazar equipo entrante desde oficina; una Rutina en curso sigue consumiendo
materiales sin romper `routine_inventory_operation` (Fase 162, ya en
producción); búsqueda administrativa funciona para ADMIN y no devuelve nada
para los demás roles.

**Impacto en App de Campo (APK)**: usa el mismo panel web embebido
(WebView, home `/soporte`) — no hay un build Android separado que actualizar
para esto. El riesgo real es exactamente el de la sección 4: si el backend
(RPC) se actualiza sin el frontend, o viceversa, el técnico en campo ve fallar
sus registros de material/equipo a mitad de jornada. No se identificó ningún
otro impacto específico de hardware/MIUI más allá de lo ya conocido
(proceso en 2do plano).

## 6. Resumen para autorizar

- Búsqueda: LISTO, independiente, sin bloqueos.
- Cierre RLS (el archivo SQL en sí): LISTO, validado contra el esquema real
  de Cloud punto por punto en esta sesión.
- Activación conjunta: **BLOQUEADO** hasta (a) aplicar o descartar Etapa 3
  explícitamente y (b) tener un respaldo fresco + reconfirmar el respaldo
  administrado de Supabase. Ninguno de los dos se resuelve en esta sesión —
  quedan como decisión explícita pendiente, no como trabajo ya hecho.

Sin cambios de código, sin Cloud DDL/DML, sin push, sin despliegue, sin nueva
fase. No se repitieron las 25 pruebas del laboratorio ni las 51 anteriores.
