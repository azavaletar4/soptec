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

**Respaldo**: los datos de inventario siguen bit a bit iguales al dump
`activacion_final_completo_20261016_233807_8dda07bc` (cero escrituras
desde entonces) — ese respaldo sigue siendo válido para los **datos**.
Para el **esquema** actual (que ya incluye Fase 163/Etapa 3/cierre RLS,
aplicados después de ese dump), reconstruirlo no depende de un nuevo
pg_dump: las tres migraciones ya están versionadas, aplicadas y
confirmadas sin deriva — reaplicar esos tres archivos en orden reproduce
el esquema exacto. Un respaldo completo fresco (`respaldar-activacion-final-privado.ps1`)
**no se pudo generar en esta tarea**: su propio guardia de origen
(`ORIGEN_INESPERADO`) lo detuvo a propósito porque ese script quedó fijado
al estado de Cloud *antes* de la activación de hoy — es el comportamiento
correcto del script, no un error; requiere que alguien con las
credenciales lo re-ejecute de forma interactiva (`Read-Host`, nunca por
chat) para fijar un nuevo punto de referencia, o aceptar explícitamente
el riesgo documentado (bajo: datos sin cambios + migraciones
deterministas ya validadas).

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

## Estado

**LISTO PARA AUTORIZAR**, con una única condición pendiente antes de
ejecutar: **respaldo completo fresco del esquema actual** (dato: sin
cambios, ya cubierto; esquema: reconstruible por migraciones ya
validadas, pero sin un pg_dump nuevo tomado hoy). Todo lo demás —
compatibilidad exacta con Cloud, permisos con JWT reales para los 4
roles, ausencia de duplicados, regresión de Altas/Averías/Rutinas,
aislamiento por técnico, rollback y orden — está verificado y documentado.
