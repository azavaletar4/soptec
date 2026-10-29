# Hosts — "No se pudo completar la consulta" en producción: diagnóstico y corrección (2026-10-29)

Reporte: en producción (backend/frontend `eb96f77b7dca`, sin el historial
ni la señal WiFi todavía desplegados — esos siguen en candidatos locales
`4cf4ae8`/`0b0fc28`/`ddcf083`), al consultar Hosts el panel mostraba
"No se pudo completar la consulta. Se conserva la información anterior;
vuelve a intentarlo cuando lo decidas."

## Diagnóstico (solo lectura, cero tareas a GenieACS, nada modificado)

Se ejecutó el **código real desplegado** dentro del contenedor
(`docker exec smartrayco-backend-1 npx tsx <script temporal>`, borrado al
terminar) llamando directamente a `hostsOnDemand.read(nbi, 'HWTC1D3691B7')`
— la misma función que usa la ruta HTTP, sin pasar por la capa de
autenticación (no se necesitaba para diagnosticar, no se expuso nada).

**Resultado real:**
```json
{"ok": false, "ms": 106, "name": "HostsDemandError",
 "message": "El equipo no tiene comunicación reciente. Se conserva la información anterior."}
```

Causa exacta: `_lastInform` del equipo = `2026-10-29T20:11:52.625Z`;
reloj del servidor en el momento = `2026-10-29T20:30:26 UTC` (y seguía
igual a las `20:34:13 UTC`, confirmado con una segunda lectura) — más de
18-22 minutos sin un Inform nuevo. El guard ya existente en
`server/src/services/tr069HostsOnDemand.ts` (`informAge > 10 * 60_000`)
bloquea correctamente cualquier lectura activa cuando el equipo no se ha
comunicado en los últimos 10 minutos — **a propósito**, para no intentar
una lectura contra un equipo que podría no responder. No es un error de
nuestro código: es la Huawei de prueba sin Inform reciente en este
momento.

**Descartado explícitamente, con evidencia real:**
- **GenieACS**: contenedor `healthy`, 4+ horas arriba sin reinicios ni
  errores en sus logs; responde normal a consultas de caché (confirmado
  con una segunda lectura independiente, `GET` puro, 78 ms, found=true,
  4 Hosts).
- **Identidad**: el equipo se encontró e identificó sin ambigüedad
  (`match.device` resuelto en el primer intento, sin excepción de
  identidad).
- **Timeout**: la función falla en 106 ms — **antes** de intentar ningún
  `connection_request` o POST a GenieACS. No hay ningún timeout de red
  involucrado en este fallo puntual.
- **Red backend↔GenieACS**: funciona (la misma llamada de solo lectura
  que GenieACS respondió confirma la conectividad).

**Conclusión: no hay ningún error reproducible en nuestro código para la
causa original del fallo.** Es una condición externa real (el equipo de
prueba lleva un rato sin comunicarse) correctamente detectada y rechazada
por una protección que ya existía y ya estaba probada. Mientras el equipo
no vuelva a informar, esta lectura activa seguirá rechazándose — es el
comportamiento correcto, no hay nada que "arreglar" en esa parte.

## Gap real encontrado (sí corregido)

El mensaje que GenieACS/nuestro backend genera para este caso **ya está
escrito en lenguaje sencillo para el administrador**:
`"El equipo no tiene comunicación reciente. Se conserva la información
anterior."` (`server/src/routes/tr069HostsOnDemand.ts`, responde HTTP 409
con ese texto exacto para cualquier `HostsDemandError`). Pero el panel
(`src/lib/tr069HostsPanel.ts`) **descartaba ese mensaje por completo** y
mostraba siempre el mismo texto genérico, sin importar la causa real —
eso es lo que el administrador veía, sin ninguna pista de qué pasó
realmente ni de que el equipo simplemente no se ha comunicado.

### Corrección aplicada

Nueva función pura `plainHostsErrorMessage` en `src/lib/tr069HostsPanel.ts`:
solo confía en el mensaje del servidor cuando el error viene con
`status === 409` exacto de esta ruta (la única que garantiza, por diseño
del propio código del servidor, que su texto siempre está en lenguaje
sencillo — nunca una traza ni un mensaje técnico crudo). Cualquier otro
fallo (falla de red, timeout del cliente a los 55 s, un 502 del `GET`
pasivo cuyo mensaje no tiene esa misma garantía, cualquier excepción sin
`status`) conserva el mensaje genérico de siempre — nunca se expone un
texto técnico sin traducir.

```ts
export function plainHostsErrorMessage(error: unknown): string {
  if (error instanceof Error && (error as { status?: unknown }).status === 409 && error.message.trim()) return error.message;
  return GENERIC_HOSTS_ERROR;
}
```

**El historial anterior ya se conservaba correctamente** (objetivo 5):
`load()` nunca tocaba `state.inventory[key]` en el `catch` — se confirmó
con una prueba nueva que, tras una lectura exitosa, un fallo posterior no
pisa ni el inventario ni el último resultado confirmado. No se tocó esa
parte porque ya funcionaba bien; solo se corrigió qué mensaje se muestra.

## Pruebas (objetivo 7 incluido)

