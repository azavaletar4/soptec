# Fase 165, etapa 2 — procedimiento de activación, verificación y rollback

Preparado, **no ejecutado**. Requiere autorización explícita del usuario en
el mismo turno para cada paso de escritura real (CLAUDE.md regla 16).
Ventana recomendada: sin órdenes `in_progress` (confirmado real al
20/10/2026: 0 Altas/Averías/Rutinas en curso).

## 0. Antes de empezar

- Confirmar de nuevo, justo antes de ejecutar, que sigue sin haber órdenes
  `in_progress` (pueden empezar entre que se prepara y se autoriza).
- Respaldo fresco de PostgreSQL + Storage (ya existe un procedimiento
  validado de sesiones anteriores — `scripts/material-custody-integral-backup.ps1`,
  `scripts/material-custody-storage-backup.cjs` — repetir el respaldo, no
  asumir que el de una sesión previa sigue vigente).
- Confirmar que el frontend desplegado en la VM coincide con el commit real
  esperado (`deploy/safe-update.sh` ya exige esto antes de desplegar nada).

## 1. Desplegar el frontend compatible ANTES de las migraciones

El código de Campo/Custodia (`campo.ts`, `technicianCustody.ts`,
`CampoTrabajoDetailView.vue`, `RoutineInventory.vue`,
`InventarioCustodiaView.vue`, `fieldInventoryOperation.ts`,
`routineInventoryRequest.ts`, `materialCustodyShortfall.ts`,
`materialCustodyAvailability.ts`, `materialInventoryOutcome.ts`) ya es
compatible con el backend ANTES de migrar: `checkMaterialClosure`
descarta explícitamente `PGRST202` (función todavía no desplegada) sin
romper el cierre. Por eso el orden correcto es desplegar primero el
frontend (sin ningún efecto nuevo hasta que existan las funciones) y
recién después migrar — nunca al revés.

- `deploy/safe-update.sh <sha-del-commit-con-fase165-etapa2-ya-mergeado>`
  (nunca `update.sh`). Requiere mergear/pushear antes los 10 archivos de
  `src/` pendientes — fuera de alcance de este documento, pedir
  autorización aparte para ese push.
- Verificar en el navegador (sesión real) que Altas/Averías/Rutinas abren
  normalmente y que "Materiales utilizados"/"Materiales y equipos de la
  rutina" cargan sin quedar vacíos (regresión ya cubierta en
  `src/lib/__tests__/inventoryRefresh.test.ts`, pero esto es la primera
  vez que corre contra producción real).
- **No se activa nada todavía** — sin las funciones SQL nuevas, el
  candado de custodia simplemente no existe aún; el sistema sigue
  funcionando exactamente igual que hoy.

## 2. Aplicar las 3 migraciones candidatas, en este orden exacto

1. `supabase/migrations/20261019160000_fase165_etapa2_custodia_obligatoria.sql`
2. `supabase/migrations/20261019170000_fase165_cierre_consumos_rechazados.sql`
3. `supabase/migrations/20261020120000_fase165_entrega_material_validada.sql`

Las 3 tienen guardas MD5 propias que abortan solas si alguna función
compartida cambió en producción desde que se escribieron — las 2 primeras
contra `campo_inventory_operation`, `routine_inventory_operation` y
`apply_technician_material_custody_event`; la 3ra contra
`deliver_material_to_technician` — **verificado de nuevo ahora mismo
(20/10/2026), las 4 coinciden exactamente, sin drift**. No se necesita
comparación manual adicional antes de aplicarlas.

La migración 3 corrige 2 riesgos reales del flujo administrativo de
entrega (ver punto 5 del riesgo más abajo): valida la entrega contra el
stock de almacén de forma transaccional (bloqueando también entregas
concurrentes del mismo producto) y agrega una clave de operación para
distinguir un reintento real de la misma entrega de una segunda entrega
legítima. **Cambia la firma de `deliver_material_to_technician`** (agrega
`p_operation_id` como primer argumento) — por eso el frontend DEBE estar
desplegado con la firma nueva antes de aplicar esta migración en
particular (la migración elimina la versión de 4 argumentos).

Aplicar dentro de una ventana sin órdenes `in_progress` (repetir el
chequeo del paso 0 inmediatamente antes). Cada migración ya está en su
propio `begin;...commit;`.

## 3. Verificación posterior (solo lectura, sin tocar nada)

- `select to_regclass('public.material_inventory_rejections');` → debe
  existir y estar vacía (`select count(*) from material_inventory_rejections;` = 0).
