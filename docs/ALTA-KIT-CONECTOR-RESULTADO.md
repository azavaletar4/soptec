# Altas: conector óptico predeterminado en 1 — preparado localmente

Fecha: 20/10/2026. Base desplegada: f893584b76d42e6c627ea69bfb99c0a9bd244f17.
Rama: fix/altas-kit-conector-20261020.
Sin push, despliegue ni acceso a datos de producción.

## Causa y alcance

El valor estaba definido exclusivamente en frontend, en KIT_ALTA de
src/views/campo/CampoTrabajoDetailView.vue: conector.defaultQty era 2.
resetKitQuantities copia esa plantilla al formulario inicial y después de un
registro exitoso. handleRegisterKit envía las cantidades editadas, no impone 2.
No es un valor que se lea de configuración, backend o base de datos.

Se modifica una única línea funcional: defaultQty del conector pasa de 2 a 1.
Roseta y patchcord permanecen en 1; Drop prefabricado/bobina y los otros materiales
no cambian. Se conserva el input editable v-model.number y su máximo informativo
de custodia, además de la guarda obligatoria de servidor. No hay parche duplicado,
ni SQL/migración nueva o modificación de funciones, permisos o reglas de stock.
Las ramas de Averías y Rutinas no se modificaron.

El formulario no registra automáticamente el kit al montar/reabrir. Tras guardar,
la plantilla queda disponible para otro registro explícito; no se cambió ese
comportamiento. Se verificó que reabrir conserva y muestra los tres consumos
anteriores sin nueva llamada de escritura, cambio de cantidad ni movimiento.
No se deduplican registros voluntarios distintos: se conserva la idempotencia de
las operaciones/reintentos existentes.

## Pruebas

- TypeScript vue-tsc -b: PASS.
- Build Vite: PASS; aviso previo de chunks grandes continúa.
- 48 comprobaciones en suite focalizada SQL + operación de inventario + outcomes:
  PASS, 0 fallos. SQL únicamente en Docker local postgres:17 --network none,
  esquema de prueba y datos ficticios. Se usan migraciones existentes para montar
  esa fixture efímera; no hay migración propuesta ni ejecutada en producción.
- Caso SQL nuevo, con productos Conector Óptico, Roseta Óptica y Patchcord reales
  dentro de la fixture: kit 1/1/1 con saldo 1 consume una vez; reintento con el
  mismo UUID devuelve el recibo sin duplicar. Custodia 0 rechaza el kit entero,
  sin movimientos parciales. Entrega ficticia de 1 y reintento resuelve una vez.
  Edición a 2 acepta con custodia 2; rechaza con custodia 1 y permite corregir a 1
  con el mismo UUID; otro reintento conserva tres movimientos, no seis.
- Las pruebas existentes verifican que el rechazo pendiente sigue bloqueando el
  cierre, los errores inciertos conservan intención/UUID y no se mezclan órdenes.
- Navegador local sobre el componente real, datos/sesión ficticios y red de
  API/Supabase bloqueada: 1 conector, 1 roseta, 1 patchcord; máximo 1 cuando tiene
  1 disponible; consumo válido, saldo cero rechazado, edición a 2, corrección y
  reintento con mismo UUID, respuesta perdida/reapertura/reintento sin duplicación.
  Al reabrir se comprueban tanto el estado persistido como las tres filas visibles
  de Materiales usados. Cero excepciones JavaScript en el ensayo final.

Se ajustó la fixture del navegador para inicializar drafts/closures en IndexedDB,
seleccionar el paso Materiales antes de inspeccionarlo y devolver el contrato
completo de recibos; esos fallos iniciales de ensayo no requirieron cambios de
aplicación. La configuración .env.local es sintética e ignorada; el build es de
laboratorio y no debe publicarse tal cual. No se valida aquí un Android físico.

## Archivos

Aplicación: src/views/campo/CampoTrabajoDetailView.vue (solo defaultQty del conector).
Pruebas: server/tests/materialRejectionCorrection.sql.test.ts (nuevo subcaso de
Altas) y scripts/tests/alta-kit-default-browser.mjs (formulario real con fixture).
Evidencias: ALTA-KIT-CONECTOR-PRUEBAS.json, ALTA-KIT-CONECTOR-NAVEGADOR.json,
esta documentación y [captura del formulario](ALTA-KIT-CONECTOR-UNO.png).

Logs de TypeScript/build: runtime/alta-kit-TypeScript.log y alta-kit-build.log.
No se alteraron consumos históricos, Kardex, entregas ni stock de producción.
El checkout principal, sus 216 archivos pendientes y el commit local dceafa0
quedan preservados. No se modificó ESTADO_DESARROLLO.md ni se integró main.

Preparado para revisión del propietario. Esperar autorización expresa antes de
push o despliegue; un futuro build productivo debe usar su configuración real.
