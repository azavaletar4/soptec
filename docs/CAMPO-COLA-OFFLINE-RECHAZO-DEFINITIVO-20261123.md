# Cola offline de App de Campo — cierres con rechazo administrativo definitivo atascados (23/11/2026)

## Caso real reportado

Dos averías seguían en la cola offline de un técnico mostrando:
`"Cierre administrativo definitivo: no se puede modificar ni reabrir esta
orden. Crea una nueva orden para una incidencia nueva."`

- `6429c487-3e98-4749-9de1-b0e51bf80ff8`
- `dbfa2d4a-1c82-463b-9a50-04d7b95bf151`

## Diagnóstico (Supabase, solo lectura)

Ambos IDs completos confirmados antes de cualquier acción. Las dos son
**tickets (averías)**, ya en `status='resolved'` desde el envío original del
técnico, y ya **confirmadas administrativamente** en
`work_order_point_confirmations` (`confirmed_at` 8 min y ~23 h después de
`resolved_at` respectivamente — ritmo normal de revisión administrativa, no
un proceso automático).

`work_order_photos` tiene el set completo de fotos de cada avería, con
`created_at` coincidiendo con el `resolved_at` de cada ticket — es decir, el
cierre original **sí llegó al servidor completo** (fotos, firma, notas,
cambio de estado). El elemento que quedó en la cola local del dispositivo es
un **reintento duplicado** de ese mismo cierre, generado cuando la respuesta
de red del envío original se perdió (timeout/corte) después de que el
servidor ya había aplicado los cambios — `submitClosure` en
`src/stores/campo.ts` encola automáticamente ante cualquier error
clasificado como de red (`isNetworkError`), sin saber que el servidor ya
había terminado.

Por diseño, `performClosureSubmitInner` (`src/stores/campo.ts`) llama a
`assertWorkOrderMutable` (`src/lib/workOrderFinality.ts`) ANTES de reenviar
nada — así que el reintento está correctamente bloqueado (reenviarlo no
haría nada útil: la orden ya está resuelta y confirmada). **No hubo pérdida
de datos ni ninguna avería quedó sin cerrar.**

## Causa raíz del síntoma (por qué quedaba "atascado")

`flushQueue`/`offlineQueue.ts` no distinguía un **rechazo definitivo**
(`WorkOrderFinalError`, la orden ya tiene cierre administrativo) de un
**fallo transitorio** (red, sesión, validación). Cada vez que el técnico
reconectaba o pulsaba "Reintentar pendientes", el código:

1. Volvía a invocar `submit(item)` para ESE mismo envío ya definitivo —
   trabajo inútil garantizado a fallar siempre igual.
2. Guardaba el mismo `lastError` de nuevo, sin ninguna marca que permitiera
   a la interfaz explicar que esto no es un error de conexión.
3. No ofrecía ninguna vía para que el técnico/administrador revisara el
   contenido guardado (fotos/notas) y lo descartara — la única acción visible
   era "Reintentar", que nunca iba a resolver nada.

## Corrección (local, sin desplegar)

- `src/lib/workOrderFinality.ts`: `assertWorkOrderMutable` ahora lanza
  `WorkOrderFinalError` (en vez de `Error` genérico) — mismo mensaje
  (`FINAL_ORDER_MESSAGE`), pero identificable por tipo.
- `src/lib/offlineQueue.ts`:
  - `QueuedClosure.rejectedFinal` (nuevo campo persistido en IndexedDB):
    `true` solo cuando el último intento fue un `WorkOrderFinalError`.
  - `isDefinitiveRejection(e)`: clasifica el error atrapado.
  - `flushQueue`: un ítem con `rejectedFinal=true` se salta SIN volver a
    invocar `submit()` — nunca se reintenta solo, pero otras órdenes (y
    otros fallos transitorios) siguen sincronizando con normalidad, igual
    que antes. Un rechazo NUEVO se clasifica y persiste su tipo.
  - `discardFinalRejection(id, actorId)`: único punto para borrar un
    pendiente de la cola — rechaza explícitamente descartar nada que no
    tenga `rejectedFinal=true` confirmado, y nada que pertenezca a otra
    sesión/técnico. No hay ninguna vía que borre datos locales sin esa
    doble verificación.
- `src/components/campo/ClosureQueuePanel.vue`: un ítem con
  `rejectedFinal` muestra un mensaje distinto ("ya fue cerrada
  administrativamente... no se va a reintentar sola"), un botón para
  **ver el contenido guardado** (fotos con miniatura, notas, causa técnica,
  si incluye firma) y, solo después de abrir esa vista, el botón **"Ya lo
  revisé — descartar este pendiente"** con confirmación explícita. Los
  fallos transitorios conservan el comportamiento anterior sin cambios.

No se tocó ningún backend/RPC/migración — `work_order_is_final` y las
guardas de `work_order_point_confirmations` siguen intactas. No se modificó
ninguna avería real (`6429c487...`, `dbfa2d4a...` no se tocaron, solo se
leyeron).

## Pruebas

Nueva suite dedicada (patrón ya usado por el proyecto para `offlineQueue.ts`
— Vite + Chrome headless vía CDP, IndexedDB real, `supabase.rpc` sintético,
red externa bloqueada):

```
node scripts/tests/work-order-finality-browser.mjs
```

**20/20 PASS.** Cubre exactamente los casos pedidos:

- Clasificación: `WorkOrderFinalError` real (vía `assertWorkOrderMutable`)
  reconocido por `isDefinitiveRejection`; un `TypeError` de red, un objeto
  plano `{code:'PGRST301'}` y `null` NO se clasifican como definitivos.
- Caso real reproducido con los 2 IDs: una orden con cierre administrativo
  previo y otra con un corte de red pasajero en la MISMA pasada de
  `flushQueue` — ninguna bloquea a la otra.
- Reconexión: en el segundo `flushQueue`, el rechazo definitivo se SALTA
  (nunca vuelve a invocar `submit`) mientras el transitorio se reintenta y
  sincroniza solo.
- Reinicio de app (recarga real del navegador): el rechazo definitivo
  persiste en IndexedDB con `rejectedFinal=true`, notas, causa técnica y
  bytes de las 2 fotos + firma intactos byte a byte.
- Un tercer `flushQueue` posterior tampoco lo reintenta (no se "cura" solo).
- `discardFinalRejection` rechaza borrar un pendiente que NO es un rechazo
  definitivo confirmado, y rechaza borrar uno de otra sesión/técnico; solo
  descarta el que sí corresponde.

Suite existente de la misma cola offline sin regresión:
`node scripts/tests/iptv-mode-browser.mjs` → **30/30 PASS**.

`vue-tsc -b --pretty false` y `vite build` sin errores (aviso preexistente
de tamaño de chunk, no relacionado).

## Archivos de este cambio

- `src/lib/workOrderFinality.ts`
- `src/lib/offlineQueue.ts`
- `src/components/campo/ClosureQueuePanel.vue`
- `scripts/tests/work-order-finality-browser.html`, `work-order-finality-browser.mjs`
- Este documento.

## Estado

Implementación y pruebas locales únicamente. Sin push, sin migración, sin
despliegue, sin ninguna escritura a Supabase de producción (solo lecturas
de diagnóstico). Pendiente: que el técnico abra "Cierres guardados" en
campo, confirme visualmente que reconoce el nuevo mensaje/flujo y descarte
sus 2 pendientes reales una vez conforme con el contenido mostrado.
