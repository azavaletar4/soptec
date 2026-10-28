import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readHostsInventory } from '../tr069Hosts';
import fs from 'node:fs';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const TEST_SERIAL = 'HWTC1D3691B7';
const TEST_DEVICE = '00259E-HG8145X6%2D13-485754431D3691B7';
const timestamp = '2026-10-28T19:38:38.997Z';

function host(opts: { mac: string; name?: string; ip?: string; interfaceType?: string; active?: boolean }) {
  return {
    HostName: opts.name ? { _value: opts.name, _timestamp: timestamp } : {},
    IPAddress: opts.ip ? { _value: opts.ip, _timestamp: timestamp } : {},
    MACAddress: { _value: opts.mac, _timestamp: timestamp },
    ...(opts.interfaceType ? { InterfaceType: { _value: opts.interfaceType, _timestamp: timestamp } } : { InterfaceType: {} }),
    ...(opts.active !== undefined ? { Active: { _value: opts.active, _timestamp: timestamp } } : { Active: {} }),
  };
}
function device(serial = '485754431D3691B7', id = TEST_DEVICE, hosts: Record<string, unknown> = {}, associated24: Record<string, unknown> = {}, associated5: Record<string, unknown> = {}) {
  return {
    _id: id, _lastInform: '2026-10-28T20:08:39.031Z', _deviceId: { _SerialNumber: serial },
    InternetGatewayDevice: { LANDevice: { 1: {
      Hosts: { _timestamp: timestamp, Host: hosts },
      WLANConfiguration: {
        1: { OperatingFrequencyBand: { _value: '2.4GHz' }, AssociatedDevice: associated24 },
        5: { OperatingFrequencyBand: { _value: '5GHz' }, AssociatedDevice: associated5 },
      },
    } } },
  };
}
function nbi(rows: object[]) {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(init?.method, 'GET', 'Nunca un POST/tarea para leer Hosts');
    assert.ok(!String(url).includes('/tasks'));
    calls.push(String(url));
    // Simula la proyección inclusiva real de NBI: el mock anterior devolvía
    // siempre el serial aunque la consulta lo omitiera, ocultando la regresión.
    const projection = new URL(String(url)).searchParams.get('projection')?.split(',') ?? [];
    return Response.json(rows.map(row => {
      const projected: Record<string, unknown> = {};
      for (const field of projection) {
        const keys = field.split('.');
        let source: unknown = row;
        for (const key of keys) source = (source as Record<string, unknown> | undefined)?.[key];
        if (source === undefined) continue;
        let target = projected;
        for (const key of keys.slice(0, -1)) {
          target[key] ??= {};
          target = target[key] as Record<string, unknown>;
        }
        target[keys[keys.length - 1]!] = source;
      }
      return projected;
    }));
  }) as typeof fetch;
  return calls;
}
const nbiUrl = 'http://nbi.invalid';

