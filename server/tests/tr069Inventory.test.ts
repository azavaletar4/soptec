import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { readTr069Inventory, synchronizeTr069Inventory, type Tr069InventoryRepository } from '../src/services/tr069Inventory';
import { tr069SyncRoutes } from '../src/routes/tr069sync';
import { partitionTr069Inventory } from '../../src/lib/tr069Inventory';
import type { Tr069Device } from '../../src/types/domain';

const zte = '6C11BA-F670L-ZTE-OLD', huawei = '001122-HG8245-HW-NEW';
const old: Tr069Device = { id: 'saved-zte', genieacs_id: zte, cpe_serial: 'ZTE-OLD', cpe_oui: '6C11BA',
  cpe_product_class: 'F670L', service_contract_id: 'contract-office', notes: 'Conservar',
  last_seen_at: '2026-09-22T06:29:00Z', model_name: 'F670L', firmware_version: null, wan_ip: null, ssid: null,
  created_at: '2026-09-22T06:29:00Z', updated_at: '2026-10-22T05:43:00Z', contracts: { id: 'contract-office', contract_number: 'CTR-TEST-0073' } };
const cpe = (id = huawei) => ({ _id: id, _deviceId: { _SerialNumber: id === zte ? 'ZTE-OLD' : 'HW-NEW', _OUI: '001122', _ProductClass: 'HG8245' },
  _lastInform: '2026-10-28T10:00:00Z', Device: { DeviceInfo: { ModelName: { _value: 'Huawei de prueba' }, SerialNumber: { _value: 'UNTRUSTED-OTHER-SERIAL' } },
    ManagementServer: { Password: { _value: 'PRIVATE-ACS' } }, WANDevice: { 1: { WANConnectionDevice: { 1: { WANPPPConnection: { 1: { Password: { _value: 'PRIVATE-PPP' }, ExternalIPAddress: { _value: '192.0.2.10' } } } } } } },
    LANDevice: { 1: { WLANConfiguration: { 1: { SSID: { _value: 'Red ficticia' }, KeyPassphrase: { _value: 'PRIVATE-WIFI' } } } } } } });
const response = (rows: unknown, total: string | null = Array.isArray(rows) ? String(rows.length) : '0', status = 200) =>
  new Response(JSON.stringify(rows), { status, headers: { 'Content-Type': 'application/json', ...(total === null ? {} : { total }) } });
function reader(responses: (() => Response | Promise<Response>)[]) {
  const calls: { url: string; options?: RequestInit }[] = [];
  const read = (async (url: string | URL | Request, options?: RequestInit) => {
    calls.push({ url: String(url), options });
    assert.equal(options?.method ?? 'GET', 'GET');
    assert.equal(options?.redirect, 'error');
    assert.equal(new URL(String(url)).searchParams.has('limit'), false);
    assert.equal(new URL(String(url)).searchParams.has('skip'), false);
    return responses.shift()!();
  }) as typeof fetch;
  return { read, calls };
}

test('NBI vacío completo: cero actuales, ZTE histórica sin borrar contrato o métricas', async () => {
  const { read } = reader([() => response([]), () => response([])]);
  const snapshot = await readTr069Inventory('http://acs.invalid:7557', read);
  const writes: unknown[] = [], metrics = [{ device: old.id, rx: -20 }];
  const repo: Tr069InventoryRepository = { list: async () => [old], insert: async d => { writes.push(d); }, update: async (id, d) => { writes.push([id, d]); } };
  const before = JSON.stringify({ old, metrics });
  assert.deepEqual(await synchronizeTr069Inventory(snapshot, repo), { ok: true, total: 0, synced: 0, created: 0, inventory: snapshot });
  assert.deepEqual(writes, []);
  assert.equal(JSON.stringify({ old, metrics }), before);
  const view = partitionTr069Inventory([old], snapshot);
  assert.equal(view.current.length, 0);
  assert.deepEqual(view.historical, [old]);
});

test('Huawei nueva: identidad ACS propia, no hereda contrato de ZTE ni devuelve claves', async () => {
  const { read, calls } = reader([() => response([cpe()]), () => response([{ _id: huawei }])]);
  const snapshot = await readTr069Inventory('http://acs.invalid:7557/', read);
  const inserts: unknown[] = [];
  await synchronizeTr069Inventory(snapshot, { list: async () => [old], insert: async d => { inserts.push(d); }, update: async () => { assert.fail('ZTE no debe actualizarse'); } });
  assert.equal(calls.length, 2);
  assert.equal(snapshot.devices[0].cpe_serial, 'HW-NEW');
  assert.equal(snapshot.devices[0].model_name, 'Huawei de prueba');
  assert.equal(Object.hasOwn(inserts[0] as object, 'service_contract_id'), false);
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE|Password|KeyPassphrase|ManagementServer/);
  const view = partitionTr069Inventory([old], snapshot);
  assert.equal(view.current[0].registeredLocally, false);
  assert.equal(view.current[0].service_contract_id, null);
  assert.equal(view.current[0].contracts, null);
  assert.equal(view.historical[0].service_contract_id, old.service_contract_id);
});

