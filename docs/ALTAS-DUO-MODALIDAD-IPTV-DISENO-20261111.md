# Altas Dúo: modalidad IPTV — diseño previo a migración

11/11/2026. Diseño inicial de `6170a83`; **implementación local autorizada
posteriormente**, migración y rollback preparados y probados, sin aplicar
SQL ni publicar/desplegar. Estado, pruebas y publicación futura en
`ALTAS-DUO-IPTV-IMPLEMENTACION-20261111.md`. Este documento conserva el
diseño aprobado. Rosita Ferrel Rivera y órdenes históricas fuera del alcance.

## Causa raíz y rutas revisadas

`supabase/migrations/20261021200000_fase167_equipo_serializado_obligatorio_cierre.sql`,
función `validate_installation_completion()`: equipara
`service_type='internet_combo'` con `xui_line_id IS NOT NULL` a necesitar
TV Box de Rayco. Eso identifica IPTV vinculada, no el dispositivo receptor.
No hay modalidad estructurada en `Installation`; `iptv_account_note` es
texto libre, insuficiente para una validación de servidor confiable.

El cierre de Campo (`CampoTrabajoDetailView.vue` → `campo.ts`) termina en
`installationsStore.updateStatus(id,'completed')`. También se puede cerrar
desde `InstalacionDetailView.vue` y por UPDATE directo a la API. El trigger
es la protección común; cambiar solo el formulario no resuelve el bloqueo.
La asignación por custodia es independiente y debe conservarse.
Se revisaron código y pruebas locales; la definición productiva no se
reconsultó en esta tarea. No se leyó ni alteró la orden de Rosita.

## Diseño mínimo propuesto

1. Añadir a **installations**, no al contrato, `iptv_installation_mode`
   nullable, con valores cerrados: `smart_tv_app` (aplicación en Smart TV),
   `customer_device` (dispositivo compatible del cliente), `rayco_tv_box`
   (Rayco entrega TV Box). Sin valor elegido por defecto ni inferencias
   desde equipos históricos. NULL significa modalidad no registrada.
2. Para aplicar exclusivamente a órdenes creadas después de activar la
   migración, añadir `iptv_policy_version` nullable. Primero agregar ambas
   columnas sin DEFAULT; después fijar DEFAULT 1 solo para inserciones
   futuras. **Sin UPDATE/backfill de filas existentes.** Un trigger fuerza
   versión 1 en cada nueva inserción, incluso si API envía NULL/otra
   versión, y bloquea cambiar la versión en UPDATE. Así no se puede eludir
   la nueva regla ni se usa un `created_at` editable como frontera.
3. Las filas anteriores conservan NULL en ambos campos y la validación
   anterior. Impedir cambiar sus nuevos campos o los de una orden cerrada,
   incluso mediante API. No adoptar esta modalidad en órdenes históricas,
   reabrirlas, recalcularlas ni procesarlas en segundo plano.
4. En futuras Altas Dúo, el trigger de cierre exige modalidad explícita.
   `smart_tv_app`/`customer_device`: no exige TV Box de inventario.
   `rayco_tv_box`: exige unidad real categoría `tvbox`, `assigned`, con
   serie o MAC no vacía y mismo cliente, contrato e instalación. Mantener
   RPCs, permisos y validaciones actuales de custodia/asignación; la
   selección de modalidad nunca crea, libera o reasigna unidades.
5. **Internet sigue exigiendo ONT válida**, también con dispositivo IPTV
   propio. Se mantienen contrato del mismo cliente, Zona, Caja NAP, código
   de cliente y demás controles existentes. No se cambia `solo_iptv`,
   contratos, facturación, aprovisionamiento ni reglas de inventario.
   Si ya hay un TV Box Rayco asignado a la nueva Alta, una modalidad sin
   entrega no puede usarse para ocultarlo: bloquear la contradicción,
   sin liberarlo automáticamente. Si se instala además una app, elegir
   modalidad con TV Box Rayco cuando también se entrega ese equipo.
6. Reutilizar el formulario, resumen y selector de custodia de Campo y
   el detalle administrativo. Mostrar modalidad en la orden y su cierre;
   persistirla junto con `status='completed'` en el mismo UPDATE. Validar
   temprano en UI/store y repetir en trigger para UPDATE/API directo.
   Incorporar el dato al borrador, `ClosureInput` y cola offline, siempre
   del contrato exacto. Una cola antigua para una orden nueva sin modalidad
   pide completar el dato; nunca deduce ni asigna TV Box por defecto.

Archivos de aplicación previstos tras autorización: las dos vistas de
instalación, `src/stores/campo.ts`, `src/stores/installations.ts`,
`src/types/domain.ts`, `src/lib/offlineQueue.ts`, pruebas focalizadas y una
migración nueva. No reescribir la migración Fase 167 ya existente.

## Validación realizada y pendiente

Pruebas existentes, solo datos sintéticos en PostgreSQL temporal sin red:

- `installationEquipmentRequiredClosure.sql.test.ts`: **14/14 PASS**;
  reproduce el bloqueo actual de Dúo sin TV Box y comprueba ONT, identidad
  del cliente/contrato, estado de unidad, cierre por API y Zona.
- `installationCustodyOnly.sql.test.ts`: **8/8 PASS**; custodia propia,
  rechazos de devoluciones/listas obsoletas e idempotencia.
- `installationCustodySelector.test.ts` + `jobClosureIdempotency.test.ts`:
  **20/20 PASS**, selectores y reintentos de cierre.

Son **42 pruebas del comportamiento anterior**, no de la corrección.
Al implementarla: probar Smart TV y dispositivo propio con ONT y cero
movimientos TV Box; Rayco con/sin unidad válida y con serie/MAC ausente;
modalidad ausente/inválida, versión manipulada, otros clientes/contratos,
datos de inventario contradictorios, reintento y sincronización offline.
Comparar snapshots sintéticos de órdenes históricas completadas/canceladas,
custodia y movimientos antes/después: ninguna modificación. Repetir las
validaciones anteriores y la prueba de API directa sin interfaz.

Riesgos: el bloqueo sigue vigente hasta autorizar migración e implementación.
Las Altas anteriores abiertas conservan la regla anterior por el alcance
estricto de futuras órdenes. Una app antigua no podrá cerrar un Dúo nuevo
sin modalidad: publicar frontend compatible antes de activar la exigencia,
en una ventana coordinada. Un rollback que restaure la regla antigua puede
volver a bloquear nuevos cierres por app; no debe modificar Altas cerradas,
modalidades registradas, inventario ni custodia.

Archivos modificados en esta entrega: este diseño, el bloque propio de
`ESTADO_DESARROLLO.md` y la entrada de `docs/ERRORES-CAMPO.md`.
Implementación posterior autorizada y preparada localmente; aplicar la
migración y desplegar siguen requiriendo autorización expresa, separada.
