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

test('ponNumber es correlativo sobre los puertos ya conocidos (slot 2 agota antes de que slot 3 empiece)', () => {
  const onts = [
    ...Array.from({ length: 16 }, (_, i) => ({ slot: 2, port: i + 1 })),
    { slot: 3, port: 1 },
  ];
  const result = computePonOccupancy(onts);
  assert.deepEqual(result.map((r) => [r.slot, r.port, r.ponNumber]).slice(0, 3), [[2, 1, 1], [2, 2, 2], [2, 3, 3]]);
  const slot3 = result.find((r) => r.slot === 3 && r.port === 1);
  assert.equal(slot3?.ponNumber, 17);
});

test('zona predominante: la de mayor conteo en ese puerto, nunca una elegida al azar entre empatadas (desempata por nombre)', () => {
  const zoneA = { id: 'a', name: 'PON 1 - AO' };
  const zoneB = { id: 'b', name: 'PON 2 - SM' };
  const onts = [{ slot: 2, port: 1, zones: zoneA }, { slot: 2, port: 1, zones: zoneA }, { slot: 2, port: 1, zones: zoneB }];
  const [entry] = computePonOccupancy(onts);
  assert.deepEqual(entry.dominantZone, { zoneId: 'a', zoneName: 'PON 1 - AO', count: 2 });
  assert.equal(entry.otherZonesCount, 1);
  assert.deepEqual(entry.zoneBreakdown.map((z) => z.zoneId), ['a', 'b']);
});

test('puerto sin ninguna ONT con zona vinculada: dominantZone null, nunca se inventa un nombre', () => {
  const onts = [{ slot: 2, port: 5 }, { slot: 2, port: 5, zones: null }];
  const [entry] = computePonOccupancy(onts);
  assert.equal(entry.dominantZone, null);
  assert.equal(entry.otherZonesCount, 0);
  assert.deepEqual(entry.zoneBreakdown, []);
});

test('mezcla real: ONTs con y sin zona en el mismo puerto — solo las con zona entran al desglose', () => {
  const zoneA = { id: 'a', name: 'PON 1 - AO' };
  const onts = [{ slot: 2, port: 1, zones: zoneA }, { slot: 2, port: 1, zones: null }, { slot: 2, port: 1 }];
  const [entry] = computePonOccupancy(onts);
  assert.equal(entry.count, 3); // las 3 ONTs cuentan para ocupacion del puerto
  assert.deepEqual(entry.dominantZone, { zoneId: 'a', zoneName: 'PON 1 - AO', count: 1 }); // solo 1 de las 3 trae zona
  assert.equal(entry.otherZonesCount, 0);
});
