import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeFieldInventory, pendingFieldInventory } from '../fieldInventoryOperation';
import { executeRoutineInventory, pendingRoutineInventory } from '../routineInventoryRequest';
import { checkMaterialClosure, checkMaterialInventoryOutcome } from '../materialInventoryOutcome';

function fixture(kind: 'installation' | 'ticket' | 'routine') {
  const entries = new Map<string, string>();
  const storage = { getItem: (k: string) => entries.get(k) ?? null, setItem: (k: string, v: string) => { entries.set(k, v); }, removeItem: (k: string) => { entries.delete(k); } };
  const context = { jobType: kind, jobId: 'job', actorId: 'tech', clientId: null, contractId: null };
  let mode: 'rejected' | 'cancelled' | 'ok' | 'network' | 'sqlstate' = 'rejected';
  let rejectedMessage = 'No se registró material. Pide entrega antes de cerrar.';
  const calls: Array<{ id: string; payload: unknown }> = [];
  const invoke = async (r: { p_operation_id: string; p_payload: unknown }) => {
    calls.push({ id: r.p_operation_id, payload: r.p_payload });
    if (mode === 'network') throw Error('fetch failed'); // red caida: invoke() ni siquiera responde
    if (mode === 'sqlstate') return { data: null, error: { code: '22023', message: 'Cantidad inválida' } };
    if (mode === 'rejected') return { data: { materialRejected: true, operationId: r.p_operation_id, message: rejectedMessage }, error: null };
    if (mode === 'cancelled') return { data: { materialCancelled: true, operationId: r.p_operation_id, message: 'Intento anulado por administración' }, error: null };
    return { data: { operationId: r.p_operation_id, jobType: kind, jobId: 'job', action: 'consume', ids: ['movement'], at: '2026-10-19T10:00:00Z' }, error: null };
  };
  let nextId = 0;
  const uuid = () => 'op-' + (nextId++);
  const run = (payload: Record<string, unknown>) => kind === 'routine'
    ? executeRoutineInventory(storage, 'tech', 'job', 'consume', payload, invoke, uuid)
    : executeFieldInventory(storage, context, 'consume', payload, invoke, uuid);
  const pending = () => kind === 'routine' ? pendingRoutineInventory(storage, 'tech', 'job') : pendingFieldInventory(storage, context);
  return { run, pending, calls, storage, setMode: (m: typeof mode) => { mode = m; }, setRejectedMessage: (m: string) => { rejectedMessage = m; } };
}

