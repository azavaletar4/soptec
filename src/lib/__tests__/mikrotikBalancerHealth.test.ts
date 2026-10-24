import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMemoryBytes, formatRouterUptime, summarizeMemoryUsage, summarizeWanConnectionCounts } from '../mikrotikBalancerHealth';

test('formatMemoryBytes: MB por debajo de 1GB, GB con 2 decimales por encima, nunca negativo/invalido', () => {
  assert.equal(formatMemoryBytes(536_870_912), '512 MB'); // 512 MB exactos
  assert.equal(formatMemoryBytes(2_147_483_648), '2.00 GB'); // 2 GB exactos
  assert.equal(formatMemoryBytes(1_610_612_736), '1.50 GB'); // 1.5 GB
  assert.equal(formatMemoryBytes(null), '—');
  assert.equal(formatMemoryBytes(undefined), '—');
  assert.equal(formatMemoryBytes(-1), '—');
});

test('summarizeMemoryUsage: usada = total - libre, con % redondeado', () => {
  const r = summarizeMemoryUsage(268_435_456 /* 256MB libre */, 1_073_741_824 /* 1GB total */);
  assert.equal(r.usedLabel, '768 MB');
  assert.equal(r.totalLabel, '1.00 GB');
  assert.equal(r.freeLabel, '256 MB');
  assert.equal(r.usedPercent, 75);
});

test('summarizeMemoryUsage: datos faltantes/invalidos -- nunca inventa un numero', () => {
  const r = summarizeMemoryUsage(null, null);
  assert.deepEqual(r, { usedLabel: '—', totalLabel: '—', freeLabel: '—', usedPercent: null });
  const r2 = summarizeMemoryUsage(100, 0);
  assert.equal(r2.usedPercent, null);
});

test('formatRouterUptime: dias/horas/minutos legibles, semanas plegadas a dias, segundos ignorados', () => {
  assert.equal(formatRouterUptime('4w3d12h5m33s'), '31 días, 12 h, 5 min');
  assert.equal(formatRouterUptime('1d12h'), '1 día, 12 h');
  assert.equal(formatRouterUptime('33m14s'), '33 min');
  assert.equal(formatRouterUptime('10s'), '0 min');
});

test('formatRouterUptime: valores vacios/formato inesperado -- nunca inventa', () => {
  assert.equal(formatRouterUptime(null), '—');
  assert.equal(formatRouterUptime(undefined), '—');
  assert.equal(formatRouterUptime(''), '—');
  assert.equal(formatRouterUptime('formato-raro'), 'formato-raro');
});

test('summarizeWanConnectionCounts: separa conectada/caida/deshabilitada con datos frescos', () => {
  const conns = [
    { disabled: false, running: true },
    { disabled: false, running: true },
    { disabled: false, running: false },
    { disabled: true, running: false },
  ];
  assert.deepEqual(summarizeWanConnectionCounts(conns, false), { up: 2, down: 1, disabled: 1, unknown: 0 });
});

test('summarizeWanConnectionCounts: con datos obsoletos, nunca declara "caida" -- las no deshabilitadas pasan a "desconocida"', () => {
  const conns = [
    { disabled: false, running: true },
    { disabled: false, running: false },
    { disabled: true, running: false },
  ];
  // Las lineas 055-060 deshabilitadas intencionalmente siguen contando como
  // "disabled" aun con datos obsoletos -- esa configuracion ya se conocia.
  assert.deepEqual(summarizeWanConnectionCounts(conns, true), { up: 0, down: 0, disabled: 1, unknown: 2 });
});
