# Hosts bloqueado por tareas ajenas atascadas — diagnóstico y corrección (2026-10-29)

Continuación directa de `docs/TR069-HOSTS-DESPLIEGUE-SENAL-Y-DIAGNOSTICO-20261029.md`
y de las dos investigaciones de comunicación TR-069 posteriores — no se repite
ese diagnóstico (la Huawei sigue sin Inform real; eso es un problema de red/
ACS externo, ya documentado, no de este código).

## FASE 1 — Diagnóstico focalizado (solo lectura)

**1-2. Las tareas reales, releídas en este momento:**
Ya no son 4 — son **8**, todas `refreshObject` sobre
`InternetGatewayDevice.DeviceInfo`, mismo patrón, sin ningún `fault`
asociado (`GET /faults` vacío):

| `_id` | Creada (UTC) |
|---|---|
| `6ae3af8646fe832efbe32759` | 20:41:42.369 |
| `6ae3bed17fa4292e9af38585` | 21:46:57.032 |
| `6ae3bed47fa4292e9af38586` | 21:47:00.692 |
| `6ae3c149bcd68642fb694bd0` | 21:57:29.242 |
| `6ae3c4e423e23e9ee96836d2` | 22:12:52.035 |
| `6ae3c51746fe832efbe3275a` | 22:13:43.732 |
| `6ae3c5ef23e23e9ee96836d3` | 22:17:19.555 |
| `6ae3c94623e23e9ee96836d4` | 22:31:34.847 |

`_lastInform`/`_lastBoot` del equipo: sin cambios (`20:11:52.625Z` /
`17:04:18.304Z`) — confirma que **ninguna** de estas tareas progresó ni lo
hará mientras el equipo no vuelva a conectarse; se siguen acumulando con
cada clic del botón general "Actualizar" de la tarjeta TR-069
(`queueRefresh`, no Hosts).

**3. Condición exacta del backend que bloquea (antes de esta corrección):**
`server/src/services/tr069HostsOnDemand.ts`, dentro de `perform()`:
```ts
if (tasks.length) throw new HostsDemandError('El equipo tiene otra operación pendiente...');
```
Bloqueaba por la sola **existencia** de cualquier tarea para el equipo, sin
mirar su antigüedad, su nombre ni si realmente seguía progresando.

**4. Activas vs. atascadas:** ninguna de las 8 tiene menos de 5 minutos de
antigüedad al momento de este diagnóstico — todas cumplen el nuevo criterio
de "atascada" (ver Fase 2).

## FASE 2 — Corrección local aplicada

Único archivo de código tocado: `server/src/services/tr069HostsOnDemand.ts`.

```ts
export const FOREIGN_TASK_STALE_AFTER_MS = 5 * 60_000;
...
const nowForTasks = now();
const blockingTasks = tasks.filter(t => {
  const age = nowForTasks - Date.parse(t.timestamp);
  return !Number.isFinite(age) || age < FOREIGN_TASK_STALE_AFTER_MS;
});
if (blockingTasks.length) throw new HostsDemandError('El equipo tiene otra operación pendiente. Espera antes de solicitar una lectura.');
```

- **Punto 1 (no bloquear indefinidamente):** una tarea ajena con más de 5
  minutos de antigüedad ya no cuenta — Hosts sigue adelante con su propia
  lectura, acotada y distinta.
- **Punto 2 (mantener el bloqueo si hay algo realmente activo):** cualquier
  tarea con menos de 5 minutos sigue bloqueando exactamente igual que
  antes — 5 minutos es varias veces el tiempo máximo real de un intento
  completo (`connection_request` 12 s + envío 15 s + lecturas de cola, todo
  bajo el minuto), así que nunca se corta algo genuinamente en curso.
- **Punto 3 (nunca "completada" solo por tiempo):** el mensaje y el
  resultado de ESA tarea ajena no cambian — no se le asigna ningún estado
  nuevo, ni se afirma que terminó bien o mal. Solo deja de ser un motivo
  para que Hosts se niegue a intentar su propia lectura.
