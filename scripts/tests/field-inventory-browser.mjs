// Regresión local de integración Campo, solo datos sintéticos e interceptación externa.
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const profile = await mkdtemp(join(tmpdir(), 'inventory-authorization-'));
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
  for (const type of ['installation','ticket']) for (const lost of [false,true]) {
    await c('Page.navigate',{url:'http://127.0.0.1:4179/scripts/tests/field-inventory-harness.html?type='+type+(lost?'&lost=1':'')});
    await until('window.__ready && document.body?.textContent.includes("SERIE-CONTEXTUAL")');
    const calls=await evaluate('window.__calls');
    assert.ok(calls.some(r=>r.path.includes('/api/campo-inventory/'+type+'/')));
    assert.equal(calls.some(r=>r.method==='GET'&&/\/rest\/v1\/inventory_(products|units|movements)/.test(r.path)),false,'No debe leer tablas administrativas de inventario');
    const click=type==='installation'
      ? 'Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="Quitar")'
      : 'document.querySelector("button[title^=Desvincular]")';
    await evaluate('('+click+').click()');
    if(lost){
      await until('document.body.textContent.includes("Hay una operación de inventario pendiente")');
      await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("Confirmar operación de inventario pendiente")).click()');
    }
    await until('window.__calls.some(r=>r.path.endsWith("/campo_inventory_operation")&&r.method==="POST") && !document.body.textContent.includes("SERIE-CONTEXTUAL")');
    const after=await evaluate('window.__calls');
    const writes=after.filter(r=>r.method==='POST');
    assert.equal(writes.length,lost?2:1,'Solo reenvía al confirmar la operación pendiente');
    assert.equal(await evaluate('window.__commitCount'),1,'Un solo commit aun con respuesta perdida');
    if(lost)assert.equal(writes[0].body.p_operation_id,writes[1].body.p_operation_id);
    assert.equal(writes[0].body.p_payload.unitId,'00000000-0000-4000-8000-000000000010');
    assert.equal(writes[0].body.p_action,type==='installation'?'unassign':'unlink');
    assert.equal(writes[0].body.p_job_type,type);
    assert.equal(writes[0].body.p_job_id,'00000000-0000-4000-8000-000000000002');
    assert.ok(writes[0].body.p_operation_id);
    assert.equal(after.some(r=>r.path.endsWith('/inventory_unit_events')&&r.method!=='GET'),false);
    assert.equal(after.some(r=>r.path.endsWith('/inventory_movements')&&r.method!=='GET'),false);
    console.log('PASS Campo '+type+(lost?' respuesta perdida + replay':'')+': un commit; contexto e intención estables; cero INSERT directos.');
  }
  assert.equal(exceptions.length,0,JSON.stringify(exceptions.map(e=>e.exceptionDetails?.exception?.description?.split('\n')[0])));
  await send('Browser.close');
} finally {ws?.close();chrome.kill();}