test('presente ya sincronizado o reaparecido: conserva UUID, contrato, notas e historial', async () => {
  const { read } = reader([() => response([cpe(zte)]), () => response([{ _id: zte }])]);
  const snapshot = await readTr069Inventory('http://acs.invalid', read);
  let updates = 0;
  await synchronizeTr069Inventory(snapshot, { list: async () => [old], insert: async () => assert.fail(), update: async (id, patch) => {
    updates++; assert.equal(id, old.id);
    for (const key of ['service_contract_id', 'notes', 'id', 'genieacs_id', 'cpe_serial']) assert.equal(Object.hasOwn(patch, key), false);
  } });
  assert.equal(updates, 1);
  const view = partitionTr069Inventory([old], snapshot);
  assert.equal(view.historical.length, 0);
  assert.equal(view.current[0].id, old.id);
  assert.equal(view.current[0].service_contract_id, old.service_contract_id);
  assert.equal(view.current[0].notes, old.notes);
});

for (const [label, make] of [
  ['HTTP 503', () => response([], '0', 503)], ['HTTP 206', () => response([], '0', 206)],
  ['total ausente', () => response([], null)], ['total mayor que contenido', () => response([], '2')],
  ['total menor que contenido', () => response([cpe()], '0')], ['total inválido', () => response([], '-1')],
  ['objeto en lugar de lista', () => response({ devices: [] })], ['fila inválida', () => response([null])],
  ['ID vacío', () => response([{ _id: '' }])], ['ID duplicado', () => response([cpe(), cpe()])],
  ['fecha inválida', () => response([{ ...cpe(), _lastInform: 'not-a-date' }])],
  ['JSON truncado', () => new Response('[', { headers: { total: '1', 'Content-Type': 'application/json' } })],
  ['respuesta con rango', () => new Response('[]', { headers: { total: '0', 'Content-Type': 'application/json', 'Content-Range': 'items 0-0/2' } })],
  ['timeout', () => { throw new DOMException('Ficticio', 'TimeoutError'); }],
] as const) test(label + ': no confirma ausencias ni escribe registros', async () => {
  const { read } = reader([make]); let writes = 0;
  const repo: Tr069InventoryRepository = { list: async () => [], insert: async () => { writes++; }, update: async () => { writes++; } };
  await assert.rejects(async () => synchronizeTr069Inventory(await readTr069Inventory('http://acs.invalid', read), repo));
  assert.equal(writes, 0);
});

test('segunda enumeración incompleta o con cambio de identidad: no publica una retirada', async () => {
  for (const final of [() => response([], '1'), () => response([{ _id: zte }]), () => response([], '0', 503)]) {
    const { read } = reader([() => response([cpe()]), final]);
    await assert.rejects(readTr069Inventory('http://acs.invalid', read));
  }
});

test('sin consulta válida: cache sin verificar, no históricos ni actuales inventados', () => {
  const result = partitionTr069Inventory([old], null);
  assert.deepEqual(result, { current: [], historical: [], unverified: [old] });
});

test('registro posterior a última comprobación no se declara retirado tras una falla NBI', () => {
  const snapshot = { checkedAt: '2026-10-01T00:00:00Z', total: 0, devices: [] };
  const newer = { ...old, id: 'newer', created_at: '2026-10-28T00:00:00Z' };
  const result = partitionTr069Inventory([old, newer], snapshot);
  assert.deepEqual(result.historical, [old]); assert.deepEqual(result.unverified, [newer]);
});

test('fallo de caché impide declarar sincronización exitosa', async () => {
  const { read } = reader([() => response([]), () => response([])]);
  const snapshot = await readTr069Inventory('http://acs.invalid', read);
  await assert.rejects(synchronizeTr069Inventory(snapshot, { list: async () => { throw Error('Ficticio'); }, insert: async () => assert.fail(), update: async () => assert.fail() }));
});

test('inventario HTTP y sincronización requieren autenticación, sin tocar NBI', async () => {
  const app = new Hono().route('/api/tr069-sync', tr069SyncRoutes);
  assert.equal((await app.request('/api/tr069-sync/inventory')).status, 401);
  assert.equal((await app.request('/api/tr069-sync', { method: 'POST' })).status, 401);
});
