import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeConnectionStatusCounts,
  listDisconnectedLinkedClients,
  filterDisconnectedClients,
  evaluateSyncFreshness,
  type ConnectionStatusOnt,
} from '../oltConnectionStatus';

function ont(overrides: Partial<ConnectionStatusOnt>): ConnectionStatusOnt {
  return {
    id: 'ont-1',
    serial: 'ZTEG0001',
    description: null,
    slot: 2,
    port: 1,
    ont_id: 1,
    status: 'online',
    client_id: null,
    ...overrides,
  };
}

const linkedSample = (overrides: Partial<ConnectionStatusOnt> = {}) =>
  ont({
    client_id: 'cli-1',
    contract_id: 'ctr-1',
    clients: { id: 'cli-1', first_name: 'Violeta', last_name: 'Garcia Silva' },
    service_contracts: { id: 'ctr-1', contract_number: 'C-001', client_code: 'CL-001', zones: { id: 'z-ao', name: 'PON 1 - AO' } },
    ...overrides,
  });

// ---- computeConnectionStatusCounts: conectado, desconectado, desconocido, sin vincular ----

test('computeConnectionStatusCounts: cliente vinculado conectado -> linkedOnline', () => {
  const r = computeConnectionStatusCounts([linkedSample({ status: 'online' })]);
  assert.deepEqual(r, { linkedOnline: 1, linkedOffline: 0, linkedUnknown: 0, unlinked: 0 });
});

test('computeConnectionStatusCounts: cliente vinculado desconectado -> linkedOffline', () => {
  const r = computeConnectionStatusCounts([linkedSample({ status: 'offline' })]);
  assert.deepEqual(r, { linkedOnline: 0, linkedOffline: 1, linkedUnknown: 0, unlinked: 0 });
});

test('computeConnectionStatusCounts: cliente vinculado con estado desconocido -> linkedUnknown, NUNCA se cuenta como desconectado', () => {
  const r = computeConnectionStatusCounts([linkedSample({ status: 'unknown' })]);
  assert.deepEqual(r, { linkedOnline: 0, linkedOffline: 0, linkedUnknown: 1, unlinked: 0 });
});

test('computeConnectionStatusCounts: ONT sin vincular (migracion SmartOLT) -> unlinked, SIEMPRE por separado aunque este offline', () => {
  const r = computeConnectionStatusCounts([ont({ client_id: null, status: 'offline' })]);
  assert.deepEqual(r, { linkedOnline: 0, linkedOffline: 0, linkedUnknown: 0, unlinked: 1 });
});

test('computeConnectionStatusCounts: vinculo PARCIAL (contract_id sin client_id) -> sigue siendo unlinked, nunca un vinculo a medias', () => {
  const r = computeConnectionStatusCounts([ont({ client_id: null, contract_id: 'ctr-1', status: 'online' })]);
  assert.deepEqual(r, { linkedOnline: 0, linkedOffline: 0, linkedUnknown: 0, unlinked: 1 });
});

test('computeConnectionStatusCounts: cliente con MULTIPLES servicios -> cada ONT/contrato cuenta por separado, sin mezclarse', () => {
  const servicioA = linkedSample({ id: 'ont-a', status: 'online', contract_id: 'ctr-a', service_contracts: { id: 'ctr-a', contract_number: 'C-A', client_code: 'CL-A', zones: null } });
  const servicioB = linkedSample({ id: 'ont-b', status: 'offline', contract_id: 'ctr-b', service_contracts: { id: 'ctr-b', contract_number: 'C-B', client_code: 'CL-B', zones: null } });
  const r = computeConnectionStatusCounts([servicioA, servicioB]);
  assert.deepEqual(r, { linkedOnline: 1, linkedOffline: 1, linkedUnknown: 0, unlinked: 0 });
});

test('computeConnectionStatusCounts: lista vacia -> todo en cero', () => {
  assert.deepEqual(computeConnectionStatusCounts([]), { linkedOnline: 0, linkedOffline: 0, linkedUnknown: 0, unlinked: 0 });
});

// ---- listDisconnectedLinkedClients ----

test('listDisconnectedLinkedClients: solo vinculados Y offline — nunca uno sin vincular, nunca uno online/unknown', () => {
  const onts = [
    linkedSample({ id: 'ont-off', status: 'offline' }),
    linkedSample({ id: 'ont-on', status: 'online' }),
    linkedSample({ id: 'ont-unk', status: 'unknown' }),
    ont({ id: 'ont-sinvincular', client_id: null, status: 'offline' }),
  ];
  const list = listDisconnectedLinkedClients(onts);
  assert.equal(list.length, 1);
  assert.equal(list[0].ontDbId, 'ont-off');
});

