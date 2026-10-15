// Local UI smoke test. Every external fetch is synthetic; no production access.
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const profile = await mkdtemp(join(tmpdir(), 'inventory-search-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-first-run', '--disable-background-networking', '--remote-debugging-port=0',
  '--user-data-dir=' + profile, 'about:blank',
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let ws;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let log = ''; const timeout = setTimeout(() => reject(Error('Chrome timeout')), 20000);
    chrome.on('error', reject);
    chrome.stderr.on('data', b => { log += b; const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
  });
  ws = new WebSocket(endpoint); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pending = new Map(); const exceptions = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (p) m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params); };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, sessionId })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const c = (method, params = {}) => send(method, params, sessionId);
  await c('Page.enable'); await c('Runtime.enable'); await c('Network.enable');
  await c('Network.setBlockedURLs', { urls: ['*supabase.co/*', 'https://inventory.invalid/*'] });
  const evaluate = async expression => { const r = await c('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  async function until(expression) { for (let i = 0; i < 80; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); } throw Error('Timeout: ' + expression); }
  function fixture() {
    const id = '00000000-0000-4000-8000-000000000001';
    const now = Math.floor(Date.now() / 1000), enc = o => btoa(JSON.stringify(o)).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_');
    const user = { id, aud: 'authenticated', role: 'authenticated', email: 'search@example.invalid', app_metadata: {}, user_metadata: {} };
    localStorage.setItem('sb-inventory-auth-token', JSON.stringify({ access_token: enc({ alg: 'HS256' }) + '.' + enc({ sub: id, exp: now + 3600, role: 'authenticated' }) + '.synthetic', refresh_token: 'synthetic', expires_at: now + 3600, user }));
    const realFetch = window.fetch.bind(window); window.__calls = [];
    const product = { id: 'product-1', name: 'Huawei HG8245', is_active: true, is_serialized: true, category_id: 'category-1', inventory_categories: { id: 'category-1', slug: 'onu', name: 'ONUs / ONTs' } };
    window.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.origin === location.origin && !url.pathname.startsWith('/api/')) return realFetch(input, init);
      const method = init.method ?? 'GET'; window.__calls.push({ path: url.pathname, search: url.search, method });
      if (method !== 'GET' && method !== 'HEAD' && url.pathname !== '/rest/v1/rpc/inventory_get_albums') throw Error('Blocked write');
      let data = []; const table = url.pathname.split('/').at(-1);
      if (table === 'profiles') data = url.searchParams.has('id') ? { id, role: 'SUPERADMIN', must_change_password: false } : [];
      if (table === 'inventory_categories') data = [{ id: 'category-1', slug: 'onu', name: 'ONUs / ONTs', is_active: true }];
      if (table === 'inventory_products') data = url.searchParams.has('id') ? product : [product];
      if (table === 'inventory_units') data = url.search.includes('missing') ? [] : [{ id: 'unit-1', product_id: product.id, product, serial_number: 'HWTC123', mac_address: 'AA:BB:CC:DD:EE:FF', status: 'assigned', clients: { first_name: 'Cliente', last_name: 'Simulado' }, contract: { id: 'contract-1', contract_number: 'CTR-TEST', installation_address: 'Dirección simulada' } }];
      if (url.search.includes('missing')) data = [];
      return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  }
  await c('Page.addScriptToEvaluateOnNewDocument', { source: '(' + fixture.toString() + ')();' });
  await c('Page.navigate', { url: 'http://127.0.0.1:4179/inventario?q=HWTC' });
  await until('document.body?.textContent.includes("AA:BB:CC:DD:EE:FF")');
  await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Ver unidad").click()');
  await until('!!document.querySelector("[role=dialog]")');
  assert.match(await evaluate('document.querySelector("[role=dialog]").textContent'), /CTR-TEST/);
  await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Cerrar").click()');
  assert.match(await evaluate('location.search'), /q=HWTC/);
  await evaluate('Array.from(document.querySelectorAll("a")).find(a => a.textContent === "Huawei HG8245").click()');
  await until('location.pathname === "/inventario/product-1"');
  await until('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.includes("Volver a Inventario"))');
  await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("Volver a Inventario")).click()');
  await until('location.pathname === "/inventario" && location.search.includes("q=HWTC")');
  await c('Page.navigate', { url: 'http://127.0.0.1:4179/inventario/album/onu?q=aabbcc' });
  await until('document.body?.textContent.includes("AA:BB:CC:DD:EE:FF")');
  const calls = await evaluate('window.__calls');
  assert.ok(calls.some(r => r.path.endsWith('inventory_units') && r.search.includes('product.category_id=eq.category-1')));
  assert.ok(calls.filter(r => r.path.endsWith('inventory_products')).every(r => new URLSearchParams(r.search).get('limit') === '26'), 'Album search must only request a bounded page');
  await evaluate('(()=>{const input=document.querySelector("input[placeholder*=Buscar]");input.value="missing";input.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await until('document.body?.textContent.includes("Sin coincidencias")');
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log('PASS: global search, unit modal, original MAC, linked contract, return context, scoped album, no catalogue download, no matches; browser exceptions=0');
  await send('Browser.close');
} finally { ws?.close(); chrome.kill(); }
