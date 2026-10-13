import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePonOccupancy, PON_PORT_MAX_ONUS } from '../oltCapacity';

test('agrupa por slot/port y cuenta cuantas ONTs tiene cada puerto', () => {
  const onts = [
    { slot: 2, port: 1 }, { slot: 2, port: 1 }, { slot: 2, port: 2 }, { slot: 3, port: 1 },
  ];
  const result = computePonOccupancy(onts);
  assert.deepEqual(result.map((r) => [r.slot, r.port, r.count]), [[2, 1, 2], [2, 2, 1], [3, 1, 1]]);
});

test('ordena por slot y luego por puerto, sin importar el orden de entrada', () => {
  const onts = [{ slot: 3, port: 1 }, { slot: 2, port: 2 }, { slot: 2, port: 1 }];
  const result = computePonOccupancy(onts);
  assert.deepEqual(result.map((r) => `${r.slot}/${r.port}`), ['2/1', '2/2', '3/1']);
});

test('pct usa PON_PORT_MAX_ONUS y nunca pasa de 100 aunque haya mas ONTs que el limite', () => {
  const onts = Array.from({ length: PON_PORT_MAX_ONUS + 5 }, () => ({ slot: 1, port: 1 }));
  const [entry] = computePonOccupancy(onts);
  assert.equal(entry.count, PON_PORT_MAX_ONUS + 5);
  assert.equal(entry.pct, 100);
  assert.equal(entry.max, PON_PORT_MAX_ONUS);
});

test('lista vacia no rompe y devuelve []', () => {
  assert.deepEqual(computePonOccupancy([]), []);
});
