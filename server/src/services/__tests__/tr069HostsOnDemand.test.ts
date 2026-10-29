import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { buildHostsReadPlan, createHostsOnDemand, hostsDemandEnabledForSerial, HOSTS_READ_LIFETIME_MS } from '../tr069HostsOnDemand';
import { createHostsOnDemandRoutes } from '../../routes/tr069HostsOnDemand';
import { hostStatusLabel } from '../../../../src/lib/tr069Hosts';
import type { Role } from '../../types';
import type { HostsReadResult } from '../../../../src/lib/tr069Hosts';
import { genieacsSyncRoutes } from '../../routes/genieacsSync';

const serial = 'HWTC1D3691B7', hex = '485754431D3691B7';
const evidence = JSON.parse(fs.readFileSync(new URL('../../../../docs/TR069-HOSTS-ACTIVE-READ-20261028.json', import.meta.url), 'utf8'));
const original = evidence.find((e: any) => e.action === 'status' && !e.tasks.length && e.device._lastInform === '2026-10-28T22:03:39.211Z').device;
const nbi = 'http://mock.invalid';

function lab(t: { after: (fn: () => void) => void }, mode: 'complete' | 'pending' | 'timeout' | 'fault' | 'old' = 'complete') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hosts-demand-'));
  t.after(() => { assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); fs.rmSync(directory, { recursive: true, force: true }); });
  const device = structuredClone(original);
  let clock = Date.parse('2026-10-28T22:04:04Z');
  let tasks: any[] = [], faults: any[] = [], posts = 0, deleted = 0;
  const calls: { method: string; url: string; body?: any }[] = [];
  let getFails = false, rows = [device], hold: (() => Promise<void>) | undefined;
  function update() {
    clock += 50;
    device._lastInform = new Date(clock).toISOString();
    for (const [i, h] of Object.entries(device.InternetGatewayDevice.LANDevice[1].Hosts.Host)) {
      if (!/^[1-9]\d*$/.test(i)) continue;
      for (const field of ['Active', 'InterfaceType', 'Layer2Interface', 'HostName', 'IPAddress', 'MACAddress']) (h as any)[field]._timestamp = new Date(clock).toISOString();
    }
  }
  const request = (async (raw: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(raw)), method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url: url.href, body });
    assert.ok(init?.signal, 'Toda petición NBI tiene timeout');
    if (method === 'GET' && getFails) return Response.json({}, { status: 503 });
    if (method === 'GET' && url.pathname === '/devices/') {
      const q = JSON.parse(url.searchParams.get('query')!);
      assert.deepEqual(q['_deviceId._SerialNumber'].$in, [serial, hex]);
      assert.ok(url.searchParams.get('projection')!.includes('_deviceId._SerialNumber'));
      return Response.json(rows);
    }
    if (method === 'GET' && url.pathname === '/tasks/') {
      assert.deepEqual(JSON.parse(url.searchParams.get('query')!), { device: device._id });
      return Response.json(tasks);
    }
    if (method === 'GET' && url.pathname === '/faults/') return Response.json(faults);
    if (method === 'DELETE') {
      assert.equal(url.pathname, '/tasks/' + tasks[0]?._id); deleted++; tasks = []; return Response.json({});
    }
    assert.equal(method, 'POST'); posts++;
    assert.equal(url.pathname, '/devices/' + encodeURIComponent(device._id) + '/tasks');
    assert.equal(url.searchParams.get('timeout'), '12000');
    assert.ok(url.searchParams.has('connection_request'));
    assert.equal(body.name, 'getParameterValues');
    assert.ok(body.parameterNames.length <= 512);
    assert.ok(body.parameterNames.every((p: string) => !/Password|Passphrase|SSID|WANDevice|\.\*$/.test(p) && !p.endsWith('.')));
    tasks = [{ ...body, device: device._id, _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', timestamp: new Date(clock).toISOString() }];
    if (hold) await hold();
    if (mode === 'timeout') throw new DOMException('timeout', 'TimeoutError');
    if (mode === 'fault') faults = [{ _id: device._id + ':task_aaaaaaaaaaaaaaaaaaaaaaaa', code: 'cwmp.9005' }];
    if (mode === 'complete') { update(); tasks = []; }
    if (mode === 'old') tasks = [];
    return Response.json({ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }, { status: mode === 'pending' ? 202 : 200 });
  }) as typeof fetch;
  const deps = { request, directory, now: () => clock, enabled: () => true };
  return { device, calls, deps, service: createHostsOnDemand(deps), update,
    counts: () => ({ posts, deleted }),
    pendingDone() { update(); tasks = []; },
    advance(ms: number) { clock += ms; },
    failGet() { getFails = true; },
    rows(value: any[]) { rows = value; },
    busy() { tasks = [{ _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', name: 'other' }]; },
    foreignTask(ageMs: number, name = 'refreshObject') {
      tasks = [{ _id: 'cccccccccccccccccccccccc', name, device: device._id, objectName: 'InternetGatewayDevice.DeviceInfo',
        timestamp: new Date(clock - ageMs).toISOString() }];
    },
    setTasks(list: any[]) { tasks = list; },
    hold(fn: () => Promise<void>) { hold = fn; }, now: () => clock };
}

test('apertura autorizada: un GPV concreto, expiración, identidad exacta y fecha del equipo; otra acción nueva sí vuelve a leer', async t => {
  const l = lab(t);
  const first = await l.service.read(nbi, serial);
  assert.equal(first.state, 'completed'); assert.equal(first.inventory.deviceId, l.device._id);
  assert.equal(first.inventory.hosts.length, 5); assert.equal(l.counts().posts, 1);
  const posted = l.calls.find(c => c.method === 'POST')!.body;
  assert.equal(Date.parse(posted.expiry) - Date.parse(first.requestedAt), HOSTS_READ_LIFETIME_MS);
  assert.equal(hostStatusLabel(first.inventory.hosts[1]!, first.inventory.lastInform, l.now()), 'Conectado');
  await l.service.read(nbi, hex); assert.equal(l.counts().posts, 2);
});

test('concurrencia y serial hexadecimal/canónico comparten exactamente la misma promesa y tarea', async t => {
  const l = lab(t); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); l.hold(() => gate);
  const a = l.service.read(nbi, serial), b = l.service.read(nbi, hex);
  assert.equal(a, b); release(); await Promise.all([a, b]); assert.equal(l.counts().posts, 1);
});

test('202 pendiente: comprobaciones manuales y otra instancia backend reutilizan journal; ninguna reenviada', async t => {
  const l = lab(t, 'pending');
  assert.equal((await l.service.read(nbi, serial)).state, 'pending');
  assert.equal((await createHostsOnDemand(l.deps).read(nbi, hex)).state, 'pending');
  assert.equal(l.counts().posts, 1);
  l.pendingDone(); assert.equal((await l.service.read(nbi, serial)).state, 'completed');
  assert.equal(l.counts().posts, 1);
});

test('dos instancias concurrentes comparten el lock de ONT; la segunda no encola otra tarea', async t => {
  const l = lab(t); let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const reached = new Promise<void>(resolve => { entered = resolve; });
  l.hold(async () => { entered(); await gate; });
  const first = l.service.read(nbi, serial);
  await reached;
  await assert.rejects(createHostsOnDemand(l.deps).read(nbi, serial), /lectura en curso/);
  release(); await first; assert.equal(l.counts().posts, 1);
});

test('un cambio de identidad después del envío impide entregar datos de otro ID', async t => {
  const l = lab(t);
  l.hold(async () => { l.rows([{ ...l.device, _id: 'different-id' }]); });
  await assert.rejects(l.service.read(nbi, serial), /identidad cambió/);
  assert.equal(l.counts().posts, 1);
});

test('timeout de envío incierto no reintenta; adopta solo la tarea exacta y retira al caducar en comprobación manual', async t => {
  const l = lab(t, 'timeout');
  assert.equal((await l.service.read(nbi, serial)).state, 'uncertain');
  assert.equal((await createHostsOnDemand(l.deps).read(nbi, serial)).state, 'uncertain');
  assert.equal(l.counts().posts, 1);
  l.advance(HOSTS_READ_LIFETIME_MS + 1);
  assert.equal((await l.service.read(nbi, serial)).state, 'expired');
  assert.deepEqual(l.counts(), { posts: 1, deleted: 1 });
});

test('el CPE deja de reportar tres Hosts (ya no están en su propio árbol): la lectura real los conserva como "Sin confirmar", nunca "Desconectado" ni ausentes', async t => {
  const l = lab(t);
  const first = await l.service.read(nbi, serial);
  assert.equal(first.inventory.hosts.length, 5);
  const macsBefore = first.inventory.hosts.map(h => h.macAddress).sort();

  // El equipo real deja de anunciar tres instancias (DHCP/ARP caducado, no solo "Active=false").
  const hosts = l.device.InternetGatewayDevice.LANDevice[1].Hosts.Host;
  const kept = Object.keys(hosts).slice(0, 2);
  for (const key of Object.keys(hosts)) if (!kept.includes(key)) delete hosts[key];
  l.advance(11 * 60_000); // Más del plazo de frescura (10 min): los ausentes ya no pueden presentarse como confirmados.
  l.device._lastInform = new Date(l.now()).toISOString(); // El equipo vuelve a contactar, ahora con menos Hosts.

  const second = await l.service.read(nbi, serial);
  assert.equal(second.state, 'completed');
  assert.equal(second.inventory.hosts.length, 5, 'los tres ausentes del árbol en vivo se mantienen visibles');
  assert.deepEqual(second.inventory.hosts.map(h => h.macAddress).sort(), macsBefore, 'ningún MAC conocido se pierde');

  const stillReported = second.inventory.hosts.filter(h => kept.includes(Object.keys(hosts).find(k => hosts[k].MACAddress._value === h.macAddress) ?? ''));
  for (const h of second.inventory.hosts) {
    const isLive = stillReported.includes(h);
    if (isLive) assert.notEqual(hostStatusLabel(h, second.inventory.lastInform, l.now()), 'Sin confirmar', 'los dos que sí responden ahora deben tener un estado fresco');
    else assert.equal(hostStatusLabel(h, second.inventory.lastInform, l.now()), 'Sin confirmar', 'ausente del árbol en vivo: nunca se declara "Desconectado" sin evidencia nueva');
  }
});

test('fault de GenieACS: devuelve información histórica y cancela solo su propia lectura, sin retry', async t => {
  const l = lab(t, 'fault'); const r = await l.service.read(nbi, serial);
  assert.equal(r.state, 'failed'); assert.equal(r.inventory.hosts.length, 5);
  assert.deepEqual(l.counts(), { posts: 1, deleted: 1 });
  assert.ok(!l.calls.some(c => c.url.includes('/retry') || /reboot|setParameterValues/.test(JSON.stringify(c.body))));
});

test('200 sin fechas renovadas no declara éxito ni rejuvenece Active histórico', async t => {
  const l = lab(t, 'old'); l.advance(11 * 60_000); l.device._lastInform = new Date(l.now()).toISOString();
  const r = await l.service.read(nbi, serial);
  assert.equal(r.state, 'failed');
  assert.ok(r.inventory.hosts.every(h => hostStatusLabel(h, r.inventory.lastInform, l.now()) === 'Sin confirmar'));
});

test('identidad inválida, ausente o ambigua, falta de Inform, cola ocupada y fallo GET bloquean antes del POST', async t => {
  for (const kind of ['invalid', 'missing', 'ambiguous', 'offline', 'busy', 'nbi'] as const) {
    const l = lab(t);
    if (kind === 'missing') l.rows([]);
    if (kind === 'ambiguous') l.rows([l.device, { ...l.device, _id: 'other-id' }]);
    if (kind === 'offline') l.device._lastInform = '2026-01-01T00:00:00Z';
    if (kind === 'busy') l.busy();
    if (kind === 'nbi') l.failGet();
    await assert.rejects(l.service.read(nbi, kind === 'invalid' ? 'bad' : serial));
    assert.equal(l.counts().posts, 0, kind);
  }
});

test('tarea ajena reciente (de otro botón, p. ej. "Actualizar" general) bloquea igual que antes — sigue siendo una operación realmente activa', async t => {
  const l = lab(t);
  l.foreignTask(60_000); // 1 min: muy por debajo del margen de 5 min, claramente en curso.
  await assert.rejects(l.service.read(nbi, serial), /otra operación pendiente/);
  assert.equal(l.counts().posts, 0, 'nunca se envía una segunda operación mientras la ajena luce activa');
});

test('tarea ajena vieja y atascada (más de 5 min) ya no bloquea Hosts — pero nunca se cancela ni se borra', async t => {
  const l = lab(t);
  l.foreignTask(6 * 60_000); // 6 min: por encima del margen — ya no es "en curso" en ningún sentido real.
  const r = await l.service.read(nbi, serial);
  assert.equal(r.state, 'completed', 'la lectura de Hosts procede con normalidad');
  assert.equal(l.counts().posts, 1, 'Hosts sí envía su propia lectura, acotada y distinta de la tarea ajena');
  assert.equal(l.counts().deleted, 0, 'la tarea ajena vieja nunca se cancela ni se borra desde aquí');
  assert.ok(!l.calls.some(c => c.method === 'DELETE'), 'ningún DELETE se envía contra la tarea ajena');
});

test('justo antes del límite de 5 minutos todavía bloquea; justo en el límite (o después) ya no', async t => {
  const l = lab(t);
  l.foreignTask(5 * 60_000 - 1); // un instante antes del margen: todavía bloquea.
  await assert.rejects(l.service.read(nbi, serial), /otra operación pendiente/);
  const l2 = lab(t);
  l2.foreignTask(5 * 60_000); // exactamente en el margen: ya se considera vieja.
  const r = await l2.service.read(nbi, serial);
  assert.equal(r.state, 'completed');
});

test('varias tareas ajenas: una sola reciente entre varias viejas sigue bloqueando — nunca se asume "viejo" por mayoría', async t => {
  const l = lab(t);
  l.setTasks([
    { _id: 'd1', name: 'refreshObject', device: l.device._id, timestamp: new Date(l.now() - 20 * 60_000).toISOString() },
    { _id: 'd2', name: 'reboot', device: l.device._id, timestamp: new Date(l.now() - 10 * 60_000).toISOString() },
    { _id: 'd3', name: 'refreshObject', device: l.device._id, timestamp: new Date(l.now() - 30_000).toISOString() }, // esta sí es reciente
  ]);
  await assert.rejects(l.service.read(nbi, serial), /otra operación pendiente/);
  assert.equal(l.counts().posts, 0);
});

test('tarea ajena sin fecha utilizable: se trata como posiblemente activa, nunca como vieja por defecto', async t => {
  const l = lab(t);
  l.setTasks([{ _id: 'sinfecha', name: 'refreshObject', device: l.device._id }]); // sin "timestamp"
  await assert.rejects(l.service.read(nbi, serial), /otra operación pendiente/);
  assert.equal(l.counts().posts, 0);
});

test('tarea ajena vieja no duplica operaciones: una sola lectura propia en vuelo, igual que sin tareas ajenas', async t => {
  const l = lab(t); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); l.hold(() => gate);
  l.foreignTask(10 * 60_000);
  const a = l.service.read(nbi, serial), b = l.service.read(nbi, hex);
  assert.equal(a, b, 'misma promesa compartida, igual que el caso sin tareas ajenas');
  release(); await Promise.all([a, b]);
  assert.equal(l.counts().posts, 1, 'una sola operación propia enviada, nunca duplicada por la tarea ajena vieja');
});