- **Punto 4 (nunca borrar/cancelar):** el código no llama a `DELETE` sobre
  ninguna tarea ajena — se verificó con una prueba dedicada
  (`assert.ok(!l.calls.some(c => c.method === 'DELETE'))`).
- **Punto 5 (mensaje sencillo):** sin cambios en los mensajes existentes —
  ya eran simples y correctos; el fallo era la condición que decidía
  mostrarlos, no el texto.
- **Punto 6 (sin polling):** sin cambios en el mecanismo de consulta — sigue
  disparándose únicamente al abrir Hosts o pulsar "Actualizar".

Una tarea ajena **sin** fecha utilizable (`timestamp` ausente o inválido)
se trata como si pudiera seguir activa — nunca se asume vieja sin poder
confirmarlo (mismo criterio conservador ya usado en el resto del proyecto).

## FASE 3 — Pruebas (todas nuevas en `tr069HostsOnDemand.test.ts`)

- Tarea ajena **reciente** (1 min): sigue bloqueando igual que antes.
- Tarea ajena **vieja** (6 min): ya no bloquea; Hosts envía su propia
  lectura (`posts:1`) y **cero** `DELETE` contra la tarea ajena.
- **Límite exacto**: a 4 min 59.999 s todavía bloquea; a 5 min exactos ya
  no — el umbral es preciso, no aproximado.
- **Varias tareas ajenas mezcladas** (una vieja de 20 min, otra de 10 min,
  una reciente de 30 s): sigue bloqueando — una sola tarea reciente entre
  varias viejas basta, nunca se "promedia" ni se asume vieja por mayoría.
- Tarea ajena **sin `timestamp`**: sigue bloqueando (mismo comportamiento
  que ya probaba el caso "cola ocupada" existente — confirmado que no
  cambió).
- **Sin duplicar operaciones**: con una tarea ajena vieja de por medio, dos
  llamadas concurrentes a `read()` siguen compartiendo la misma promesa y
  envían una sola operación propia — igual que sin ninguna tarea ajena.
- Las 15 pruebas ya existentes del archivo (activas, completadas,
  timeout/fault, identidad, Huawei sin Inform reciente/"offline", feature
  gate, rutas/roles) se conservan **sin cambios de intención**, todas en
  verde.

Resultado: `npm run test:provisioning` **336/336 PASS** (antes 330, +6
nuevas); `npx tsc --noEmit -p tsconfig.server.json` limpio; contrato de
release 31/31 PASS (sin alcance declarado todavía — no hay deploy en esta
tarea). Nada de frontend se tocó (el mensaje "otra operación pendiente"
sigue llegando igual al panel; `plainHostsErrorMessage`, ya desplegado,
lo muestra tal cual).

## Propuesta concreta para las 8 tareas reales existentes (NO ejecutada)

**No se recomienda borrarlas.** Una vez autorizado el despliegue de esta
corrección, Hosts las ignorará automáticamente por antigüedad (todas ya
superan los 5 minutos) sin necesidad de tocar la cola de GenieACS. Quedan
exactamente donde están:
- Si el equipo alguna vez vuelve a conectarse, GenieACS se las entregará
  en esa misma sesión (son `refreshObject` inofensivos de solo lectura,
  no tareas de configuración) y se resolverán solas.
- Si se desea limpiar la cola de GenieACS por orden/higiene — no porque
  bloqueen Hosts, ya que con esta corrección no lo hacen —, eso es una
  decisión aparte que requeriría autorización específica y no se ejecuta
  en esta tarea.

## Archivos modificados

- `server/src/services/tr069HostsOnDemand.ts`
- `server/src/services/__tests__/tr069HostsOnDemand.test.ts`
- Este documento.

Ningún archivo de otras fases tocado. Sin cambios a WiFi/PPPoE/WAN/VLAN/
OLT/MikroTik/ACS/credenciales. Ninguna tarea de GenieACS enviada, borrada
ni cancelada durante este diagnóstico. **Sin push ni despliegue** — commit
local únicamente, a la espera de autorización.
