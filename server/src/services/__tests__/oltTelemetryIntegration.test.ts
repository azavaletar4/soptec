import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { startFakeOltCli } from './fakeOltCli';
import { TEST_USERNAME, TEST_PASSWORD } from '../../telnet/__tests__/fakeOltServer';
import { ontTelemetry } from '../oltTelemetry';
import { requireAuth } from '../../middleware/auth';

test('scheduler y rutas reales: Janet/Estiven, guardas, proyección, señal e importación sin atribución cruzada', { timeout: 30000 }, async () => {
  const commands: string[] = [], writes: { table: string; method: string; body: any; filters: URLSearchParams }[] = [];
  let failState = false, failInventory = false, truncateInventory = false;
  let opticalRx = -23.98, missingOptics = false;
  let hideHuawei = false, replaceBeforeUpdate = false;
  const old = { id: 'old', olt_device_id: 'olt', serial: 'MSTC8CCE647E', frame: 1, slot: 2, port: 8, ont_id: 3, status: 'online', admin_state: 'enable', rx_power: -19.67, tx_power: 2.32, last_synced_at: '2026-10-20T20:31:31Z', client_id: null, contract_id: null, description: 'Janet antigua' };
  const huawei = { ...old, id: 'huawei', serial: 'HWTCDEB847B6', ont_id: 50, status: 'offline', rx_power: -20, client_id: 'janet', contract_id: 'contract-janet' };
  const rows = [structuredClone(old), structuredClone(huawei)];
  const cli = await startFakeOltCli({ initialEntries: {
    '1/2/8:3': { serial: 'HWTCE5C94DB6', onuType: 'GPT', description: 'Estiven' },
    '1/2/8:50': { serial: huawei.serial, onuType: 'GPT', description: 'Janet' },
  }, onCommand: c => commands.push(c), intercept: c => {
    if (c === 'show gpon onu state' && failState) return { action: 'reject', message: '%Error 20202: Invalid input detected' };
    if (c === 'show gpon onu state') return { action: 'customResponse', text: 'OnuIndex AdminState OMCC RunState Type\r\n1/2/8:3 enable enable working 1(GPON)\r\n1/2/8:50 enable enable working 1(GPON)\r\nONU Number: 2/2' };
    if (c.startsWith('show pon power')) return { action: 'customResponse', text: missingOptics ? '' : `gpon-onu_1/2/8:3    ${c.includes('onu-rx') ? '-19.708' : '2.225'}(dbm)\r\ngpon-onu_1/2/8:50   ${c.includes('onu-rx') ? String(opticalRx) : '2.356'}(dbm)` };
    if (['show gpon onu uncfg','show system-group','show card-temperature','show processor'].includes(c)) return { action: 'customResponse', text: '' };
    return undefined;
  } });
  const originalFetch = globalThis.fetch, originalEnv = { url: process.env.VITE_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.VITE_SUPABASE_URL = 'http://127.0.0.1:1'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'local-test-only';
  const device = { id: 'olt', name: 'Fake OLT', host: '127.0.0.1', telnet_port: cli.port, username: TEST_USERNAME, password: TEST_PASSWORD, brand: 'zte' };
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url); assert.equal(url.origin, 'http://127.0.0.1:1', 'external network forbidden');
    const table = url.pathname.split('/').at(-1)!, method = request.method, filters = url.searchParams;
    const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', ...(Array.isArray(body) ? { 'Content-Range': `0-${Math.max(0,body.length-1)}/${body.length}` } : {}) } });
    if (method === 'GET') {
      if (table === 'olt_devices') return response(device);
      if (table === 'service_contracts') return response([]);
      if (table === 'olt_onts') {
        if (failInventory) return new Response(JSON.stringify({ message: 'simulated inventory failure' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        const found = rows.filter(row => [...filters].every(([key, value]) => !value.startsWith('eq.') || String((row as any)[key]) === value.slice(3)));
        if (hideHuawei) return response(found.filter(row=>row.id!=='huawei'));
        if (truncateInventory) return new Response(JSON.stringify(found.slice(0,1)), { status:200, headers:{'Content-Type':'application/json','Content-Range':`0-0/${found.length}`} });
        return response(filters.has('id') ? found[0] ?? null : found);
      }
      return response(null);
    }
    const body: any = await request.json(); writes.push({ table, method, body, filters });
    if (table === 'olt_onts' && method === 'PATCH') {
      if (replaceBeforeUpdate) { rows[1]!.serial = 'CONCURRENT-REPLACEMENT'; replaceBeforeUpdate = false; }
      const row = rows.find(row => [...filters].every(([key,value]) => !value.startsWith('eq.') || String((row as any)[key]) === value.slice(3)));
      if (!row) return response(null); Object.assign(row, body); return response(row);
    }
    if (table === 'olt_onts') {
      for (const update of Array.isArray(body) ? body : [body]) {
        assert(!('status' in update || 'rx_power' in update || 'tx_power' in update || 'client_id' in update || 'contract_id' in update));
        const row = rows.find(r => r.ont_id === update.ont_id);
        if (row) return new Response(JSON.stringify({message:'duplicate position'}),{status:409,headers:{'Content-Type':'application/json'}});
        rows.push(update);
      }
    }
    return response(body);
  }) as typeof fetch;
  try {
    const { runOltFullSync } = await import('../oltSyncService');
    const result = await runOltFullSync(device); assert(result?.scanComplete);
    assert.deepEqual(rows[0], old); assert.equal(rows[1]!.status, 'online'); assert.equal(rows[1]!.rx_power, -23.98); assert.equal(rows[1]!.contract_id, 'contract-janet');
    assert(!writes.some(w => w.table === 'olt_alert_log'), 'no alerts from unverified historical baseline');
    assert.equal(ontTelemetry.project(rows[0]!).status, 'unknown'); assert.equal(ontTelemetry.project(rows[0]!).rx_power, null);
    const app = new Hono(); app.use('*', async (c, next) => { (c as any).set('user', { id: 'operator', role: 'ADMIN' }); await next(); });
    const { oltRoutes } = await import('../../routes/olt');
    // Only JWT verification is replaced by the test principal above; real handlers and role guards remain.
    for (const route of oltRoutes.routes) if (route.handler !== requireAuth) app.on(route.method, '/devices' + route.path, route.handler);
    const list = await app.request('/devices/olt/onts'); assert.equal(list.status,200); const body = await list.json() as any[]; assert.equal(body[0].status,'unknown'); assert.equal(body[0].telemetry.historical.rxPower, -19.67);
    const serialStatus = await app.request('/devices/onts/status?serials=MSTC8CCE647E,HWTCDEB847B6');
    assert.equal((await serialStatus.json() as any).MSTC8CCE647E.status,'unknown');
    const oldSignal = await app.request('/devices/olt/onts/old/signal'); assert.equal(oldSignal.status,502); assert.deepEqual(rows[0],old);
    const newSignal = await app.request('/devices/olt/onts/huawei/signal'); assert.equal(newSignal.status,200); assert.equal((await newSignal.json() as any).rxPower,-23.98);
    const manual = await app.request('/devices/olt/onts/sync', { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({shelf:1,slot:2,port:8}) }); assert.equal(manual.status,200); assert.equal((await manual.json() as any).identityConflicts.length,1);
    const imported = await app.request('/devices/olt/onts/import-existing',{method:'POST'}); assert.equal(imported.status,200); assert.equal((await imported.json() as any).conflicts.length,1); assert.deepEqual(rows[0],old);
    assert(!writes.some(w=>w.table==='olt_onts'&&w.method==='PATCH'&&w.filters.get('id')==='eq.old'));
    assert(writes.filter(w=>w.table==='olt_onts'&&w.method==='PATCH').every(w=>w.filters.get('serial')==='eq.HWTCDEB847B6'));
    // FAIL reproduction #1: no write, not even an upsert, after an inventory query error/truncation.
    for (const mode of ['failed','truncated']) {
      failInventory = mode === 'failed'; truncateInventory = mode === 'truncated';
      const before = structuredClone(rows), count = writes.length;
      const rejected = await app.request('/devices/olt/onts/import-existing',{method:'POST'});
      assert.equal(rejected.status,503); assert.deepEqual(rows,before); assert.equal(writes.length,count);
      failInventory = false; truncateInventory = false;
    }
    // FAIL reproduction #2: valid signal -> no optical scan / missing optical reading -> low signal.
    await runOltFullSync(device,{includeSignal:true});
    await runOltFullSync(device,{includeSignal:false});
    missingOptics = true; await runOltFullSync(device,{includeSignal:true}); missingOptics = false;
    assert.equal(ontTelemetry.project(rows[1]!).rx_power,null,'missing reading is not displayed as current');
    const alertStart = writes.length;
    opticalRx = -30; await runOltFullSync(device,{includeSignal:true});
    await runOltFullSync(device,{includeSignal:true});
    const lowAlerts = writes.slice(alertStart).filter(w=>w.table==='olt_alert_log').flatMap(w=>w.body);
    assert.equal(lowAlerts.filter(a=>a.kind==='lowSignal').length,1);
    assert(lowAlerts.every(a=>a.olt_ont_id==='huawei'),'no alert attributed to the old ONT');
    opticalRx = -23.98; await runOltFullSync(device,{includeSignal:true});
    const recovered = writes.slice(alertStart).filter(w=>w.table==='olt_alert_log').flatMap(w=>w.body);
    assert.equal(recovered.filter(a=>a.kind==='signalRecovered').length,1);
    assert.deepEqual(rows[0],old);
    failState = true;
    const beforeFailure = structuredClone(rows), writeCount = writes.length;
    assert.equal((await runOltFullSync(device))!.scanComplete,false);
    assert.deepEqual(rows,beforeFailure); assert.equal(ontTelemetry.project(rows[1]!).status,'unknown');
    assert(!writes.slice(writeCount).some(w=>w.table==='olt_onts'),'failed query must not manufacture offline writes');
    failState = false;
    const beforeInsertRace = structuredClone(rows);
    hideHuawei = true;
    assert.equal((await app.request('/devices/olt/onts/import-existing',{method:'POST'})).status,409);
    hideHuawei = false; assert.deepEqual(rows,beforeInsertRace,'INSERT collision must not overwrite either identity');
    replaceBeforeUpdate = true;
    assert.equal((await app.request('/devices/olt/onts/import-existing',{method:'POST'})).status,409);
    assert.equal(rows[1]!.serial,'CONCURRENT-REPLACEMENT');
    assert.equal(rows[1]!.contract_id,'contract-janet'); assert.deepEqual(rows[0],old);
    assert(commands.every(c=>c==='enable'||c==='terminal length 0'||c.startsWith('show ')),JSON.stringify(commands));
  } finally {
    globalThis.fetch = originalFetch;
    if(originalEnv.url===undefined)delete process.env.VITE_SUPABASE_URL;else process.env.VITE_SUPABASE_URL=originalEnv.url;
    if(originalEnv.key===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=originalEnv.key;
    await cli.close();
  }
});