test('plan no inventa asociaciones ni unidades y excluye claves/prefijos aunque el árbol las anuncie', () => {
  const d = structuredClone(original); const h = d.InternetGatewayDevice.LANDevice[1].Hosts.Host[1];
  h.Password = { _object: false }; h.X_HW_RSSI = { _object: false };
  const plan = buildHostsReadPlan(d);
  assert.ok(plan.includes('InternetGatewayDevice.LANDevice.1.Hosts.Host.1.X_HW_RSSI'));
  assert.ok(!plan.some(p => /Password|Unit|AssociatedDevice|SSID/.test(p)));
  d.InternetGatewayDevice.LANDevice[1].Hosts.Host = {};
  assert.throws(() => buildHostsReadPlan(d));
});

test('feature gate apagado impide incluso GET; código importado o página cerrada no realizan peticiones', async t => {
  const l = lab(t); const service = createHostsOnDemand({ ...l.deps, enabled: () => false });
  assert.equal(l.calls.length, 0); await assert.rejects(service.read(nbi, serial)); assert.equal(l.calls.length, 0);
});

test('habilitación productiva exige interruptor y serial permitido; ninguna otra ONT queda autorizada', () => {
  const enabled = process.env.TR069_HOSTS_ON_DEMAND_ENABLED, list = process.env.TR069_HOSTS_ON_DEMAND_SERIALS;
  try {
    process.env.TR069_HOSTS_ON_DEMAND_ENABLED = 'true';
    delete process.env.TR069_HOSTS_ON_DEMAND_SERIALS;
    assert.equal(hostsDemandEnabledForSerial(serial), false);
    process.env.TR069_HOSTS_ON_DEMAND_SERIALS = serial;
    assert.equal(hostsDemandEnabledForSerial(serial), true);
    assert.equal(hostsDemandEnabledForSerial(hex), true);
    assert.equal(hostsDemandEnabledForSerial('HWTC00000000'), false);
    assert.equal(hostsDemandEnabledForSerial('bad'), false);
    process.env.TR069_HOSTS_ON_DEMAND_ENABLED = 'false';
    assert.equal(hostsDemandEnabledForSerial(serial), false);
  } finally {
    if (enabled === undefined) delete process.env.TR069_HOSTS_ON_DEMAND_ENABLED; else process.env.TR069_HOSTS_ON_DEMAND_ENABLED = enabled;
    if (list === undefined) delete process.env.TR069_HOSTS_ON_DEMAND_SERIALS; else process.env.TR069_HOSTS_ON_DEMAND_SERIALS = list;
  }
});