test('listDisconnectedLinkedClients: incluye nombre, contrato, zona y posicion para acceso directo', () => {
  const [entry] = listDisconnectedLinkedClients([linkedSample({ status: 'offline' })]);
  assert.equal(entry.client.name, 'Violeta Garcia Silva');
  assert.equal(entry.contract.contractNumber, 'C-001');
  assert.equal(entry.zoneName, 'PON 1 - AO');
  assert.equal(entry.slot, 2);
  assert.equal(entry.port, 1);
});

test('listDisconnectedLinkedClients: ordena por nombre de cliente', () => {
  const zulema = linkedSample({ id: 'ont-z', status: 'offline', clients: { id: 'cli-z', first_name: 'Zulema', last_name: 'Zeta' } });
  const andres = linkedSample({ id: 'ont-a', status: 'offline', clients: { id: 'cli-a', first_name: 'Andres', last_name: 'Alfa' } });
  const list = listDisconnectedLinkedClients([zulema, andres]);
  assert.deepEqual(list.map((e) => e.client.name), ['Andres Alfa', 'Zulema Zeta']);
});

// ---- filterDisconnectedClients ----

test('filterDisconnectedClients: filtra por zona exacta (id)', () => {
  const ao = linkedSample({ id: 'ont-ao', status: 'offline' });
  const sm = linkedSample({ id: 'ont-sm', status: 'offline', service_contracts: { id: 'ctr-sm', contract_number: 'C-SM', client_code: 'CL-SM', zones: { id: 'z-sm', name: 'PON 2 - SM' } } });
  const list = listDisconnectedLinkedClients([ao, sm]);
  const filtrado = filterDisconnectedClients(list, { zoneId: 'z-sm' });
  assert.equal(filtrado.length, 1);
  assert.equal(filtrado[0].zoneName, 'PON 2 - SM');
});

test('filterDisconnectedClients: busqueda de texto por nombre, insensible a mayusculas', () => {
  const [entry] = listDisconnectedLinkedClients([linkedSample({ status: 'offline' })]);
  assert.equal(filterDisconnectedClients([entry], { search: 'violeta' }).length, 1);
  assert.equal(filterDisconnectedClients([entry], { search: 'NO EXISTE' }).length, 0);
});

test('filterDisconnectedClients: sin filtros -> devuelve todo tal cual', () => {
  const [entry] = listDisconnectedLinkedClients([linkedSample({ status: 'offline' })]);
  assert.deepEqual(filterDisconnectedClients([entry], {}), [entry]);
});

// ---- evaluateSyncFreshness ----

test('evaluateSyncFreshness: sincronizacion reciente y completa -> ok, no stale', () => {
  const now = new Date('2026-10-14T13:30:00.000Z').getTime();
  const r = evaluateSyncFreshness({ checkedAt: '2026-10-14T13:25:00.000Z', scanComplete: true }, now, 60);
  assert.equal(r.scanComplete, true);
  assert.equal(r.stale, false);
  assert.equal(r.minutesAgo, 5);
});

test('evaluateSyncFreshness: la OLT no respondio en el ultimo intento -> scanComplete false, NUNCA se interpreta como desconexion de clientes', () => {
  const now = new Date('2026-10-14T13:30:00.000Z').getTime();
  const r = evaluateSyncFreshness({ checkedAt: '2026-10-14T13:29:00.000Z', scanComplete: false }, now, 60);
  assert.equal(r.scanComplete, false);
  assert.equal(r.minutesAgo, 1);
});

test('evaluateSyncFreshness: hace demasiado tiempo desde la ultima sincronizacion -> stale', () => {
  const now = new Date('2026-10-14T15:00:00.000Z').getTime();
  const r = evaluateSyncFreshness({ checkedAt: '2026-10-14T13:00:00.000Z', scanComplete: true }, now, 60);
  assert.equal(r.stale, true);
  assert.equal(r.minutesAgo, 120);
});

test('evaluateSyncFreshness: sin ningun dato todavia (OLT recien creada) -> "No disponible", nunca inventa una fecha', () => {
  const r = evaluateSyncFreshness(null, Date.now());
  assert.equal(r.checkedAtIso, null);
  assert.equal(r.minutesAgo, null);
});