- Repetir las 3 comprobaciones de hash de guarda (deben seguir
  coincidiendo, ahora contra las versiones NUEVAS — confirma que el
  deploy de SQL fue exactamente el candidato revisado, no otra cosa).
- Un consumo real de prueba (idealmente ya cubierto por el laboratorio:
  no repetir aquí) — en su lugar, **de solo lectura**: confirmar que
  `technician_material_custody` sigue reflejando exactamente los mismos
  saldos de Jadir Zavaleta (9 consumibles / 4 equipos) y Ruber Pizango
  (10 consumibles / 2 equipos) que antes de migrar, y que el resto de
  técnicos activos sigue en 0 — una migración de funciones no debería
  tocar ninguna fila de datos, pero es la comprobación más barata de que
  nada inesperado ocurrió.
- Pedir a un administrador que confirme visualmente `/inventario/custodia`
  y que un técnico activo (Jadir o Ruber) abra su propia pantalla "Mis
  equipos y materiales" y vea sus saldos reales sin cambios.

## 4. Activar el bloqueo real (separado, al final, con autorización propia)

Las migraciones por sí solas YA activan el candado real (el trigger de
`apply_technician_material_custody_event` rechaza con P1650/P1651 desde
el momento en que se aplican) — no hay un interruptor separado. Por eso
el paso 2 ES la activación. Recomendado explicarlo así al pedir la
autorización final: "aplicar las 2 migraciones" y "activar el bloqueo"
son la misma acción, no dos pasos independientes.

## 5. Rollback (si algo sale mal)

Dos scripts independientes (no se tocan entre sí — funciones distintas,
sin dependencia). Orden sugerido: el de la migración más nueva primero,
aunque no es estrictamente necesario:

- `scripts/rollback-material-delivery-validada.sql` (migración 3) —
  **verificado con una prueba aislada real** (`npm run
  test:material-delivery-validated-sql`, caso "rollback propuesto..."):
  restaura `deliver_material_to_technician` a su firma de 4 argumentos
  (sin `operation_id`, sin validar stock) y elimina la tabla
  `material_delivery_operations`. No repone ni borra entregas ya
  registradas (el Kardex es insert-only, igual que el resto de Fase 165).
- `scripts/rollback-material-custody-stage2.sql` (migraciones 1 y 2) —
  **ya preparado en una sesión anterior, con las mismas guardas MD5,
  verificado de nuevo ahora mismo byte a byte**: las 3 funciones que
  restaura producen exactamente los hashes de la producción ACTUAL (antes
  de migrar), confirmando que revierte al estado exacto de hoy. Es un
  rollback "de comportamiento, no de datos": restaura los 3 cuerpos de
  función originales y quita los 4 triggers de guarda nuevos
  (`guard_material_closure/installation/ticket/routine`) sin tocar la
  columna `source_movement_id`, la tabla `material_inventory_rejections`
  ni ningún evento/saldo de custodia ya registrado (quedan inertes, no
  rotos — ninguna función viva vuelve a leerlos tras el rollback).

Ninguno de los dos repone material ni revierte consumos/entregas reales —
coordinar una pausa de escrituras antes de ejecutarlos, igual que exige
cada encabezado.

Si además hace falta revertir el frontend: `deploy/rollback.sh <tag>`
(nunca sin `--use-last-rollback` explícito ni sin el "si" de
confirmación, ver el incidente ya documentado de esa herramienta).

## Riesgos reales que quedan, no resueltos por este documento

1. **28 pares técnico/producto sin custodia real** (Vicente Valdez,
   Jhordanno Zavaleta, Jairo Bernabe, cuentas de prueba, y el propio
   Jadir/Ruber para productos que usan pero nunca se les entregó) — el
   primer intento de cada uno sobre un material nuevo quedará rechazado
   hasta que administración entregue. Esperado por diseño, no es un bug,
   pero administración debe estar lista para recibir esas preguntas el
   mismo día.
2. **Catálogo ampliado: verificado de solo lectura (2026-10-20), sin
   bloqueantes.** Confirmado contra producción: sin colisiones de nombre
   activo-activo en ningún categoría (cero riesgo de ambigüedad en los
   selectores de Kit/consumo), sin stock negativo/nulo ni unidad/nombre
   nulos, sin productos de ferretería marcados `is_serialized`. Hallazgo
   de higiene de catálogo (no bloqueante, no es de Fase 165): 3 productos
   quedaron duplicados con una fila antigua `is_active=false` tras un
   cambio histórico de unidad de medida — Patchcord (activo
   `cb764467-...`/66 unidades vs. inactivo `b82659da-...`/100), "cable
   UTP" (activo `657b3b84-...`/3397 metros vs. inactivo
   `87e0699f-...`/1090 unidades) y "Bobina Drop" (activo
   `786e8f9a-...`/3000 metros vs. inactivo, nombre similar,
   `e24bcbc1-...`/3005 unidades). Al ser `is_active=false`, estas filas
   nunca aparecen en los selectores reales de Kit/consumo — no afectan la
   activación, pero valen una nota a administración para archivar/fusionar
   cuando puedan.
