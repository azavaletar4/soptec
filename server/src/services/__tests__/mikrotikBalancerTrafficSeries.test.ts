import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketTicks, sumSamplesByTick, type RawSample } from '../../mikrotik/balancerTrafficSeries';

function sample(sampledAt: string, rxBps: number, txBps: number, online = true): RawSample {
  return { sampledAt, rxBps, txBps, online };
}

test('sumSamplesByTick: suma los bps de varias conexiones EN EL MISMO INSTANTE REAL, nunca mezcla instantes distintos', () => {
  const connA = [sample('2026-10-24T20:00:00.000Z', 10_000_000, 1_000_000), sample('2026-10-24T20:01:00.000Z', 12_000_000, 1_200_000)];
  const connB = [sample('2026-10-24T20:00:00.000Z', 20_000_000, 2_000_000), sample('2026-10-24T20:01:00.000Z', 24_000_000, 2_400_000)];
  const totals = sumSamplesByTick([connA, connB]);
  assert.equal(totals.length, 2);
  assert.deepEqual(totals[0], { sampledAt: '2026-10-24T20:00:00.000Z', rxBps: 30_000_000, txBps: 3_000_000, online: true });
  assert.deepEqual(totals[1], { sampledAt: '2026-10-24T20:01:00.000Z', rxBps: 36_000_000, txBps: 3_600_000, online: true });
});

test('sumSamplesByTick: un instante parcial (falta una conexion) nunca se descarta, pero se marca no confiable', () => {
  const connA = [sample('2026-10-24T20:00:00.000Z', 10_000_000, 1_000_000)];
  const connB: RawSample[] = []; // esta conexion no tuvo muestra en ese instante (ej. error puntual del router)
  const totals = sumSamplesByTick([connA, connB]);
  assert.equal(totals.length, 1);
  assert.equal(totals[0].online, false); // parcial: no todas las conexiones del alcance aportaron
});

test('sumSamplesByTick: una conexion offline ese instante no suma su bps (evita inflar el total con un dato invalido)', () => {
  const connA = [sample('2026-10-24T20:00:00.000Z', 10_000_000, 1_000_000, true)];
  const connB = [sample('2026-10-24T20:00:00.000Z', 999_000_000, 999_000_000, false)]; // offline: no se cuenta su valor
  const totals = sumSamplesByTick([connA, connB]);
  assert.equal(totals[0].rxBps, 10_000_000);
  assert.equal(totals[0].online, false); // sigue siendo parcial porque una conexion reporto offline
});

test('sumSamplesByTick: una sola conexion (vista individual) es identidad -- nunca altera sus valores', () => {
  const connA = [sample('2026-10-24T20:00:00.000Z', 10_000_000, 1_000_000)];
  const totals = sumSamplesByTick([connA]);
  assert.deepEqual(totals[0], { sampledAt: '2026-10-24T20:00:00.000Z', rxBps: 10_000_000, txBps: 1_000_000, online: true });
});

test('bucketTicks: agrupa por bucket de tiempo con avg/max/samples, igual forma que fn_mikrotik_interface_series', () => {
  const ticks = [
    { sampledAt: '2026-10-24T20:00:00.000Z', rxBps: 10_000_000, txBps: 1_000_000, online: true },
    { sampledAt: '2026-10-24T20:01:00.000Z', rxBps: 20_000_000, txBps: 2_000_000, online: true },
    { sampledAt: '2026-10-24T20:05:30.000Z', rxBps: 30_000_000, txBps: 3_000_000, online: true },
  ];
  const buckets = bucketTicks(ticks, 300); // buckets de 5 minutos
  assert.equal(buckets.length, 2);
  assert.equal(buckets[0].avg_rx_bps, 15_000_000); // promedio de los 2 primeros ticks
  assert.equal(buckets[0].max_rx_bps, 20_000_000);
  assert.equal(buckets[0].samples, 2);
  assert.equal(buckets[1].avg_rx_bps, 30_000_000);
});

test('bucketTicks: un tick offline no se promedia (pero cuenta en "samples" vs "online_samples")', () => {
  const ticks = [
    { sampledAt: '2026-10-24T20:00:00.000Z', rxBps: 10_000_000, txBps: 1_000_000, online: true },
    { sampledAt: '2026-10-24T20:00:30.000Z', rxBps: 999_000_000, txBps: 999_000_000, online: false },
  ];
  const buckets = bucketTicks(ticks, 60);
  assert.equal(buckets[0].samples, 2);
  assert.equal(buckets[0].online_samples, 1);
  assert.equal(buckets[0].avg_rx_bps, 10_000_000); // el offline nunca contamina el promedio
});

test('bucketTicks: sin muestras -- nunca inventa un punto (lista vacia, no un punto en cero)', () => {
  assert.deepEqual(bucketTicks([], 60), []);
});
