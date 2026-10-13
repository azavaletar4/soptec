import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOntForZoneSync, syncOltZoneForContract } from '../ontZoneSync';

test('sin ONT vinculada por contract_id: skipped_none, nunca se elige una por client_id', () => {
  const onts = [{ id: 'ont-1', contract_id: 'otro-contrato', zone_id: 'z1' }];
  assert.deepEqual(resolveOntForZoneSync(onts, 'contrato-1', 'z2'), { status: 'skipped_none' });
});

test('lista vacia (cliente sin ninguna ONT todavia): skipped_none', () => {
  assert.deepEqual(resolveOntForZoneSync([], 'contrato-1', 'z2'), { status: 'skipped_none' });
});

test('exactamente una ONT vinculada con otra zona: update, con el id correcto', () => {
  const onts = [
    { id: 'ont-otro-servicio', contract_id: 'contrato-2', zone_id: 'z1' },
    { id: 'ont-1', contract_id: 'contrato-1', zone_id: 'z1' },
  ];
  assert.deepEqual(resolveOntForZoneSync(onts, 'contrato-1', 'z2'), { status: 'update', ontId: 'ont-1' });
});

test('exactamente una ONT vinculada, zona ya coincide: unchanged (no se escribe de nuevo lo mismo)', () => {
  const onts = [{ id: 'ont-1', contract_id: 'contrato-1', zone_id: 'z2' }];
  assert.deepEqual(resolveOntForZoneSync(onts, 'contrato-1', 'z2'), { status: 'unchanged', ontId: 'ont-1' });
});

test('cliente con multiples servicios: solo cuenta la ONT de ESE contract_id, ignora las de otros servicios del mismo cliente', () => {
  const onts = [
    { id: 'ont-servicio-a', contract_id: 'contrato-A', zone_id: 'z1' },
    { id: 'ont-servicio-b', contract_id: 'contrato-B', zone_id: 'z9' },
  ];
  assert.deepEqual(resolveOntForZoneSync(onts, 'contrato-B', 'z3'), { status: 'update', ontId: 'ont-servicio-b' });
});

test('2+ ONTs con el mismo contract_id (dato ambiguo): skipped_ambiguous, no elige ninguna al azar', () => {
  const onts = [
    { id: 'ont-1', contract_id: 'contrato-1', zone_id: 'z1' },
    { id: 'ont-2', contract_id: 'contrato-1', zone_id: 'z1' },
  ];
  assert.deepEqual(resolveOntForZoneSync(onts, 'contrato-1', 'z2'), { status: 'skipped_ambiguous', count: 2 });
});

test('zona destino null (contrato sin zona): tambien dispara update si la ONT tiene una zona distinta', () => {
  const onts = [{ id: 'ont-1', contract_id: 'contrato-1', zone_id: 'z1' }];
  assert.deepEqual(resolveOntForZoneSync(onts, 'contrato-1', null), { status: 'update', ontId: 'ont-1' });
});

test('contract_id undefined/null en la ONT (legado) nunca matchea por accidente', () => {
  const onts = [{ id: 'ont-1', contract_id: null, zone_id: 'z1' }, { id: 'ont-2', zone_id: 'z1' }];
  assert.deepEqual(resolveOntForZoneSync(onts, 'contrato-1', 'z2'), { status: 'skipped_none' });
});

// ---- syncOltZoneForContract: orquestacion con efectos de red inyectados ----

test('orquestacion: caso feliz — actualiza SOLO la ONT de ese contract_id, con su propio olt_device_id', async () => {
  const calls: unknown[] = [];
  const result = await syncOltZoneForContract(
    {
      fetchOntsByClient: async () => [
        { id: 'ont-otro-servicio', olt_device_id: 'olt-X', contract_id: 'contrato-otro', zone_id: 'z1' },
        { id: 'ont-1', olt_device_id: 'olt-A', contract_id: 'contrato-1', zone_id: 'z1' },
      ],
      updateOntMeta: async (deviceId, ontId, payload) => { calls.push([deviceId, ontId, payload]); },
    },
    { contractId: 'contrato-1', clientId: 'cliente-1', targetZoneId: 'z2' },
  );
  assert.deepEqual(result, { status: 'ok' });
  assert.deepEqual(calls, [['olt-A', 'ont-1', { zone_id: 'z2' }]]);
});

