# Fase 2 — Punto de continuación (corrección de revisión externa, ronda 2)

Generado al llegar al límite de uso de la sesión. **No se desplegó nada, no se aplicó
ninguna migración en producción, no se ejecutó ninguna escritura en la OLT ni en
MikroTik.** Todo lo de abajo son archivos locales sin comitear.

## Contexto: qué diff es cuál

- **Fase 1 Telnet** (confiabilidad del cliente Telnet) ya está **comiteada y
  desplegada** — commits `4bc4a5b` y `3888a62`, HEAD actual del repo. No tocar.
- **Fase 2 "ronda 1"** (aprovisionamiento confiable, primera entrega) **nunca se
  comiteó** — ChatGPT la revisó directo sobre el working tree.
- **Fase 2 "ronda 2"** (esta sesión: 8 correcciones pedidas por la revisión externa)
  se aplicó **encima** de la ronda 1, también sin comitear.
- Por lo tanto: `git diff` contra HEAD ahora mismo muestra ronda 1 + ronda 2
  **combinadas** (no hay un commit intermedio que las separe). El diff adjunto
  (`docs/auditoria/fase-2-ronda2-trabajo-actual.diff`) es exactamente eso — el
  estado COMPLETO y actual de la Fase 2, distinto de la Fase 1 (que no aparece ahí
  porque ya está comiteada).

## Qué se corrigió en esta ronda (de los 8 puntos pedidos)

| # | Punto pedido | Estado |
|---|---|---|
| 1 | Integrar `runProvisioningPipeline` con las rutas reales; no marcar `completed` hasta terminar todas las etapas pedidas; registrar pasos de cliente/contrato, MikroTik y WAN; recuperar al reabrir el panel | **Hecho en backend** (`oltProvisioningHandler.ts` + rutas reescritas). **Frontend NO actualizado todavía** (ver pendientes). |
| 2 | `idempotencyKey` ligada a una solicitud inmutable (conflicto si cambian los datos); resolver carrera de inserción concurrente sin error de duplicado ni perder el historial | **Hecho** (`identityMatches` + manejo de `duplicateKey` en `oltProvisioningHandler.ts`/`oltProvisioningStore.ts`). Sin pruebas todavía (ver pendientes). |
| 3 | Operación completada devuelve la ONT; frontend valida antes de usar `result.ont!` | **Hecho en backend** (`completedOperationResult` en el handler). **Frontend NO actualizado** (sigue con `result.ont!` en `AuthorizeOnuModal.vue`, heredado de la ronda 1). |
| 4 | Estado "pendiente de verificar" si falla la relectura; registrar el onu-id ANTES de escribir; un rechazo posterior no prueba que lo anterior no se aplicó | **Hecho y probado** (`verify_uncertain`, etapa `resolve_id`, `outcomeNeedsReconciliation` en `oltProvisioningService.ts` — 30/30 pruebas pasan, incluidos escenarios 3c/3d/8b nuevos). |
| 5 | Revisar TODOS los errores de persistencia; actualizaciones atómicas para el historial; nunca responder como guardado si la BD rechazó la actualización | **Hecho en backend**: migración `fase136b` con función atómica `append_provisioning_step` (probada con 40 llamadas concurrentes reales, 0 perdidas, ver abajo); `oltProvisioningStore.ts` revisa el `error` de cada llamada; el handler devuelve `httpStatus 207` + `persistenceWarning` si el UPDATE final falla. **Sin pruebas de ruta todavía** (ver pendientes). |
| 6 | No asumir el formato de `show running-config interface gpon-olt_...`; usar una fuente completa ya comprobada; el simulador debe rechazar comandos desconocidos | **Hecho y probado** — `provisionOnt()` ya no usa `portRunningConfigCommand` para verificar (usa `fullRunningConfigCommand`, confirmado contra el equipo real); `fakeOltCli.ts` ahora rechaza cualquier comando no modelado con `% Unrecognized command` en vez de simular éxito. |
| 7 | Proteger la elección de ID frente a escaneos vacíos/incompletos; combinar config+estado; no confundir fallo de parsing con puerto vacío | **Hecho y probado** — `collectUsedOnuIds()` combina ambas fuentes; `looksLikeParseFailure()` + outcome `scan_unreliable` detienen todo antes de elegir un id si el formato es sospechoso. |
| 8 | `crypto.randomUUID()` puede no existir en `http://192.168.55.201` (contexto no seguro) | **NO iniciado todavía** — sigue pendiente por completo. |

## Archivos modificados/nuevos en esta sesión (Fase 2, rondas 1+2 combinadas)