test('ruta usa requireRole real: solo ADMIN/SUPERADMIN, cuerpo sin rutas de configuración', async () => {
  let calls = 0;
  const service = { read: async (): Promise<HostsReadResult> => { calls++; return { state: 'pending', requestedAt: '', checkedAt: '', message: 'Pendiente', inventory: { found: false, deviceId: null, serial, lastInform: null, hostsReportedAt: null, hosts: [] } }; } };
  for (const role of ['ADMIN', 'SUPERADMIN', 'SOPORTE', 'TECNICO_RED', 'TECNICO', 'CLIENTE'] as Role[]) {
    const app = new Hono(); app.use('*', async (c, next) => { c.set('user', { id: 'test', role }); await next(); });
    app.route('/', createHostsOnDemandRoutes(service));
    const before = calls; const r = await app.request('/' + serial + '/read', { method: 'POST', body: '{}' });
    assert.equal(r.status, ['ADMIN', 'SUPERADMIN'].includes(role) ? 202 : 403);
    assert.equal(calls - before, ['ADMIN', 'SUPERADMIN'].includes(role) ? 1 : 0);
    if (role === 'ADMIN') {
      const invalid = await app.request('/' + serial + '/read', { method: 'POST', body: JSON.stringify({ parameterNames: ['password'] }) });
      assert.equal(invalid.status, 400);
    }
  }
});

test('ruta montada real exige autenticación antes de cualquier operación activa', async () => {
  const r = await genieacsSyncRoutes.request('/hosts/' + serial + '/read', { method: 'POST', body: '{}' });
  assert.equal(r.status, 401);
});