test('host asociado por WiFi (MAC en AssociatedDevice): conexión WiFi y banda real de esa instancia', async () => {
  nbi([device('485754431D3691B7', TEST_DEVICE,
    { 1: host({ mac: 'aa:bb:cc:dd:ee:01', name: 'Laptop', ip: '192.168.100.10' }) },
    { 1: { MACAddress: { _value: 'AA:BB:CC:DD:EE:01' } } },
  )]);
  const inv = await readHostsInventory(nbiUrl, TEST_SERIAL);
  assert.equal(inv.found, true);
  assert.equal(inv.hosts.length, 1);
  assert.deepEqual(inv.hosts[0], {
    hostName: 'Laptop', ipAddress: '192.168.100.10', macAddress: 'aa:bb:cc:dd:ee:01',
    connection: 'WiFi', band: '2.4 GHz', active: null, reportedAt: timestamp,
  });
});
test('host sin InterfaceType y sin asociación WiFi observada: conexión y banda quedan sin dato (nunca se inventa)', async () => {
  nbi([device('485754431D3691B7', TEST_DEVICE, { 1: host({ mac: 'aa:bb:cc:dd:ee:02', name: 'Impresora' }) })]);
  const inv = await readHostsInventory(nbiUrl, TEST_SERIAL);
  assert.equal(inv.hosts[0].connection, null);
  assert.equal(inv.hosts[0].band, null);
  assert.equal(inv.hosts[0].active, null, 'Active nunca reportado no es "desconectado"; es sin dato');
});
test('InterfaceType explícito manda sobre la inferencia por asociación WiFi', async () => {
  nbi([device('485754431D3691B7', TEST_DEVICE,
    { 1: host({ mac: 'aa:bb:cc:dd:ee:03', interfaceType: 'Ethernet' }) },
    { 1: { MACAddress: { _value: 'AA:BB:CC:DD:EE:03' } } }, // Misma MAC igual aparece "asociada", pero el equipo declara Ethernet.
  )]);
  const inv = await readHostsInventory(nbiUrl, TEST_SERIAL);
  assert.equal(inv.hosts[0].connection, 'Cable');
  assert.equal(inv.hosts[0].band, null, 'Cable nunca lleva banda WiFi');
});
test('Active explícito se respeta tal cual lo reporta el equipo (true o false)', async () => {
  nbi([device('485754431D3691B7', TEST_DEVICE, {
    1: host({ mac: 'aa:bb:cc:dd:ee:04', active: true }),
    2: host({ mac: 'aa:bb:cc:dd:ee:05', active: false }),
  })]);
  const inv = await readHostsInventory(nbiUrl, TEST_SERIAL);
  assert.equal(inv.hosts.find(h => h.macAddress === 'aa:bb:cc:dd:ee:04')!.active, true);
  assert.equal(inv.hosts.find(h => h.macAddress === 'aa:bb:cc:dd:ee:05')!.active, false);
});
test('identidad exacta: nunca mezcla hosts de otra ONT', async () => {
  nbi([
    device('485754431D3691B7', TEST_DEVICE, { 1: host({ mac: 'aa:bb:cc:dd:ee:06', name: 'DeEstaONT' }) }),
    device('HWTC00000000', 'otro-dispositivo', { 1: host({ mac: 'ff:ff:ff:ff:ff:ff', name: 'DeOtraONT' }) }),
  ]);
  const inv = await readHostsInventory(nbiUrl, TEST_SERIAL);
  assert.equal(inv.deviceId, TEST_DEVICE);
  assert.equal(inv.hosts.length, 1);
  assert.equal(inv.hosts[0].hostName, 'DeEstaONT');
  assert.ok(!JSON.stringify(inv).includes('DeOtraONT'));
});
test('rechaza coincidencia ambigua incluso entre representaciones equivalentes del mismo serial', async () => {
  nbi([device(), device(TEST_SERIAL, 'otro-id')]);
  await assert.rejects(readHostsInventory(nbiUrl, TEST_SERIAL), /ambigua/);
});
test('no encuentra el dispositivo: found=false, lista vacía, sin lanzar', async () => {
  nbi([device('HWTC00000000', 'otro-dispositivo')]);
  const inv = await readHostsInventory(nbiUrl, TEST_SERIAL);
  assert.equal(inv.found, false);
  assert.deepEqual(inv.hosts, []);
});
test('serial inválido no consulta NBI', async () => {
  const calls = nbi([device()]);
  await assert.rejects(readHostsInventory(nbiUrl, '1D3691B7'));
  assert.equal(calls.length, 0);
});
test('serial ASCII y hexadecimal identifican la misma ONT; lastInform y hostsReportedAt reales, no la hora de lectura', async () => {
  nbi([device()]);
  const inv = await readHostsInventory(nbiUrl, '485754431D3691B7');
  assert.equal(inv.serial, TEST_SERIAL);
  assert.equal(inv.lastInform, '2026-10-28T20:08:39.031Z');
  assert.equal(inv.hostsReportedAt, timestamp);
});

test('la consulta conserva identidad y busca ambas representaciones completas, sin coincidencias parciales', async () => {
  const calls = nbi([device()]);
  for (const serial of [TEST_SERIAL, '485754431D3691B7']) {
    assert.equal((await readHostsInventory(nbiUrl, serial)).deviceId, TEST_DEVICE);
  }
  for (const call of calls) {
    const url = new URL(call);
    assert.deepEqual(JSON.parse(url.searchParams.get('query')!), {
      '_deviceId._SerialNumber': { $in: [TEST_SERIAL, '485754431D3691B7'] },
    });
    assert.ok(url.searchParams.get('projection')!.split(',').includes('_deviceId._SerialNumber'));
  }
});

test('equipo identificado sin Hosts devuelve lista vacía; no confunde ausencia de datos con identidad ausente', async () => {
  nbi([device()]);
  const inv = await readHostsInventory(nbiUrl, TEST_SERIAL);
  assert.equal(inv.found, true);
  assert.deepEqual(inv.hosts, []);
});

test('caché real Huawei: cinco Hosts registrados; conexión, banda y Active sin valor quedan desconocidos', async () => {
  const cache = JSON.parse(fs.readFileSync(new URL('../../../../docs/TR069-HOSTS-CACHE-20261028.json', import.meta.url), 'utf8'));
  assert.equal(cache.before.length, 1);
  assert.equal(cache.before[0].serialPresent, false, 'La proyección desplegada omitía el serial');
  assert.equal(cache.after.length, 1);
  nbi(cache.after);
  const inv = await readHostsInventory(nbiUrl, TEST_SERIAL);
  assert.equal(inv.deviceId, TEST_DEVICE);
  assert.equal(inv.hosts.length, 5);
  for (const host of inv.hosts) {
    assert.ok(host.hostName && host.ipAddress && host.macAddress);
    assert.equal(host.connection, null);
    assert.equal(host.band, null);
    assert.equal(host.active, null);
  }
});