**Backend — nuevos:**
- `server/src/services/oltProvisioningService.ts` (motor OLT — reescrito en ronda 2)
- `server/src/services/oltProvisioningStore.ts` (**nuevo en ronda 2** — capa de acceso a datos con chequeo de errores)
- `server/src/services/oltProvisioningHandler.ts` (**nuevo en ronda 2** — orquestación testeable que unifica provision/reconcile)
- `server/src/services/__tests__/fakeOltCli.ts` (simulador CLI — corregido en ronda 2: rechaza comandos desconocidos, soporta `closeAfterApply`/`customResponse`)
- `server/src/services/__tests__/fakeProvisioningStore.ts` (**nuevo en ronda 2, SIN TESTS QUE LO USEN TODAVÍA** — ver "siguiente paso")
- `server/src/services/__tests__/oltProvisioningService.test.ts` (30 pruebas, actualizado en ronda 2)

**Backend — modificados:**
- `server/src/routes/olt.ts` (rutas de provisión **reescritas** para usar el handler nuevo)
- `server/src/ssh/zteCommands.ts` (advertencia reforzada sobre `portRunningConfigCommand`, sin confirmar)

**Base de datos — nuevas migraciones (NO aplicadas en producción):**
- `supabase/migrations/20261009100000_fase136_olt_aprovisionamiento_confiable.sql` (tabla `olt_provisioning_operations`, ronda 1)
- `supabase/migrations/20261009110000_fase136b_provisioning_atomic_steps.sql` (**nueva en ronda 2** — función `append_provisioning_step` atómica)

**Frontend — heredados de la ronda 1, SIN cambios en ronda 2 (pendiente):**
- `src/stores/olt.ts`
- `src/views/olt/AuthorizeOnuModal.vue`
- `package.json` (scripts de test)

## Pruebas ejecutadas y resultados reales

```
npm run test:telnet         → 21 pass, 0 fail (sin cambios, confirmado sin regresión)
npm run test:provisioning   → 30 pass, 0 fail (oltProvisioningService.ts — motor OLT completo)
npx tsc -p tsconfig.server.json --noEmit  → sin errores (backend completo, incluye las rutas reescritas)
```

**Migración atómica — probada en Postgres local descartable (Docker, no en producción):**
```
40 llamadas CONCURRENTES a append_provisioning_step() sobre la MISMA fila
→ jsonb_array_length(steps) = 40   (ninguna perdida — confirma que la version
  ATOMICA no sufre la carrera de "lost update" que tenia el SELECT+UPDATE viejo)
```

**NO ejecutado todavía en esta sesión:**
- `npm run test:fetch-timeout` (fix de señal, de la fase anterior — no debería haberse tocado, pero no se re-confirmó en esta sesión puntual).
- `npx vue-tsc -p tsconfig.app.json --noEmit` (frontend) — **no se corrió después de los cambios de backend**; dado que el frontend NO se tocó en esta ronda, debería seguir limpio, pero no está confirmado con una corrida real en esta sesión.
- Ninguna prueba de `oltProvisioningHandler.ts` ni de `routes/olt.ts` reescritas — el archivo `fakeProvisioningStore.ts` se creó pero **ningún archivo de test lo importa todavía**.
- `npm run build` (build de producción) no se corrió en esta sesión.

## Errores pendientes / estado de compilación

**El código compila limpio** (`npx tsc -p tsconfig.server.json --noEmit` sin salida,
confirmado como último paso antes de este resumen). No hay errores de TypeScript
conocidos en este momento.

Dos detalles de diseño a vigilar en el siguiente paso (no son errores de compilación,
son huecos de cobertura):
1. `oltProvisioningHandler.ts` fue escrito pero **nunca ejecutado contra datos reales
   ni contra el store falso** — toda su lógica (conflicto de idempotencia, carrera de
   inserción, status `completed` solo con todo ok, `persistenceWarning` cuando falla
   un UPDATE) está sin probar en esta sesión.
2. `routes/olt.ts` fue reescrito (las rutas `/provision`, `/operations/:opId`,
   `/operations/:opId/reconcile`) pero tampoco tiene ninguna prueba — se confirmó
   solo que compila, no que su comportamiento en runtime sea correcto.

## Siguiente paso exacto

