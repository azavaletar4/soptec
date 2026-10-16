import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFieldInventoryClient } from '../fieldInventoryClient.ts';
import type { FieldInventoryContext } from '../../types/fieldInventory';
const context: FieldInventoryContext = { jobType: 'installation', jobId: 'job', actorId: 'actor', clientId: 'client', contractId: 'contract' };
test('lecturas paginadas no escriben y mantienen contexto entre páginas', async () => {
  const calls: string[] = [];
  const client = createFieldInventoryClient(async path => { calls.push(path); return { context, items: [{ id: calls.length }], next: calls.length === 1 ? 1 : null }; });
  assert.equal((await client.read(context, 'products')).items.length, 2);
  assert.ok(calls.every(p => p.includes('/installation/job/products?')));
});
test('contexto cambiado o lectura rechazada nunca dispara la escritura existente', async () => {
  for (const get of [async () => ({ context: { ...context, actorId: 'otro' }, items: [], next: null }), async () => { throw Error('No autorizado'); }]) {
    let writes = 0;
    await assert.rejects(createFieldInventoryClient(get).performUnitAction(context, 'unit', 'unassign', async () => { writes++; }));
    assert.equal(writes, 0);
  }
});
test('equipo correcto: delega exactamente una vez sin alterar contexto ni duplicar movimiento', async () => {
  const calls: string[] = []; let writes = 0;
  const client = createFieldInventoryClient(async path => { calls.push(path); return { context, items: [{ id: 'unit' }], next: null }; });
  const value = await client.performUnitAction(context, 'unit', 'unassign', async verified => { writes++; assert.deepEqual(verified, context); return 'evento-existente'; });
  assert.equal(value, 'evento-existente'); assert.equal(writes, 1);
  assert.ok(calls[0]!.includes('unitId=unit&action=unassign'));
});
test('no invoca escritura para un equipo distinto al validado', async () => {
  let writes = 0;
  const client = createFieldInventoryClient(async () => ({ context, items: [{ id: 'otra-unidad' }], next: null }));
  await assert.rejects(client.performUnitAction(context, 'unit', 'unassign', async () => { writes++; }));
  assert.equal(writes, 0);
});
test('cambio de identidad local descarta respuesta y no delega la escritura', async () => {
  let active = true, writes = 0;
  const client = createFieldInventoryClient(async () => { active = false; return { context, items: [{ id: 'unit' }], next: null }; }, () => active);
  await assert.rejects(client.performUnitAction(context, 'unit', 'unassign', async () => { writes++; }));
  assert.equal(writes, 0);
});
