# Cancelar contratación no instalada — preparación local

Fecha: 2026-11-02. **Candidato local. Sin SQL aplicado, sin push, sin despliegue.**
Autorizado expresamente a implementar localmente el botón, el store y el
procedimiento administrativo, reutilizando la RPC ya preparada en la sesión
anterior y sus pruebas.

## Causa raíz

Cuando un prospecto acepta y se crea su cliente+contrato, si después rechaza
la instalación, `installations.status` pasa a `cancelled` — pero nada toca
`service_contracts.status` ni `clients.status`. El contrato queda `active`
indefinidamente y la ficha, según cómo se haya creado, puede quedar en
`prospect` crudo (el valor por defecto del formulario) sin que nadie lo note,
porque la pantalla de Clientes muestra siempre el campo crudo a propósito
(Fase 154, ver `docs/CLIENTES-BAJA-LINEA-ADMINISTRATIVA.md`).

La baja administrativa existente (`contract_cancel_administrative`) sí cancela
el contrato, pero cuando no queda ningún servicio vigente **siempre** deja al
titular `retired` — correcto para un ex-cliente real, incorrecto para quien
nunca llegó a recibir el servicio (debería volver a ser `prospect`, elegible
para una nueva venta). Esa es la pieza que faltaba y que agrega esta RPC.

Caso real que originó esto: **Jheraldin Vidal Cruz, CTR-2026-00297** — aceptó,
el técnico fue, rechazó la instalación. Mismo patrón confirmado (solo lectura,
sesión anterior) en **Fiorella Vidal Lopez (CTR-2026-00542)** y **Daniel
Gavidia Romero (CTR-2026-00763)**: los 3 tienen contrato `active` y su única
instalación registrada quedó `cancelled`, nunca `completed`.

## Solución implementada (local)

### Backend (SQL candidato, preparado en la sesión anterior)

- `docs/sql/contract-cancel-unfulfilled-proposal.sql` — RPC
  `contract_cancel_unfulfilled(contract_id, updated_at, reason, confirm)`,
  SECURITY DEFINER, exige **SUPERADMIN activo** (más estricto que la baja
  normal, que acepta ADMIN también), motivo (≥5 caracteres) y confirmación.
  Bloquea con un mensaje en español, sin jerga, si: hay una Alta abierta de
  esa línea, esa línea ya tuvo una instalación `completed`, ya tiene
  facturación asociada, tiene un ONT vinculado, tiene equipo/material
  asignado sin devolver, o tiene un ticket/rutina abierto — en todos esos
  casos dirige a usar la baja administrativa existente en su lugar. Si
  procede: cancela solo esa línea y recalcula el estado del titular
  (`active`/`suspended` si conserva otro servicio vigente; `retired` solo si
  alguna de sus instalaciones, de cualquier contrato, llegó alguna vez a
  `completed`; si no, `prospect`). Guarda motivo y antes/después en la nueva
  tabla insert-only `contract_unfulfilled_cancellations`. Reutiliza el mismo
  mecanismo de paso (`app.client_retirement_id`) que ya usa la guarda
  `contract_administrative_guard`, viva en producción — no la elude ni la
  rompe (probado explícitamente, ver abajo).
- `docs/sql/contract-cancel-unfulfilled-rollback.sql` — retira solo la
  función; conserva el historial y los estados ya escritos.

### Frontend (esta sesión)

- `src/stores/contracts.ts` — nueva acción `cancelContractUnfulfilled(id,
  updatedAt, reason)`, llama a la RPC; si todavía no está instalada en
  Supabase (`PGRST202`/`42883`) devuelve un mensaje claro en vez del error
  técnico de PostgREST, mismo criterio que `cancelContractAdministrative`.
