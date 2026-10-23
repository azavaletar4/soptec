// UI real con datos sintéticos. Todo acceso externo se intercepta; ninguna escritura se permite.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

process.env.VITE_SUPABASE_URL = 'https://clients.invalid';
process.env.VITE_SUPABASE_ANON_KEY = 'synthetic';
const server = await createServer({ server: { host: '127.0.0.1', port: 4187, strictPort: true } });
await server.listen();
console.log('Local synthetic server ready');
const profile = await mkdtemp(join(tmpdir(), 'clientes-lifecycle-'));
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
  ws = new WebSocket(endpoint); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; setTimeout(() => j(Error('WebSocket timeout')), 15000).unref(); });
  let seq = 0; const pending = new Map(); const exceptions = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (p) m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params); };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => reject(Error('CDP timeout: ' + method)), 45000); pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: err => { clearTimeout(timer); reject(err); } }); ws.send(JSON.stringify({ id, method, params, sessionId })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const c = (method, params = {}) => send(method, params, sessionId);
  await c('Page.enable'); await c('Runtime.enable'); await c('Network.enable');
  await c('Network.setBlockedURLs', { urls: ['*supabase.co/*', 'https://clients.invalid/*'] });
  const evaluate = async expression => { const r = await c('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  async function until(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); } throw Error('Timeout: ' + expression); }
  function fixture() {
    const id = '00000000-0000-4000-8000-000000000001';
    const now = Math.floor(Date.now() / 1000), enc = o => btoa(JSON.stringify(o)).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_');
    const user = { id, aud: 'authenticated', role: 'authenticated', email: 'clients@example.invalid', app_metadata: {}, user_metadata: {} };
    localStorage.setItem('sb-clients-auth-token', JSON.stringify({ access_token: enc({ alg: 'HS256' }) + '.' + enc({ sub: id, exp: now + 3600, role: 'authenticated' }) + '.synthetic', refresh_token: 'synthetic', expires_at: now + 3600, user }));
    window.__role = new URLSearchParams(location.search).get('testRole') || 'ADMIN';
    const make = (id, first_name, status, statuses, installationStatus) => ({ id, first_name, last_name: 'Sintetico', document_number: 'DOC-' + id, document_type: 'cedula', status, created_at: '2026-10-01', phone: '555' + id, email: id + '@example.invalid',
      service_contracts: statuses.map((status, n) => ({ id: id + '-' + n, client_id: id, status, client_code: 'CODE-' + id, priority: 'medium' })),
      installations: installationStatus ? [{ id: 'inst-' + id, client_id: id, status: installationStatus, created_at: '2026-10-01' }] : [] });
    const clients = [make('retired', 'Retirado', 'retired', ['cancelled']), make('active', 'Activo', 'active', ['active']), make('suspended', 'Suspendido', 'suspended', ['suspended']), make('mixed', 'Mixto', 'retired', ['cancelled', 'active']), make('pending', 'Pendiente', 'retired', ['cancelled'], 'pending')];
    const realFetch = window.fetch.bind(window); window.__calls = [];
    window.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.origin === location.origin && !url.pathname.startsWith('/api/')) return realFetch(input, init);
      const method = init.method ?? 'GET'; window.__calls.push({ path: url.pathname, search: url.search, method });
      if (!['GET', 'HEAD'].includes(method)) throw Error('Blocked write: ' + method);
      let data = []; const table = url.pathname.split('/').at(-1);
      if (table === 'profiles') data = { id, role: window.__role, must_change_password: false };
      if (table === 'clients') data = window.__failClients ? null : clients;
      if (table === 'service_contracts') data = clients.flatMap(c => c.service_contracts);
      if (table === 'installations') data = clients.flatMap(c => c.installations);
      // Simula un servidor que entrega sólo dos filas por página.
      if (Array.isArray(data)) {
        const headers = new Headers(init.headers || (input instanceof Request ? input.headers : {}));
        const from = Number(url.searchParams.get('offset') || headers.get('range')?.split('-')[0] || 0);
        data = data.slice(from, from + 2);
      }
      if (table === 'clients' && window.__failClients) return new Response(JSON.stringify({ message: 'Synthetic read failure' }), { status: 500 });
      return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': '0-1/*' } });
    };
  }
  await c('Page.addScriptToEvaluateOnNewDocument', { source: '(' + fixture.toString() + ')();' });
  const navigate = async (role = 'ADMIN') => { await c('Page.navigate', { url: 'http://127.0.0.1:4187/clientes?testRole=' + role }); await until('document.body?.textContent.includes("4 vigentes · 1 retirados")'); };
  const click = label => evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().startsWith(${JSON.stringify(label)})).click()`);
  const names = () => evaluate('Array.from(document.querySelectorAll("tbody tr")).map(r => r.textContent)');
  await navigate();
  console.log('Synthetic client list loaded');
  assert.equal((await names()).length, 4);
  assert.ok(!(await names()).some(s => s.includes('Retirado Sintetico')));
  await click('Con múltiples servicios'); assert.match((await names()).join(' '), /Mixto/);
  await click('Suspendidos'); assert.match((await names()).join(' '), /Suspendido/);
  await click('Pendientes de instalación'); assert.match((await names()).join(' '), /Pendiente/);
  await click('Todos'); await click('Clientes retirados');
  assert.match((await names()).join(' '), /Retirado/);
  await evaluate(`{ const input = document.querySelector('input[placeholder^="Buscar por nombre"]'); input.value = 'DOC-retired'; input.dispatchEvent(new Event('input', { bubbles: true })); }`);
  assert.equal((await names()).length, 1);
  await click('Reincorporar');
  assert.match(await evaluate('document.querySelector("[role=dialog]").textContent'), /DOC-retired/);
  assert.equal(await evaluate('document.querySelector("[role=dialog] a").getAttribute("href")'), '/clientes/retired');
  await click('Cerrar');
  await click('+ Nuevo cliente');
  await evaluate(`{ const input = document.querySelector('.modal-overlay input[required]'); input.value = 'DOC-retired'; input.dispatchEvent(new Event('input', { bubbles: true })); }`);
  await until('document.querySelector(".modal-overlay").textContent.includes("Ya existe un cliente")');
  await evaluate('document.querySelector(".modal-overlay form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))');
  await until('document.querySelector(".modal-overlay").textContent.includes("Ya existe un cliente con ese documento")');
  assert.equal(await evaluate('window.__calls.filter(c => !["GET", "HEAD"].includes(c.method)).length'), 0);
  assert.ok(await evaluate('window.__calls.some(c => c.path.endsWith("/clients") && c.search.includes("offset=4"))'));
  assert.deepEqual(await evaluate(`(async () => { const { useDashboardStore } = await import('/src/stores/dashboard.ts'); const store = useDashboardStore(); await store.fetchSummary(); return JSON.parse(JSON.stringify(store.summary?.clients)); })()`), { active: 2, suspended: 1, prospect: 1, retired: 1 });
  for (const role of ['SUPERADMIN', 'SOPORTE', 'FACTURACION']) {
    console.log('Checking role:', role);
    await navigate(role); await click('Clientes retirados');
    assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).some(b => b.textContent.trim() === "Reincorporar")'), role === 'SUPERADMIN');
    assert.equal(await evaluate('window.__calls.filter(c => !["GET", "HEAD"].includes(c.method)).length'), 0);
  }
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log('PASS: UI real; 4 vigentes/1 retirado; filtros; búsqueda; reincorporación sin escrituras; documento duplicado; roles ADMIN/SUPERADMIN; paginación con límite 2.');
} finally {
  ws?.close(); chrome.kill(); await server.close();
}