for (const kind of ['installation', 'ticket', 'routine'] as const) {
  // ---- Requisito 1 del pedido original: rechazo 2 contra 1 ----
  test(`${kind}: rechazo 2 contra 1 — custodia insuficiente deja la fila pendiente (confirmada, no incierta)`, async () => {
    const f = fixture(kind);
    f.setRejectedMessage('No tienes suficiente material en custodia para este consumo (tienes 1, intentas usar 2). Pide la entrega a un administrador.');
    await assert.rejects(f.run({ quantity: 2 }), /tienes 1, intentas usar 2/); // requisito 5: cantidad disponible confirmada, real, del servidor
    assert.equal(f.pending()?.p_operation_id, 'op-0');
    assert.equal(f.calls.length, 1);
  });

  // ---- Requisito 3: corrección a 1 — editar la cantidad y reintentar con una operación NUEVA ----
  test(`${kind}: corrección a 1 tras el rechazo — una cantidad distinta ya NO queda bloqueada, y viaja con la MISMA clave (el servidor la deja resuelta, nunca huérfana)`, async () => {
    const f = fixture(kind);
    await assert.rejects(f.run({ quantity: 2 }));
    f.setMode('ok');
    const result = await f.run({ quantity: 1 }); // misma intención corregida, MISMO operation_id (op-0): el rechazo confirmado admite el cambio de cantidad
    assert.ok(result);
    assert.equal(f.calls.length, 2);
    assert.deepEqual(f.calls[1]!.payload, { quantity: 1 });
    assert.equal(f.calls[1]!.id, f.calls[0]!.id, 'la corrección debe reutilizar la MISMA clave del rechazo confirmado (execute_tracked_material_inventory la admite y la deja resuelta, no huérfana bloqueando el cierre)');
    assert.equal(f.pending(), null); // la corrección se confirmó: sin nada pendiente
  });

  // ---- Requisito 7: reintentos (misma cantidad, misma clave, se resuelve una vez alcanza la custodia) ----
  test(`${kind}: reintento real con la MISMA cantidad y clave resuelve el rechazo sin duplicar`, async () => {
    const f = fixture(kind);
    await assert.rejects(f.run({ quantity: 2 }));
    assert.equal(f.pending()?.p_operation_id, 'op-0');
    f.setMode('ok');
    const result = await f.run({ quantity: 2 }); // misma cantidad -> misma operation_id (reintento real, no uno nuevo)
    assert.ok(result);
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1]!.id, 'op-0', 'reintentar sin cambiar nada debe reusar la MISMA clave, nunca generar una nueva');
    assert.equal(f.pending(), null);
  });

  // ---- Requisito 7: doble clic (dos envíos concurrentes de la MISMA intención no duplican) ----
  test(`${kind}: doble clic con la misma cantidad reusa la misma clave, nunca dos operaciones distintas`, async () => {
    const f = fixture(kind);
    f.setMode('ok');
    const [a, b] = await Promise.all([f.run({ quantity: 1 }), f.run({ quantity: 1 })]);
    assert.ok(a); assert.ok(b);
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[0]!.id, f.calls[1]!.id, 'el doble clic con la misma intención debe viajar con la MISMA clave, nunca duplicar la operación');
  });

  // ---- Requisito 7: respuesta perdida / error de comunicación -> operación realmente incierta ----
  test(`${kind}: error de comunicación (respuesta perdida) deja la operación realmente incierta — una cantidad distinta SIGUE bloqueada`, async () => {
    const f = fixture(kind);
    f.setMode('network');
    await assert.rejects(f.run({ quantity: 2 }), /fetch failed/);
    assert.equal(f.pending()?.p_operation_id, 'op-0'); // se conserva: no sabemos si llegó a aplicarse
    // A diferencia de un rechazo CONFIRMADO, aquí una cantidad distinta debe seguir bloqueada.
    await assert.rejects(f.run({ quantity: 1 }), /pendiente/);
    assert.equal(f.calls.length, 1); // el segundo intento (cantidad 1) nunca llegó a invoke(): se bloqueó antes
  });

  // ---- Requisito 1/7: operación pendiente auténtica se resuelve igual con la misma clave tras el error de red ----
  test(`${kind}: operación pendiente auténtica (tras error de comunicación) se resuelve con la MISMA clave, sin inventar un resultado`, async () => {
    const f = fixture(kind);
    f.setMode('network');
    await assert.rejects(f.run({ quantity: 2 }));
    f.setMode('ok');
    const result = await f.run({ quantity: 2 }); // confirmar la misma operación, nunca una "nueva" con otra cantidad
    assert.ok(result);
    assert.equal(f.calls[1]!.id, 'op-0');
    assert.equal(f.pending(), null);
  });

  // ---- Anulación administrativa explícita limpia el pendiente (comportamiento ya certificado, sin regresión) ----
  test(`${kind}: anulación administrativa explícita limpia el pendiente`, async () => {
    const f = fixture(kind);
    await assert.rejects(f.run({ quantity: 2 }));
    f.setMode('cancelled');
    await assert.rejects(f.run({ quantity: 2 }), /anulado/);
    assert.equal(f.pending(), null);
  });
}

test('prevalidacion de cierre informa rechazo antes de efectos y permite servidor anterior sin RPC', async () => {
  await assert.rejects(checkMaterialClosure(async () => ({ error: { code: 'P1651', message: 'No se puede cerrar: material pendiente' } })), /No se puede cerrar/);
  await checkMaterialClosure(async () => ({ error: null }));
  await checkMaterialClosure(async () => ({ error: { code: 'PGRST202', message: 'funcion aun no desplegada' } }));
  await assert.rejects(checkMaterialClosure(async () => ({ error: { code: '42501', message: 'Acceso denegado' } })), /Acceso/);
  await assert.rejects(checkMaterialClosure(async () => { throw Error('sin conexion'); }), /sin conexion/);
});

test('una respuesta de rechazo/anulación de otro UUID nunca descarta el intento pendiente ni lo marca resuelto', () => {
  let cancelled = false, rejected = false;
  assert.throws(() => checkMaterialInventoryOutcome({ materialCancelled: true, operationId: 'otra' }, { onCancelled: () => { cancelled = true; }, onRejected: () => { rejected = true; } }, 'propia'), /Conserva la operación pendiente/);
  assert.equal(cancelled, false);
  assert.throws(() => checkMaterialInventoryOutcome({ materialRejected: true, operationId: 'otra' }, { onCancelled: () => { cancelled = true; }, onRejected: () => { rejected = true; } }, 'propia'), /Conserva la operación pendiente/);
  assert.equal(rejected, false);
});

test('un rechazo real (misma operación) SI marca onRejected con el mensaje real del servidor (cantidad disponible confirmada)', () => {
  let rejected = false;
  assert.throws(
    () => checkMaterialInventoryOutcome({ materialRejected: true, operationId: 'propia', message: 'tienes 1, intentas usar 2' }, { onCancelled: () => {}, onRejected: () => { rejected = true; } }, 'propia'),
    /tienes 1, intentas usar 2/,
  );
  assert.equal(rejected, true);
});