- `src/views/clientes/ClientServiceDetailView.vue` — botón **"Cancelar
  contratación no instalada"**, visible solo si `auth.role === 'SUPERADMIN'`
  (computed `canCancelUnfulfilled`, mismo patrón que `canDeleteContracts`) y
  el contrato no está ya cancelado. Abre un modal propio (no reutiliza el
  selector de estado de la baja normal, porque tiene condiciones distintas):
  muestra el número de línea exacto que se va a cancelar, exige un motivo de
  al menos 5 caracteres (botón de confirmar deshabilitado hasta entonces), y
  un `confirm()` de navegador con el contrato y la consecuencia ("el cliente
  volverá a Prospecto si no tiene otro servicio vigente") antes de llamar a
  la RPC. Al terminar: actualiza `contract.value` con la respuesta real,
  emite `commercialCancelled` (mismo evento que la baja normal), y refresca
  `clientsStore.fetchClients()` para que la ficha del cliente se vea
  actualizada sin recargar la página — un fallo de ese refresco muestra
  "Cancelación confirmada..." en vez de dar la impresión de que falló. Un
  error de la RPC (incluido "todavía no está habilitada") se muestra tal
  cual, ya en lenguaje sencillo desde el propio SQL.

## Permisos — no solo el botón oculto

- Frontend: botón oculto a cualquiera que no sea SUPERADMIN.
- Backend/RPC: revalida `profiles.role = 'SUPERADMIN' and active` por sí
  misma, igual que la baja normal revalida ADMIN/SUPERADMIN — un ADMIN, un
  TECNICO_RED o un intento directo por SQL sin pasar por la RPC quedan
  rechazados aunque alguien se saltee la interfaz.
- RLS/guardas ya existentes en producción (`contract_administrative_guard`)
  siguen bloqueando cualquier `UPDATE` directo a `service_contracts.status`
  por fuera de una función autorizada — probado explícitamente que esta RPC
  nueva pasa esa guarda sin desactivarla ni debilitarla.

## Pruebas ejecutadas

```text
node --import tsx --test server/tests/contractCancelUnfulfilled.sql.test.ts
node --import tsx --test server/tests/contractCancelUnfulfilled.ui.test.mjs
node --import tsx --test server/tests/contractAdministrativeCancellation.sql.test.ts
node --import tsx --test server/tests/contractAdministrativeCancellation.ui.test.mjs
npx vue-tsc -p tsconfig.app.json --noEmit
```

| Comprobación | Resultado |
| --- | --- |
| Rechazo antes de instalación: única línea cancela, ficha vuelve a Prospecto, motivo guardado | PASS |
| Múltiples contratos: la línea hermana activa queda intacta, ficha sigue Activo | PASS |
| Cliente ya instalado (instalación `completed`): bloquea sin escribir nada, dirige a la baja | PASS |
| Material/equipo asignado sin devolver: bloquea | PASS |
| ONT vinculado / facturación asociada / ticket abierto / rutina abierta: bloquea cada uno | PASS |
| Recontratación posterior: tras volver a Prospecto, se puede crear un contrato nuevo | PASS |
| Alta todavía abierta (ni completada ni cancelada): bloquea, no es el caso de esta acción | PASS |
| Permisos: solo SUPERADMIN activo; ADMIN y los demás roles, anon y service_role quedan fuera | PASS |
| Motivo y confirmación obligatorios; ambos fallan cerrado sin escribir | PASS |
| Repetición tras respuesta perdida es idempotente | PASS |
| Nunca toca instalaciones/NAP/facturación/inventario de terceros | PASS |
| **Compatible con la guarda real `contract_administrative_guard` ya en producción; la baja normal sigue funcionando después** | PASS |
| Rollback: retira solo la función, conserva historial y estados | PASS |
| UI: motivo corto no llama a la RPC | PASS |
| UI: confirmación rechazada no escribe nada | PASS |
| UI: éxito actualiza contrato, emite el evento, refresca Clientes sin recargar | PASS |
| UI: fallo de la RPC conserva el contrato y muestra el mensaje tal cual (lenguaje sencillo) | PASS |
| UI: fallo de refresco no presenta como fallida una cancelación ya confirmada | PASS |
| UI: abrir el modal no funciona sobre un contrato ya cancelado | PASS |
| UI/store real: RPC ausente falla cerrada, sin UPDATE alternativo | PASS |
| Regresión — baja administrativa normal (SQL + UI), sin tocar | 10/10 + 5/5 PASS |
| `vue-tsc -p tsconfig.app.json` | limpio |

**21 pruebas SQL/UI nuevas + 15/15 de regresión de la baja normal, todas en
PostgreSQL 17 efímero (`--network none`, sin red ni credenciales reales) o
en un VM de Node aislado sin montar ningún módulo real.**

## Archivos

- `docs/sql/contract-cancel-unfulfilled-proposal.sql`,
  `docs/sql/contract-cancel-unfulfilled-rollback.sql` (sesión anterior).
- `server/tests/contractCancelUnfulfilled.sql.test.ts` (sesión anterior).
- `src/stores/contracts.ts`, `src/views/clientes/ClientServiceDetailView.vue`,
  `server/tests/contractCancelUnfulfilled.ui.test.mjs` (esta sesión).
- Este informe.

## Riesgos y lo que falta

- **Necesita migración**: la RPC y la tabla `contract_unfulfilled_cancellations`
  no existen todavía en Supabase (ni local ni producción). Sin ella, el botón
  queda visible para SUPERADMIN pero cualquier intento muestra el mensaje
  "Esta acción todavía no está habilitada..." — no hay error técnico crudo ni
  caída a un `UPDATE` alternativo.
- No se valida en un navegador real todavía (solo harness aislado + tsc) —
  pendiente antes de dar por cerrada la UI.
- La detección de "equipo asignado sin devolver" depende de que, para estos
  3 contratos reales, el inventario ya esté en `in_stock` (razonable: sus
  instalaciones se cancelaron después de Fase 59, que revierte
  automáticamente al cancelar una Alta) — se verifica en vivo antes de usar
  el botón sobre cada caso real, no se asume.
- No se tocó ningún dato real en esta sesión.

## Procedimiento de regularización — Jheraldin, Fiorella, Daniel

**Ninguno de los 3 se tocó todavía.** Antes de usar el botón sobre cualquiera,
en este orden:

1. **Aplicar y verificar la migración** (`contract-cancel-unfulfilled-proposal.sql`)
   en un entorno de prueba primero, con autorización explícita — no está
   incluida en esta entrega.
2. **Confirmar con campo/ventas**, para cada uno, que realmente nunca se
   instaló (su única Alta registrada está `cancelled`, no `completed`, pero
   eso no certifica por sí solo que el equipo nunca llegó a entregarse por
   otra vía — regla de la migración OLT: no asumir, verificar). Documentar
   la respuesta.
3. Si se confirma que no hay instalación real:
   - Abrir la ficha del contrato exacto (`CTR-2026-00297` / `CTR-2026-00542`
     / `CTR-2026-00763`) como SUPERADMIN.
   - Clic en "Cancelar contratación no instalada".
   - Motivo: registrar el hecho real confirmado en el paso 2 (ej. "Rechazó
     la instalación cuando llegó el técnico el 10/10/2026", con la fecha real
     de cada caso).
   - Confirmar. Verificar que el contrato quedó `cancelled` y la ficha del
     cliente `prospect` (no `retired`) — si el cliente tiene otra línea
     vigente, debe quedar `active`/`suspended` en su lugar; revisar antes de
     cerrar el caso.
4. Si el paso 2 revela que SÍ hubo instalación real (por otra vía no
   registrada en el sistema): no usar este botón — usar la baja
   administrativa existente, y antes vincular la instalación/equipo real que
   corresponda para no perder esa trazabilidad.
5. **"prueba prueba2" (CTR-2026-00768)** queda fuera de este procedimiento:
   su instalación está `completed` (prueba del flujo, no un cliente real) —
   esta RPC la bloquearía igual que a un cliente real instalado. Es un
   registro de prueba a limpiar aparte, no una contratación rechazada.
6. **Gustavo Reyes Sandoval (CTR-2026-00764)** tampoco es un caso de esta
   función: su instalación está `completed` — su pendiente es distinto
   (vincular su ONT real en el módulo OLT), ya documentado en la sesión de
   diagnóstico anterior.

Cada paso de este procedimiento requiere tu autorización explícita por
separado antes de ejecutarse; nada de esto se corrió todavía.
