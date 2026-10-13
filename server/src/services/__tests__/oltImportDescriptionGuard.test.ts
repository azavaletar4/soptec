import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positionKey, splitByLinkStatus } from '../oltImportDescriptionGuard';

test('positionKey: formato estable frame/slot/port:ontId', () => {
  assert.equal(positionKey(1, 2, 4, 26), '1/2/4:26');
});

test('splitByLinkStatus: ONT sin vincular -> va a "unlinked" (sigue tomando el nombre de la OLT)', () => {
  const candidates = [{ frame: 1, slot: 2, port: 4, ontId: 26 }];
  const { linked, unlinked } = splitByLinkStatus(candidates, new Set());
  assert.deepEqual(linked, []);
  assert.deepEqual(unlinked, candidates);
});

test('splitByLinkStatus: ONT ya vinculada (posicion en el set) -> va a "linked" (no se pisa su nombre)', () => {
  const candidates = [{ frame: 1, slot: 2, port: 4, ontId: 19 }];
  const { linked, unlinked } = splitByLinkStatus(candidates, new Set(['1/2/4:19']));
  assert.deepEqual(linked, candidates);
  assert.deepEqual(unlinked, []);
});

test('splitByLinkStatus: separa correctamente un lote mixto (caso real Violeta/Clara/Mayco)', () => {
  const candidates = [
    { frame: 1, slot: 2, port: 4, ontId: 26 }, // Violeta - vinculada
    { frame: 1, slot: 2, port: 13, ontId: 33 }, // Clara - vinculada
    { frame: 1, slot: 2, port: 4, ontId: 19 }, // Mayco - vinculada
    { frame: 1, slot: 2, port: 9, ontId: 4 }, // sin vincular (Situacion A)
  ];
  const linkedPositions = new Set(['1/2/4:26', '1/2/13:33', '1/2/4:19']);
  const { linked, unlinked } = splitByLinkStatus(candidates, linkedPositions);
  assert.equal(linked.length, 3);
  assert.deepEqual(unlinked, [{ frame: 1, slot: 2, port: 9, ontId: 4 }]);
});

test('splitByLinkStatus: no confunde por serial/nombre, solo mira la posicion (frame/slot/port/ontId)', () => {
  // Misma "forma" de objeto, distinta posicion -> no debe matchear por accidente.
  const candidates = [{ frame: 1, slot: 2, port: 4, ontId: 26 }];
  const { linked, unlinked } = splitByLinkStatus(candidates, new Set(['1/2/4:27'])); // onu-id vecino, no el mismo
  assert.deepEqual(linked, []);
  assert.deepEqual(unlinked, candidates);
});

test('splitByLinkStatus: lista vacia no rompe', () => {
  assert.deepEqual(splitByLinkStatus([], new Set(['1/2/4:26'])), { linked: [], unlinked: [] });
});
