import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeConnectionStatusCounts,
  listDisconnectedLinkedClients,
  listSuspendedLinkedClients,
  filterDisconnectedClients,
  evaluateSyncFreshness,
  suspensionReasonLabel,
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
    admin_state: 'enable',
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
  assert.deepEqual(r, { linkedOnline: 1, linkedOffline: 0, linkedUnknown: 0, linkedSuspended: 0, unlinked: 0 });
});

test('computeConnectionStatusCounts: cliente vinculado desconectado -> linkedOffline', () => {
  const r = computeConnectionStatusCounts([linkedSample({ status: 'offline' })]);
  assert.deepEqual(r, { linkedOnline: 0, linkedOffline: 1, linkedUnknown: 0, linkedSuspended: 0, unlinked: 0 });
});

test('computeConnectionStatusCounts: cliente vinculado con estado desconocido -> linkedUnknown, NUNCA se cuenta como desconectado', () => {
  const r = computeConnectionStatusCounts([linkedSample({ status: 'unknown' })]);
  assert.deepEqual(r, { linkedOnline: 0, linkedOffline: 0, linkedUnknown: 1, linkedSuspended: 0, unlinked: 0 });
});

test('computeConnectionStatusCounts: ONT sin vincular (migracion SmartOLT) -> unlinked, SIEMPRE por separado aunque este offline', () => {
  const r = computeConnectionStatusCounts([ont({ client_id: null, status: 'offline' })]);
  assert.deepEqual(r, { linkedOnline: 0, linkedOffline: 0, linkedUnknown: 0, linkedSuspended: 0, unlinked: 1 });
});

test('computeConnectionStatusCounts: vinculo PARCIAL (contract_id sin client_id) -> sigue siendo unlinked, nunca un vinculo a medias', () => {
  const r = computeConnectionStatusCounts([ont({ client_id: null, contract_id: 'ctr-1', status: 'online' })]);
  assert.deepEqual(r, { linkedOnline: 0, linkedOffline: 0, linkedUnknown: 0, linkedSuspended: 0, unlinked: 1 });
});

test('computeConnectionStatusCounts: cliente con MULTIPLES servicios -> cada ONT/contrato cuenta por separado, sin mezclarse', () => {
  const servicioA = linkedSample({ id: 'ont-a', status: 'online', contract_id: 'ctr-a', service_contracts: { id: 'ctr-a', contract_number: 'C-A', client_code: 'CL-A', zones: null } });
  const servicioB = linkedSample({ id: 'ont-b', status: 'offline', contract_id: 'ctr-b', service_contracts: { id: 'ctr-b', contract_number: 'C-B', client_code: 'CL-B', zones: null } });
  const r = computeConnectionStatusCounts([servicioA, servicioB]);
  assert.deepEqual(r, { linkedOnline: 1, linkedOffline: 1, linkedUnknown: 0, linkedSuspended: 0, unlinked: 0 });
});

test('computeConnectionStatusCounts: MISMO cliente con 2 contratos, uno suspendido y otro conectado -> cada uno en SU bucket, sin asociaciones incorrectas', () => {
  const servicioSuspendido = linkedSample({
    id: 'ont-susp',
    status: 'offline',
    admin_state: 'disable',
    contract_id: 'ctr-susp',
    service_contracts: { id: 'ctr-susp', contract_number: 'C-SUSP', client_code: 'CL-X', zones: null },
  });
  const servicioOk = linkedSample({
    id: 'ont-ok',
    status: 'online',
    admin_state: 'enable',
    contract_id: 'ctr-ok',
    service_contracts: { id: 'ctr-ok', contract_number: 'C-OK', client_code: 'CL-X', zones: null },
  });
  const r = computeConnectionStatusCounts([servicioSuspendido, servicioOk]);
  assert.deepEqual(r, { linkedOnline: 1, linkedOffline: 0, linkedUnknown: 0, linkedSuspended: 1, unlinked: 0 });
  // y cada lista trae SOLO su propio contrato, nunca el del otro servicio del mismo cliente.
  assert.deepEqual(listSuspendedLinkedClients([servicioSuspendido, servicioOk]).map((e) => e.contract.id), ['ctr-susp']);
  assert.deepEqual(listDisconnectedLinkedClients([servicioSuspendido, servicioOk]).map((e) => e.contract.id), []);
});

