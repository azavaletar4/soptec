import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBpsAsMbps, splitMbpsForDisplay, toMbps, usageBarClass, usagePercent, usageTextClass } from '../mikrotikBorderTraffic';

test('toMbps: convierte Gbps a Mbps, deja Mbps intacto', () => {
  assert.equal(toMbps(500, 'Mbps'), 500);
  assert.equal(toMbps(1, 'Gbps'), 1000);
  assert.equal(toMbps(1.5, 'Gbps'), 1500);
});

test('splitMbpsForDisplay: elige la unidad mas legible', () => {
  assert.deepEqual(splitMbpsForDisplay(500), { value: 500, unit: 'Mbps' });
  assert.deepEqual(splitMbpsForDisplay(1000), { value: 1, unit: 'Gbps' });
  assert.deepEqual(splitMbpsForDisplay(1500), { value: 1.5, unit: 'Gbps' });
});

test('formatBpsAsMbps: formatea en Mbps o Gbps segun magnitud, nunca negativo/NaN', () => {
  assert.equal(formatBpsAsMbps(0), '0 Mbps');
  assert.equal(formatBpsAsMbps(null), '0 Mbps');
  assert.equal(formatBpsAsMbps(undefined), '0 Mbps');
  assert.equal(formatBpsAsMbps(5_000_000), '5.00 Mbps');
  assert.equal(formatBpsAsMbps(450_000_000), '450.0 Mbps');
  assert.equal(formatBpsAsMbps(1_200_000_000), '1.20 Gbps');
});

test('usagePercent: calcula % contra la capacidad configurada, acotado y sin division por cero', () => {
  assert.equal(usagePercent(250_000_000, 500), 50);
  assert.equal(usagePercent(500_000_000, 500), 100);
  assert.equal(usagePercent(600_000_000, 500), 120);
  assert.equal(usagePercent(null, 500), 0);
  assert.equal(usagePercent(100, 0), 0);
  assert.equal(usagePercent(999_999_000_000, 500), 999); // acotado, nunca explota la barra
});

test('usageBarClass/usageTextClass: verde <85%, amarillo 85-99%, rojo >=100%', () => {
  assert.equal(usageBarClass(50), 'bg-emerald-500');
  assert.equal(usageBarClass(90), 'bg-amber-500');
  assert.equal(usageBarClass(100), 'bg-red-500');
  assert.equal(usageTextClass(50), 'text-emerald-600');
  assert.equal(usageTextClass(90), 'text-amber-600');
  assert.equal(usageTextClass(100), 'text-red-600');
});