`src/lib/__tests__/tr069HostsPanel.test.ts` (+3 pruebas nuevas, 7 en
total, todas PASS):
- `plainHostsErrorMessage`: 409 con mensaje real (dos ejemplos reales:
  "sin comunicación reciente" y "operación pendiente") lo expone tal
  cual; 409 sin mensaje, 502, error de red, timeout del cliente
  (`DOMException`/`TimeoutError`) y valores no-`Error` caen todos al
  mensaje genérico.
- Un fallo con causa real conocida (409) la muestra tal cual al
  administrador.
- Una lectura previa exitosa permanece visible **intacta** (mismo objeto,
  no una copia) cuando la siguiente consulta falla con el motivo real.
- Las 4 pruebas ya existentes (incluida "crear panel... no consulta" que
  confirma la ausencia de polling) se conservan sin cambios de intención.

Resultado: frontend-lib **501/501 PASS** (antes 498); backend
**330/330 PASS** (sin cambios, esta corrección es solo frontend);
contrato de release 31/31 PASS; `tsc`/`vue-tsc` limpios.

**Confirmado: sin polling.** La prueba "crear panel, renders o refrescar
con Hosts cerrado no consulta" sigue intacta y en verde — Hosts solo
consulta al abrir la sección o pulsar "Actualizar", exactamente igual que
antes de esta corrección.

## Mejora de señal WiFi (objetivo 6)

**Sin tocar.** `ddcf083` y `0b0fc28` siguen exactamente como quedaron;
esta corrección no modifica `tr069HostsSignal.ts`, `tr069Hosts.ts`
(backend) ni la presentación de señal en `src/lib/tr069Hosts.ts`.

## Qué verá el administrador mientras el equipo no informe

Hasta que la Huawei de prueba vuelva a enviar un Inform (periódico o por
reconexión), pulsar "Actualizar" seguirá mostrando — ahora con el mensaje
real — "El equipo no tiene comunicación reciente. Se conserva la
información anterior." Esto es informativo, no un error del sistema: la
lista de dispositivos conectados que ya se había leído sigue visible tal
cual (con sus fechas reales, degradando a "Sin confirmar" cuando
corresponda, como siempre). La lectura **pasiva** (`GET`, usada por roles
sin permiso de lectura activa) no depende de esto y sigue funcionando
siempre que haya caché — confirmado con una segunda prueba de solo
lectura independiente (found=true, 4 Hosts, 78 ms).

## Procedimiento exacto de publicación (preparado, NO ejecutado)

Cuando se autorice, publicar junto con los dos candidatos ya preparados
(mismo alcance TR-069 Hosts, sin mezclar con otras fases):

1. `git push origin main` (fast-forward ya verificado contra
   `origin/main`, sin force/merge/rebase) — incluye, en orden,
   `ddcf083` (investigación señal), `0b0fc28` (señal implementada) y el
   commit de esta corrección.
2. Actualizar `deploy/consolidation-release-scope.json`:
   `sourceCommit` = el commit de esta corrección; `backendSources` sin
   cambios respecto a `0b0fc28` (`genieacsSync.ts`, `tr069HostsOnDemand.ts`,
   `tr069HostsHistory.ts`, `tr069Hosts.ts`, `tr069HostsSignal.ts` — revisar
   cuáles cambiaron realmente desde el commit desplegado `eb96f77`);
   `frontendSources` agrega `src/lib/tr069HostsPanel.ts` y
   `src/lib/__tests__/tr069HostsPanel.test.ts` a los ya declarados en
   `0b0fc28` (`tr069Hosts.ts`, `Tr069View.vue`, etc.).
3. Regenerar `release-source.json`
   (`node scripts/frontend-release-build.mjs --export-snapshot`) con HEAD
   en el commit final.
4. `node scripts/frontend-consolidation-release.cjs prepare` → `build` →
   `deploy` → `verify`, en ese orden, verificando cada resultado antes de
   continuar (mismo procedimiento ya usado en los despliegues anteriores
   de Hosts). Confirmar `frontendChangedAssets` y el alcance backend
   coinciden exactamente con lo declarado — detenerse si no.
5. Verificación post-despliegue: `GET /api/health`, las 11 rutas ya
   usadas, `401` sin autenticación, cola GenieACS vacía, y repetir el
   mismo diagnóstico de solo lectura de esta sesión
   (`hostsOnDemand.read` vía `docker exec`) para confirmar que el mensaje
   real se sigue generando igual en el backend ya desplegado.
6. Actualizar `CLAUDE.md`/`ESTADO_DESARROLLO.md` con el resultado real del
   despliegue (imágenes antes/después, hashes, resultado de las 4 fases).

No ejecutar nada de esto sin que el propietario lo autorice explícitamente
en ese turno (regla 16 de `CLAUDE.md`).

## Archivos modificados en esta sesión

- `src/lib/tr069HostsPanel.ts` (`plainHostsErrorMessage`, `GENERIC_HOSTS_ERROR`)
- `src/lib/__tests__/tr069HostsPanel.test.ts` (+3 pruebas)
- Este documento.

Ningún archivo de otras fases tocado. Sin cambios a WiFi/PPPoE/WAN/VLAN/
ONT/OLT/MikroTik. Sin migraciones. Sin tareas nuevas a GenieACS (todas las
consultas de este diagnóstico fueron `GET`/lectura directa de función,
cero `POST` reales a GenieACS). **Sin publicar ni desplegar.**