test('computeConnectionStatusCounts: lista vacia -> todo en cero', () => {
  assert.deepEqual(computeConnectionStatusCounts([]), { linkedOnline: 0, linkedOffline: 0, linkedUnknown: 0, linkedSuspended: 0, unlinked: 0 });
});

test('computeConnectionStatusCounts: cada ONT cae en EXACTAMENTE un conteo, nunca doble conteo', () => {
  const onts = [
    linkedSample({ id: 'a', status: 'online' }),
    linkedSample({ id: 'b', status: 'offline' }),
    linkedSample({ id: 'c', status: 'unknown' }),
    linkedSample({ id: 'd', status: 'offline', admin_state: 'disable' }),
    linkedSample({ id: 'e', status: 'online', admin_state: 'disable' }),
    ont({ id: 'f', client_id: null, status: 'offline' }),
  ];
  const r = computeConnectionStatusCounts(onts);
  const total = r.linkedOnline + r.linkedOffline + r.linkedUnknown + r.linkedSuspended + r.unlinked;
  assert.equal(total, onts.length);
  assert.deepEqual(r, { linkedOnline: 1, linkedOffline: 1, linkedUnknown: 1, linkedSuspended: 2, unlinked: 1 });
});

// ---- Suspension administrativa (admin_state='disable') tiene PRIORIDAD sobre status ----

test('suspension con STATUS ONLINE ANTIGUO (quedo asi antes de deshabilitarse) -> sigue siendo suspendida, NUNCA conectada', () => {
  const r = computeConnectionStatusCounts([linkedSample({ status: 'online', admin_state: 'disable' })]);
  assert.deepEqual(r, { linkedOnline: 0, linkedOffline: 0, linkedUnknown: 0, linkedSuspended: 1, unlinked: 0 });
});

test('suspension OFFLINE (caso normal) -> suspendida, NUNCA "sin conexion"', () => {
  const r = computeConnectionStatusCounts([linkedSample({ status: 'offline', admin_state: 'disable' })]);
  assert.deepEqual(r, { linkedOnline: 0, linkedOffline: 0, linkedUnknown: 0, linkedSuspended: 1, unlinked: 0 });
  assert.equal(listDisconnectedLinkedClients([linkedSample({ status: 'offline', admin_state: 'disable' })]).length, 0);
});

test('suspension con STATUS DESCONOCIDO -> sigue siendo suspendida (admin_state manda siempre, incluso sobre "unknown")', () => {
  const r = computeConnectionStatusCounts([linkedSample({ status: 'unknown', admin_state: 'disable' })]);
  assert.deepEqual(r, { linkedOnline: 0, linkedOffline: 0, linkedUnknown: 0, linkedSuspended: 1, unlinked: 0 });
});

test('RECONEXION: admin_state vuelve a enable y status online -> vuelve a contar como conectada, no suspendida', () => {
  const r = computeConnectionStatusCounts([linkedSample({ status: 'online', admin_state: 'enable' })]);
  assert.deepEqual(r, { linkedOnline: 1, linkedOffline: 0, linkedUnknown: 0, linkedSuspended: 0, unlinked: 0 });
});

test('ONT SIN VINCULAR con admin_state=disable -> sigue siendo "sin vincular", NUNCA aparece como suspendida (no altera la migracion)', () => {
  const unlinkedDisabled = ont({ client_id: null, status: 'offline', admin_state: 'disable' });
  const r = computeConnectionStatusCounts([unlinkedDisabled]);
  assert.deepEqual(r, { linkedOnline: 0, linkedOffline: 0, linkedUnknown: 0, linkedSuspended: 0, unlinked: 1 });
  assert.equal(listSuspendedLinkedClients([unlinkedDisabled]).length, 0);
});

// ---- listDisconnectedLinkedClients ----