3. **Cierre bloqueado por material pendiente: probado en laboratorio
   aislado (2026-10-20), PASS.** `update installations set
   status='completed'` con un rechazo de Kit pendiente lanza P1651 real
   (candado `guard_material_installation`); tras resolver el rechazo con
   el mismo reintento real por clic, el candado ya no bloquea. Sigue sin
   probarse un cierre COMPLETO (fotos/firma/wizard de 5 pasos) contra
   producción real tras activar — lo certificado es el candado de
   material en sí, vía laboratorio aislado con datos reales restaurados,
   nunca un cierre de punta a punta contra la base viva.
4. **Acción 'kit' (kit base de Alta): probada en laboratorio aislado
   (2026-10-20) con custodia suficiente e insuficiente, PASS.** Con los 4
   productos reales del catálogo (Patchcord, Roseta Óptica, Conector
   Óptico, Drop de 100 metros) y clics reales sobre
   `CampoTrabajoDetailView.vue`: custodia suficiente → éxito en los 4
   ítems; custodia insuficiente SOLO en uno → rechazo todo-o-nada real
   (los otros 3, con custodia suficiente, no se descontaron — sin
   movimiento parcial); reintento real con la misma clave (operation_id)
   resuelve el rechazo y descuenta los 4 correctamente. Confirma
   empíricamente que 'kit' comparte el mecanismo de `execute_tracked_
   material_inventory` sin comportamiento distinto al de 'consume'.
5. **Flujo administrativo de entrega de materiales: probado por clic real
   (2026-10-20), PASS inicial — 2 riesgos encontrados y corregidos el
   mismo día (ver migración 3).** La primera vuelta por clic real
   (`scripts/custody-integral-lab-admin-delivery.mjs`, laboratorio
   extendido con la ruta real `/inventario/custodia` + un stub de
   resolución `inventario-detalle` que antes faltaba y tumbaba el render
   completo de la pantalla — cambio aditivo, no afecta las rutas de App
   de Campo ya certificadas) confirmó la entrega válida y la actualización
   de custodia, pero también expuso: (a) una cantidad mayor al stock de
   almacén se entregaba igual, **sin tope** (`deliver_material_to_technician`
   nunca validaba contra `inventory_products.current_stock`); (b) no había
   forma de distinguir un reintento real de la misma entrega de una
   segunda entrega legítima. **Ambos corregidos** en la migración 3
   (`20261020120000_fase165_entrega_material_validada.sql`): valida de
   forma transaccional contra lo ya entregado a todos los técnicos (nunca
   contra un descuento directo de stock, que solo ocurre al consumirse) y
   agrega `p_operation_id` (mismo patrón que `campo_inventory_operation`
   desde Fase 162) — un reintento con los mismos datos no duplica, una
   entrega nueva (otro id, u otros datos) sí se aplica. Validado con una
   prueba SQL aislada nueva (`npm run test:material-delivery-validated-sql`,
   12/12 PASS, incluyendo **concurrencia real** con dos sesiones
   PostgreSQL simultáneas — una pasa, la otra se rechaza sin dejar nada a
   medias — y verificación del rollback) — nivel de rigor más alto que el
   laboratorio por clic (correcto: es una corrección de servidor/SQL, no
   de interfaz). No fue necesario repetir el laboratorio por clic: la
   pantalla es un *passthrough* sin lógica propia, ya confirmado antes.
6. Push pendiente de los 10 archivos de `src/` (`campo.ts`,
   `technicianCustody.ts`, `CampoTrabajoDetailView.vue`,
   `RoutineInventory.vue`, `InventarioCustodiaView.vue`,
   `fieldInventoryOperation.ts`, `routineInventoryRequest.ts`,
   `materialCustodyShortfall.ts`, `materialCustodyAvailability.ts`,
   `materialInventoryOutcome.ts` — siguen siendo 10, `technicianCustody.ts`
   e `InventarioCustodiaView.vue` ahora incluyen también la corrección del
   punto 5) + 3 migraciones a `origin/main` antes de poder desplegar —
   fuera de alcance de este documento, requiere autorización aparte.