1. Escribir `server/src/services/__tests__/oltProvisioningHandler.test.ts` usando
   `createFakeProvisioningStore()` (ya existe, sin usar) + el simulador real
   `fakeOltCli.ts` (ya existe) + funciones `syncMikrotik`/`buildSyncWan` falsas
   inline. Cubrir como mínimo:
   - Punto 2: mismo `idempotencyKey` con datos distintos → `httpStatus 409`, cero
     comandos Telnet mandados (contar vía `onCommand` del simulador).
   - Punto 2: dos llamadas a `handleProvisionRequest` "concurrentes" (en este store
     fake, llamarlas con `Promise.all`) con la MISMA clave → ninguna debe fallar por
     "duplicate key" visible al caller, ambas deben terminar apuntando a la MISMA
     fila de operación, con el historial completo (nada perdido).
   - Punto 3: operación ya `completed` (insertar directo en
     `fakeStore._operations`/`_onts` antes de llamar al handler) → la respuesta debe
     incluir `ont` sin ser `null`.
   - Punto 5: usar `fakeStore.failures.updateOperationOnce = true` antes de una
     llamada que termina en OLT ok → la respuesta debe tener `httpStatus 207` y
     `persistenceWarning`, y el `operation.status` devuelto debe ser el VIEJO
     (`pending`/lo que fuera antes), nunca `completed`.
   - Pipeline completo con `syncMikrotik`/`buildSyncWan` fake que fallan, para
     confirmar que el `status` final queda en `mikrotik_pending`/`linking` (no
     `completed`) y que el frontend (cuando se actualice) tendría de donde leer qué
     falta.
2. Una vez esas pruebas pasen, recién ahí tocar el **frontend** (punto 1 y 3 de la
   revisión): `AuthorizeOnuModal.vue` debe:
   - Guardar `operation.id` devuelto por `POST /provision` en algún lado persistente
     del lado cliente (ej. `localStorage` por `idempotencyKey`) para poder
     recuperarlo si se cierra y reabre el panel (requisito 1).
   - Cambiar `continueAfterOlt(result.ont!)` por una comprobación explícita:
     `if (result.outcome.kind !== 'registered' && result.outcome.kind !== 'already_registered') { ...no continuar... }`
     y `if (!result.ont) { ...mostrar error, no asumir... }` ANTES de usar `result.ont`.
3. Punto 8 (`crypto.randomUUID`): crear `src/lib/idempotencyKey.ts` con un
   `generateIdempotencyKey()` que compruebe `typeof crypto?.randomUUID === 'function'`
   antes de usarlo, con fallback a `crypto.getRandomValues` (NO restringido a
   contexto seguro) y un último fallback con `Math.random()`. Agregar una prueba con
   `node:test` que borre/mockee `globalThis.crypto.randomUUID` temporalmente y
   confirme que igual devuelve una clave utilizable. Usar esta función en
   `AuthorizeOnuModal.vue` en vez de `crypto.randomUUID()` directo.
4. Correr `npm run test:fetch-timeout`, `npx vue-tsc -p tsconfig.app.json --noEmit` y
   `npm run build` al menos una vez para confirmar que el frontend sigue sano después
   de los cambios de los pasos 2-3.
5. Recién al final: actualizar `docs/auditoria/fase-2-aprovisionamiento.html`
   distinguiendo explícitamente qué quedó probado (motor OLT: 30/30) de qué quedó
   solo revisado a mano (rutas/handler, hasta que el paso 1 de arriba agregue
   pruebas) — el informe anterior afirmaba cobertura de rutas que en esta ronda
   todavía no existe; corregir esa afirmación también es parte de la tarea pedida
   por la revisión externa ("Actualiza el informe distinguiendo lo probado de lo
   pendiente").
6. El procedimiento de despliegue del informe debe describir Docker
   (`docker compose -f docker-compose.onprem.yml up -d --build` vía
   `deploy/update.sh`, igual que en la Fase 1), no `pm2`/genérico — el informe
   anterior tenía este detalle incorrecto, señalado explícitamente por la revisión.

## Diff completo de esta sesión

Archivo: `docs/auditoria/fase-2-ronda2-trabajo-actual.diff` (2906 líneas) — contiene
TODO el trabajo de Fase 2 (ronda 1 + ronda 2, combinadas porque nunca se comiteó nada
entre medio), comparado contra el HEAD actual del repo (`3888a62`, que es
exclusivamente Fase 1 ya desplegada). Incluye, como archivos nuevos completos:
`oltProvisioningService.ts`, `oltProvisioningStore.ts`, `oltProvisioningHandler.ts`,
`fakeOltCli.ts`, `fakeProvisioningStore.ts`, `oltProvisioningService.test.ts`, y las
dos migraciones. Como archivos modificados: `routes/olt.ts`, `zteCommands.ts`,
`src/stores/olt.ts`, `src/views/olt/AuthorizeOnuModal.vue`, `package.json`.

No se generó todavía el diff "solo ronda 2" aislado de la ronda 1 — como nunca hubo
un commit entre ambas, separarlas requeriría reconstruir la ronda 1 desde el reporte
anterior, lo cual no se hizo en esta sesión (no era parte de lo pedido ahora).
