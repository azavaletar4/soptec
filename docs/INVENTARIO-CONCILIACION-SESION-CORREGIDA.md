# Corrección: Conciliación se recupera al cambiar de pestaña (18/10/2026)

## Causa raíz demostrada

`InventarioConciliacionView.vue` tenía:

```js
watch(() => [auth.user?.id, auth.role], () => {
  generation++; controller?.abort(); rows.value = []; checkedAt.value = '';
  loading.value = false; error.value = 'La sesión cambió. Vuelve a abrir el reporte.';
}, { flush: 'sync' });
```

`onAuthStateChange` (`src/stores/auth.ts`) reemplaza `user.value` por un
objeto **nuevo** en cada evento de Supabase, incluido `TOKEN_REFRESHED` —
y Supabase dispara ese refresco rutinariamente al recuperar el foco de una
pestaña del navegador, aunque el usuario y el rol sigan siendo exactamente
los mismos. El watcher usaba un **solo getter que arma un array literal**
(`() => [a, b]`): Vue compara la *identidad del array devuelto*, no sus
valores — cada evaluación crea un array nuevo, así que el callback se
disparaba en **cualquier** renovación de sesión, real o no. No era un
problema de RLS, de permisos, ni de "petición tardía": era el watcher
reaccionando a una referencia de objeto que cambió sin que el id ni el rol
cambiaran de verdad.

Confirmado con la forma correcta de Vue (`watch([a, b], cb)`, múltiples
fuentes comparadas por valor) más una comparación explícita adicional como
defensa independiente de ese detalle interno — ver
`src/lib/reconciliationSessionGuard.ts` y sus pruebas, que reproducen la
reasignación de objeto exacta que dispara el bug y demuestran que, con la
corrección, ya no dispara el cambio.

## Corrección (mínima, local, sin tocar backend)

- **`src/lib/reconciliationSessionGuard.ts`** (nuevo, puro):
  - `watchSessionIdentity(getUserId, getRole, onIdentityChanged)` — dispara
    solo cuando el id de usuario o el rol cambian de **valor**, nunca por
    una renovación de sesión del mismo usuario.
  - `isReconciliationResultCurrent(requested, current)` — una lectura solo
    se aplica si sigue siendo la petición vigente (no fue reemplazada ni
    abortada), del mismo usuario y del mismo rol; antes solo se comparaba
    el usuario, no el rol, dejando una ventana donde un cambio de rol a
    mitad de una lectura en curso podía aplicarse igual.
- **`InventarioConciliacionView.vue`**: usa ambas funciones en vez de la
  lógica inline. `load()` ahora también descarta el resultado si el rol
  cambió mientras la lectura estaba en curso (regla 5/6 del encargo). Se
  agregó un botón **"Reintentar"** junto al mensaje de error (además del ya
  existente "Actualizar lectura" de la cabecera), para que un fallo
  recuperable siempre tenga una acción clara y visible sin que el usuario
  tenga que buscarla (regla 7).
- Pestañas "Necesitan revisión"/"Todo el inventario", sus filtros,
  contadores y el enlace "Avería vinculada" — **sin cambios**, verificado
  por la prueba de navegador existente, que sigue en verde.

## Pruebas

- **`src/lib/__tests__/reconciliationSessionGuard.test.ts`** (nuevo, 5
  pruebas, usa la reactividad real de Vue — no una reimplementación):
  1. Reasignar `user.value` a un objeto **nuevo con el mismo id** (la causa
     raíz exacta: simula el `TOKEN_REFRESHED` del cambio de pestaña) → el
     callback **no** se dispara.
  2. Cambio real de usuario → sí se dispara.
  3. Cambio real de rol/permisos → sí se dispara.
  4. Cerrar sesión (usuario a `null`) → sí se dispara.
  5. `isReconciliationResultCurrent` descarta una respuesta tardía (otra
     petición ya en curso), de otro usuario, o de otro rol.
- Las 12 pruebas de `inventoryReconciliation.test.ts` y las 6 de
  `inventoryReconciliationReview.test.ts`: sin cambios, siguen en verde
  (23/23 en total).
- `vue-tsc -p tsconfig.app.json` y `npm run build`: sin errores.
- `scripts/tests/inventory-reconciliation-browser.mjs` (Chrome headless
  local, datos sintéticos, red real bloqueada): sigue en verde sin
  cambios — confirma que las pestañas, filtros, contadores, navegación al
  detalle/Kardex y el manejo de lectura fallida (sin resultados parciales)
  siguen intactos.

No se reprodujo el `TOKEN_REFRESHED` real de Supabase dentro del navegador
headless (la gestión interna de sesión de `@supabase/supabase-js` no está
expuesta para simularla de forma confiable desde ese guion sintético); la
prueba unitaria reproduce la causa raíz exacta (reasignación de objeto con
mismo id) usando la reactividad real de Vue, que es el mecanismo real del
bug — no una aproximación.

## Confirmación de alcance

Solo se tocó el ciclo de carga y el manejo de sesión de
`InventarioConciliacionView.vue` y su nueva dependencia pura
(`reconciliationSessionGuard.ts`). Sin tocar Supabase, RLS, RPC,
migraciones ni backend. Sin escrituras, sin tocar existencias, equipos,
movimientos, contratos ni órdenes reales — y sin ninguna lectura a
Supabase Cloud en esta sesión (el usuario está registrando ONT reales en
Inventario de producción en paralelo). Commit local creado; **sin push ni
despliegue**, pendiente de autorización.