test('orquestacion: falla la consulta de ONTs del cliente — failed_fetch, nunca intenta actualizar', async () => {
  let updateCalled = false;
  const result = await syncOltZoneForContract(
    {
      fetchOntsByClient: async () => { throw new Error('network down'); },
      updateOntMeta: async () => { updateCalled = true; },
    },
    { contractId: 'contrato-1', clientId: 'cliente-1', targetZoneId: 'z2' },
  );
  assert.deepEqual(result, { status: 'failed_fetch', detail: 'network down' });
  assert.equal(updateCalled, false);
});

test('orquestacion: falla el PUT de actualizar zona (ej. 403 por rol) — failed_update, nunca se reporta como ok', async () => {
  const result = await syncOltZoneForContract(
    {
      fetchOntsByClient: async () => [{ id: 'ont-1', olt_device_id: 'olt-A', contract_id: 'contrato-1', zone_id: 'z1' }],
      updateOntMeta: async () => { throw new Error('No tienes permisos para esta accion'); },
    },
    { contractId: 'contrato-1', clientId: 'cliente-1', targetZoneId: 'z2' },
  );
  assert.deepEqual(result, { status: 'failed_update', detail: 'No tienes permisos para esta accion' });
});

test('orquestacion: sin ONT vinculada — skipped_none, nunca llama updateOntMeta', async () => {
  let updateCalled = false;
  const result = await syncOltZoneForContract(
    { fetchOntsByClient: async () => [], updateOntMeta: async () => { updateCalled = true; } },
    { contractId: 'contrato-1', clientId: 'cliente-1', targetZoneId: 'z2' },
  );
  assert.deepEqual(result, { status: 'skipped_none' });
  assert.equal(updateCalled, false);
});

test('orquestacion: ambiguo (2+ ONTs del mismo contrato) — skipped_ambiguous con el conteo, nunca llama updateOntMeta', async () => {
  let updateCalled = false;
  const result = await syncOltZoneForContract(
    {
      fetchOntsByClient: async () => [
        { id: 'ont-1', olt_device_id: 'olt-A', contract_id: 'contrato-1', zone_id: 'z1' },
        { id: 'ont-2', olt_device_id: 'olt-A', contract_id: 'contrato-1', zone_id: 'z1' },
      ],
      updateOntMeta: async () => { updateCalled = true; },
    },
    { contractId: 'contrato-1', clientId: 'cliente-1', targetZoneId: 'z2' },
  );
  assert.deepEqual(result, { status: 'skipped_ambiguous', detail: 2 });
  assert.equal(updateCalled, false);
});

test('orquestacion: zona ya coincide — unchanged, no hace un PUT innecesario', async () => {
  let updateCalled = false;
  const result = await syncOltZoneForContract(
    {
      fetchOntsByClient: async () => [{ id: 'ont-1', olt_device_id: 'olt-A', contract_id: 'contrato-1', zone_id: 'z2' }],
      updateOntMeta: async () => { updateCalled = true; },
    },
    { contractId: 'contrato-1', clientId: 'cliente-1', targetZoneId: 'z2' },
  );
  assert.deepEqual(result, { status: 'unchanged' });
  assert.equal(updateCalled, false);
});

test('orquestacion: regresion — un segundo llamado tras un ok previo vuelve a traer el estado real (no cachea), y ahora da unchanged', async () => {
  let zoneInDb = 'z1';
  const deps = {
    fetchOntsByClient: async () => [{ id: 'ont-1', olt_device_id: 'olt-A', contract_id: 'contrato-1', zone_id: zoneInDb }],
    updateOntMeta: async (_d: string, _o: string, payload: { zone_id: string | null }) => { zoneInDb = payload.zone_id ?? ''; },
  };
  const first = await syncOltZoneForContract(deps, { contractId: 'contrato-1', clientId: 'cliente-1', targetZoneId: 'z2' });
  assert.deepEqual(first, { status: 'ok' });
  const second = await syncOltZoneForContract(deps, { contractId: 'contrato-1', clientId: 'cliente-1', targetZoneId: 'z2' });
  assert.deepEqual(second, { status: 'unchanged' });
});
