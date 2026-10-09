import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSignalRefresh, type SignalRefreshDeps } from '../signalRefreshFlow';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('consulta exitosa: aplica rxPower/txPower a la ONU mostrada y resuelve ok', async () => {
  const patched: { rx: number | null; tx: number | null }[] = [];
  const deps: SignalRefreshDeps = {
    getSignal: async () => ({ rxPower: -16.87, txPower: 2.53 }),
    patchOntSignal: (rx, tx) => patched.push({ rx, tx }),
    refreshList: async () => {},
  };

  const result = await runSignalRefresh(deps);

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(patched, [{ rx: -16.87, tx: 2.53 }], 'debe aplicar exactamente el rx/tx devuelto por getSignal()');
});

test('timeout o error en getSignal: libera con ok=false y el mensaje real, sin tocar la ONU ni refrescar el listado', async () => {
  let patchCalls = 0;
  let refreshCalls = 0;
  const deps: SignalRefreshDeps = {
    getSignal: async () => {
      throw new Error('La consulta superó el tiempo de espera (90s) y se canceló desde el navegador.');
    },
    patchOntSignal: () => {
      patchCalls += 1;
    },
    refreshList: async () => {
      refreshCalls += 1;
    },
  };

  const result = await runSignalRefresh(deps);

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /superó el tiempo de espera/);
  assert.equal(patchCalls, 0, 'un getSignal fallido no debe tocar la ONU mostrada');
  assert.equal(refreshCalls, 0, 'un getSignal fallido no debe disparar el refresco del listado (nada cambio)');
});

test('un refresco secundario del listado LENTO nunca mantiene bloqueada la consulta', async () => {
  let refreshStarted = false;
  let refreshFinished = false;
  const deps: SignalRefreshDeps = {
    getSignal: async () => ({ rxPower: -20, txPower: 2 }),
    patchOntSignal: () => {},
    refreshList: async () => {
      refreshStarted = true;
      await delay(500); // mucho mas lento que lo que runSignalRefresh debe tardar en resolver
      refreshFinished = true;
    },
  };

  const start = Date.now();
  const result = await runSignalRefresh(deps);
  const elapsed = Date.now() - start;

  assert.deepEqual(result, { ok: true });
  assert.ok(elapsed < 100, `runSignalRefresh tardo ${elapsed}ms — no debio esperar los 500ms de refreshList`);
  assert.ok(refreshStarted, 'el refresco del listado si debe dispararse');
  assert.ok(!refreshFinished, 'en este punto el refresco todavia no debio terminar (prueba de que no se esperó)');

  // Dejar que el refresco en segundo plano termine antes de que el test cierre.
  await delay(600);
  assert.ok(refreshFinished, 'el refresco en segundo plano si debe completarse eventualmente');
});

test('un refresco secundario del listado que FALLA tampoco se reporta como error de la consulta', async () => {
  const deps: SignalRefreshDeps = {
    getSignal: async () => ({ rxPower: -18, txPower: 3 }),
    patchOntSignal: () => {},
    refreshList: async () => {
      throw new Error('fallo de red al refrescar el listado completo');
    },
  };

  // No debe lanzar (ni como excepcion sincrona ni como unhandled rejection) —
  // runSignalRefresh ya resolvio con exito antes de que refreshList fallara.
  const result = await runSignalRefresh(deps);
  assert.deepEqual(result, { ok: true });

  // Deja un tick para que el .catch() interno de refreshList se resuelva
  // (si no existiera, esto generaria un unhandled rejection que node:test
  // reportaria como fallo del proceso).
  await delay(10);
});
