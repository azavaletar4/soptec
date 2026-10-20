import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInventoryRefresh } from '../inventoryRefresh';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Caso real reproducido en RoutineInventory.vue (laboratorio integral,
// 20/10/2026): el navegador puede reportar "oculto" justo al montar (una
// pestaña en segundo plano, un WebView que todavia no se marco visible) --
// startInventorySignals() dispara ese aviso inicial casi al mismo tiempo
// que la carga real resuelve con los datos correctos. Antes de este fix,
// ese aviso de visibilidad llamaba a la misma limpieza que un cambio de
// contexto real, borrando los materiales recien publicados sin que nada
// los volviera a pedir.
test('un aviso de "oculto" justo despues de publicar no borra lo ya mostrado', async () => {
  const published: unknown[] = [];
  const cleared: number[] = [];
  const refresh = createInventoryRefresh<string, { items: string[] }>({
    load: async () => ({ items: ['material-1'] }),
    clear: () => cleared.push(Date.now()),
    publish: (value) => published.push(value),
    state: () => {},
  });

  refresh.setContext('job-1'); // limpieza inicial legitima (contexto nuevo, no hay nada previo que preservar)
  const clearedAfterContext = cleared.length;
  await refresh.refresh();
  assert.deepEqual(published, [{ items: ['material-1'] }], 'la carga real debio publicarse');

  refresh.setVisible(false); // el aviso real de "oculto" llega justo despues
  assert.equal(cleared.length, clearedAfterContext, 'ocultarse no debe borrar los materiales ya publicados');
  assert.deepEqual(published, [{ items: ['material-1'] }], 'los materiales ya publicados siguen siendo los mismos');
});

test('un aviso de "oculto" mientras la carga todavia esta en vuelo descarta esa respuesta sin borrar lo anterior', async () => {
  const published: unknown[] = [];
  const cleared: number[] = [];
  const deferred: { resolve?: (value: { items: string[] }) => void } = {};
  const refresh = createInventoryRefresh<string, { items: string[] }>({
    load: () => new Promise<{ items: string[] }>((resolve) => { deferred.resolve = resolve; }),
    clear: () => cleared.push(Date.now()),
    publish: (value) => published.push(value),
    state: () => {},
  });

  refresh.setContext('job-1'); // limpieza inicial legitima (contexto nuevo, no hay nada previo que preservar)
  const clearedAfterContext = cleared.length;
  const pending = refresh.refresh();
  refresh.setVisible(false); // llega ANTES de que la carga en curso resuelva
  deferred.resolve?.({ items: ['material-tardio'] });
  await pending;

  assert.equal(published.length, 0, 'una respuesta de una generacion vieja (ya oculta) no debe publicarse');
  assert.equal(cleared.length, clearedAfterContext, 'ocultarse mientras la carga esta en vuelo no debe disparar otra limpieza');
});

test('volver a ser visible dispara una lectura real nueva', async () => {
  let loads = 0;
  const published: unknown[] = [];
  const refresh = createInventoryRefresh<string, { items: string[] }>({
    load: async () => { loads += 1; return { items: ['material-' + loads] }; },
    clear: () => {},
    publish: (value) => published.push(value),
    state: () => {},
  });

  refresh.setContext('job-1');
  await refresh.refresh();
  refresh.setVisible(false);
  refresh.setVisible(true);
  await delay(10);

  assert.equal(loads, 2, 'volver a estar visible debe pedir los datos de nuevo');
  assert.deepEqual(published.at(-1), { items: ['material-2'] });
});

test('quedarse sin conexion tampoco borra lo ya mostrado, pero un cambio de contexto real si', async () => {
  const cleared: string[] = [];
  const refresh = createInventoryRefresh<string, { items: string[] }>({
    load: async () => ({ items: ['material-1'] }),
    clear: () => cleared.push('clear'),
    publish: () => {},
    state: () => {},
  });

  refresh.setContext('job-1'); // limpieza inicial legitima (contexto nuevo, no hay nada previo que preservar)
  const clearedAfterContext = cleared.length;
  await refresh.refresh();
  refresh.setOnline(false);
  assert.equal(cleared.length, clearedAfterContext, 'perder la conexion no debe borrar los materiales ya mostrados');

  refresh.setContext('job-2'); // otra orden real: ahi si corresponde borrar
  assert.equal(cleared.length, clearedAfterContext + 1, 'un cambio de contexto real (otra orden) si debe limpiar');
});
