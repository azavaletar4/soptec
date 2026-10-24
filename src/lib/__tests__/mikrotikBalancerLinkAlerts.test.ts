import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatWanLinkAlertDuration, wanLinkAlertBadgeClass, wanLinkAlertLabel } from '../mikrotikBalancerLinkAlerts';

test('wanLinkAlertLabel: mensajes claros por tipo de enlace y estado', () => {
  assert.equal(wanLinkAlertLabel('pppoe_connection', 'active'), 'Se perdió la conexión del proveedor');
  assert.equal(wanLinkAlertLabel('pppoe_connection', 'resolved'), 'Conexión recuperada');
  assert.equal(wanLinkAlertLabel('physical_port', 'active'), 'Puerto SFP sin enlace');
  assert.equal(wanLinkAlertLabel('physical_port', 'resolved'), 'Puerto SFP recuperado');
});

test('wanLinkAlertBadgeClass: activa en rojo, resuelta en verde', () => {
  assert.equal(wanLinkAlertBadgeClass('active'), 'bg-red-500/15 text-red-600');
  assert.equal(wanLinkAlertBadgeClass('resolved'), 'bg-emerald-500/15 text-emerald-600');
});

test('formatWanLinkAlertDuration: alerta resuelta -- duracion fija entre inicio y resolucion', () => {
  const start = '2026-10-24T20:00:00.000Z';
  const end = '2026-10-24T22:30:00.000Z'; // 2h30min despues
  assert.equal(formatWanLinkAlertDuration(start, end, Date.now()), '2 h, 30 min');
});

test('formatWanLinkAlertDuration: alerta todavia activa -- duracion "en curso" hasta nowMs', () => {
  const start = '2026-10-24T20:00:00.000Z';
  const now = Date.parse('2026-10-25T21:05:00.000Z'); // 1 dia, 1h, 5min despues
  assert.equal(formatWanLinkAlertDuration(start, null, now), '1 día, 1 h, 5 min');
});

test('formatWanLinkAlertDuration: menos de un minuto -- "0 min", nunca negativo', () => {
  const start = '2026-10-24T20:00:00.000Z';
  assert.equal(formatWanLinkAlertDuration(start, null, Date.parse('2026-10-24T20:00:10.000Z')), '0 min');
});
