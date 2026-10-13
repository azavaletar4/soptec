import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveOntForZoneSync,
  syncOltZoneForContract,
  canSyncOltZone,
  describeOntZoneSyncOutcome,
  resolveClosureTargetZoneId,
  shouldUseTransactionalNapSync,
} from '../ontZoneSync';

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

// ---- Fase C (App Campo): canSyncOltZone / describeOntZoneSyncOutcome / resolveClosureTargetZoneId ----

test('canSyncOltZone: solo SUPERADMIN/ADMIN/TECNICO_RED, igual que la funcion SQL de Fase 158', () => {
  assert.equal(canSyncOltZone('SUPERADMIN'), true);
  assert.equal(canSyncOltZone('ADMIN'), true);
  assert.equal(canSyncOltZone('TECNICO_RED'), true);
  assert.equal(canSyncOltZone('SOPORTE'), false);
  assert.equal(canSyncOltZone('FACTURACION'), false);
  assert.equal(canSyncOltZone(null), false);
  assert.equal(canSyncOltZone(undefined), false);
});

test('describeOntZoneSyncOutcome: sincronizado -> null (nada que avisar)', () => {
  assert.equal(describeOntZoneSyncOutcome({ ontZoneSynced: true, ontZoneSkipReason: null }), null);
});

test('describeOntZoneSyncOutcome: sin_ont_vinculada -> null (caso normal antes de una Alta, no es un error)', () => {
  assert.equal(describeOntZoneSyncOutcome({ ontZoneSynced: false, ontZoneSkipReason: 'sin_ont_vinculada' }), null);
});

test('describeOntZoneSyncOutcome: resultado null (no se llego a llamar la via transaccional) -> null', () => {
  assert.equal(describeOntZoneSyncOutcome(null), null);
});

test('describeOntZoneSyncOutcome: ambiguo -> mensaje claro con la cantidad, nunca se calla', () => {
  const msg = describeOntZoneSyncOutcome({ ontZoneSynced: false, ontZoneSkipReason: 'ambiguo:2' });
  assert.match(msg ?? '', /2 ONTs vinculadas/);
});

test('describeOntZoneSyncOutcome: motivo desconocido -> mensaje generico, tampoco se calla', () => {
  const msg = describeOntZoneSyncOutcome({ ontZoneSynced: false, ontZoneSkipReason: 'algo_nuevo' });
  assert.match(msg ?? '', /algo_nuevo/);
});

test('resolveClosureTargetZoneId: zona explicita (Alta) siempre gana, aunque tambien haya NAP con otra zona', () => {
  assert.equal(
    resolveClosureTargetZoneId({ explicitZoneId: 'zona-explicita', napElementoId: 'nap-1', napZoneId: 'zona-del-nap' }),
    'zona-explicita',
  );
});

test('resolveClosureTargetZoneId: traslado de ticket SIN selector de zona propio -> se deriva de la caja NAP elegida', () => {
  assert.equal(
    resolveClosureTargetZoneId({ explicitZoneId: null, napElementoId: 'nap-1', napZoneId: 'zona-del-nap' }),
    'zona-del-nap',
  );
});

test('resolveClosureTargetZoneId: traslado DENTRO de la misma zona (NAP nueva, misma zona que ya tenia) -> devuelve esa misma zona, nunca null', () => {
  assert.equal(
    resolveClosureTargetZoneId({ explicitZoneId: null, napElementoId: 'nap-2', napZoneId: 'zona-actual' }),
    'zona-actual',
  );
});

test('resolveClosureTargetZoneId: caja NAP sin zona propia asignada -> null, nunca inventa una', () => {
  assert.equal(resolveClosureTargetZoneId({ explicitZoneId: null, napElementoId: 'nap-sin-zona', napZoneId: null }), null);
});

test('resolveClosureTargetZoneId: ni zona explicita ni NAP elegido (avería normal, sin recableado) -> null, no toca nada', () => {
  assert.equal(resolveClosureTargetZoneId({ explicitZoneId: null, napElementoId: null, napZoneId: null }), null);
});

test('resolveClosureTargetZoneId: reintento — mismo input, mismo resultado (idempotente por construccion, es una funcion pura)', () => {
  const input = { explicitZoneId: null, napElementoId: 'nap-1', napZoneId: 'zona-del-nap' };
  assert.equal(resolveClosureTargetZoneId(input), resolveClosureTargetZoneId(input));
});

// ---- Fase 159 (revision puntual, punto 2): shouldUseTransactionalNapSync
// nunca debe habilitar la sincronizacion automatica contra la OLT cuando
// la ONT fue marcada como reemplazada, sin importar el rol ni el tipo de
// trabajo — "no automatizar cambios fisicos en OLT". ----

test('shouldUseTransactionalNapSync: ONT reemplazada -> false SIEMPRE, aunque el rol sea valido y no sea una instalacion', () => {
  assert.equal(shouldUseTransactionalNapSync({ jobType: 'routine', ontReplaced: true, role: 'TECNICO_RED' }), false);
  assert.equal(shouldUseTransactionalNapSync({ jobType: 'ticket', ontReplaced: true, role: 'SUPERADMIN' }), false);
});

test('shouldUseTransactionalNapSync: ONT conservada + rol valido + no es instalacion -> true', () => {
  assert.equal(shouldUseTransactionalNapSync({ jobType: 'routine', ontReplaced: false, role: 'TECNICO_RED' }), true);
});

test('shouldUseTransactionalNapSync: instalacion -> false aunque la ONT se haya conservado y el rol sea valido (Altas quedan fuera a proposito, 13am)', () => {
  assert.equal(shouldUseTransactionalNapSync({ jobType: 'installation', ontReplaced: false, role: 'SUPERADMIN' }), false);
});

test('shouldUseTransactionalNapSync: rol sin permiso -> false', () => {
  assert.equal(shouldUseTransactionalNapSync({ jobType: 'routine', ontReplaced: false, role: 'SOPORTE' }), false);
  assert.equal(shouldUseTransactionalNapSync({ jobType: 'routine', ontReplaced: false, role: null }), false);
});