test('listDisconnectedLinkedClients: solo vinculados Y offline Y NO suspendidos — nunca uno sin vincular, nunca uno online/unknown/suspendido', () => {
  const onts = [
    linkedSample({ id: 'ont-off', status: 'offline' }),
    linkedSample({ id: 'ont-on', status: 'online' }),
    linkedSample({ id: 'ont-unk', status: 'unknown' }),
    linkedSample({ id: 'ont-susp', status: 'offline', admin_state: 'disable' }),
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

// ---- listSuspendedLinkedClients ----

test('listSuspendedLinkedClients: solo vinculados Y admin_state=disable — nunca uno sin vincular, nunca aparece tambien en listDisconnectedLinkedClients', () => {
  const onts = [
    linkedSample({ id: 'ont-susp-off', status: 'offline', admin_state: 'disable' }),
    linkedSample({ id: 'ont-susp-on', status: 'online', admin_state: 'disable' }),
    linkedSample({ id: 'ont-off', status: 'offline', admin_state: 'enable' }),
    ont({ id: 'ont-sinvincular', client_id: null, status: 'offline', admin_state: 'disable' }),
  ];
  const suspended = listSuspendedLinkedClients(onts);
  const disconnected = listDisconnectedLinkedClients(onts);
  assert.deepEqual(suspended.map((e) => e.ontDbId).sort(), ['ont-susp-off', 'ont-susp-on']);
  assert.deepEqual(disconnected.map((e) => e.ontDbId), ['ont-off']);
  // ninguna ONT aparece en las 2 listas a la vez.
  const overlap = suspended.filter((s) => disconnected.some((d) => d.ontDbId === s.ontDbId));
  assert.equal(overlap.length, 0);
});

test('listSuspendedLinkedClients: incluye nombre, contrato, zona y posicion — mismos datos para "Ver cliente"/"Ver ONT"', () => {
  const [entry] = listSuspendedLinkedClients([linkedSample({ status: 'offline', admin_state: 'disable' })]);
  assert.equal(entry.client.name, 'Violeta Garcia Silva');
  assert.equal(entry.contract.contractNumber, 'C-001');
  assert.equal(entry.zoneName, 'PON 1 - AO');
  assert.equal(entry.ontDbId, 'ont-1');
});

// ---- filterDisconnectedClients (reusado tal cual para suspendidos: misma forma de entrada) ----

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

test('filterDisconnectedClients: funciona igual sobre la lista de suspendidos (misma forma de entrada)', () => {
  const [entry] = listSuspendedLinkedClients([linkedSample({ status: 'offline', admin_state: 'disable' })]);
  assert.equal(filterDisconnectedClients([entry], { search: 'violeta' }).length, 1);
});

// ---- suspensionReasonLabel: "Por deuda/mora" SOLO con evidencia confiable (debt_hold_status via /:id/onts/disabled) ----

test('suspensionReasonLabel: reason="billing" (debt_hold_status=suspended confirmado) -> por deuda/mora', () => {
  assert.equal(suspensionReasonLabel('billing'), 'Suspendido — por deuda / mora');
});

test('suspensionReasonLabel: reason="both" (manual Y deuda) -> igual menciona la deuda, es evidencia real', () => {
  assert.equal(suspensionReasonLabel('both'), 'Suspendido — por deuda / mora');
});

test('suspensionReasonLabel: reason="manual" (sin evidencia de deuda) -> generico, NUNCA inventa "por deuda"', () => {
  assert.equal(suspensionReasonLabel('manual'), 'Suspendido administrativamente');
});

test('suspensionReasonLabel: reason desconocido/ausente (ej. caso real Danner: admin-disabled con debt_hold_status=none) -> generico', () => {
  assert.equal(suspensionReasonLabel(undefined), 'Suspendido administrativamente');
  assert.equal(suspensionReasonLabel(null), 'Suspendido administrativamente');
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

test('evaluateSyncFreshness: hace demasiado tiempo desde la ultima sincronizacion -> stale, dato antiguo nunca se presenta como confirmacion actual', () => {
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
