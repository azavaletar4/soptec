// Reproducer de límite: carga sólo el mutex real, nunca transportes ni servidor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import ts from 'typescript';

const source = readFileSync(new URL('../src/services/oltTelnetLock.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const worker = `
const vm = require('node:vm');
const exported = {};
vm.runInNewContext(process.argv[1], { exports: exported });
let release;
process.on('message', async message => {
  if (message === 'acquire') {
    await exported.withOltLock('synthetic-same-olt', async () => {
      const blocked = new Promise(resolve => { release = resolve; });
      process.send('entered');
      await blocked;
    });
    process.send('finished');
    process.disconnect();
  } else if (message === 'release') release();
});
process.send('ready');
`;

function launch() {
  const child = spawn(process.execPath, ['-e', worker, compiled], {
    windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const seen = new Set();
  const pending = new Map();
  let stderr = '';
  child.stderr.on('data', bytes => { stderr += bytes; });
  child.on('message', message => {
    seen.add(message);
    pending.get(message)?.resolve();
    pending.delete(message);
  });
  const fail = error => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };
  child.on('error', fail);
  child.on('exit', code => {
    if (!seen.has('finished')) fail(new Error(`Worker exited ${code}: ${stderr}`));
  });
  return {
    child,
    seen,
    wait(message) {
      if (seen.has(message)) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(message);
          reject(new Error(`Timeout waiting for ${message}: ${stderr}`));
        }, 5000);
        pending.set(message, {
          resolve() { clearTimeout(timer); resolve(); },
          reject(error) { clearTimeout(timer); reject(error); },
        });
      });
    },
  };
}

test('límite confirmado: dos procesos entran al mutex real de la misma OLT sin exclusión compartida', { timeout: 15000 }, async t => {
  const workers = [launch(), launch()];
  t.after(() => { for (const { child } of workers) if (child.exitCode === null) child.kill(); });
  await Promise.all(workers.map(w => w.wait('ready')));
  workers[0].child.send('acquire');
  await workers[0].wait('entered');
  workers[1].child.send('acquire');
  await workers[1].wait('entered');
  assert.ok(workers.every(w => w.seen.has('entered') && !w.seen.has('finished')),
    'Ambas secciones críticas están abiertas antes de liberar cualquiera');
  for (const { child } of workers) child.send('release');
  await Promise.all(workers.map(w => w.wait('finished')));
});
