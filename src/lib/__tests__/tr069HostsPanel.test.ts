import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHostsPanelController, emptyHostsPanelState } from '../tr069HostsPanel';
import type { HostsReadResult } from '../tr069Hosts';

const serial = 'HWTC1D3691B7';
const sample = (): HostsReadResult => ({ state: 'completed', requestedAt: '2026-10-28T22:03:00Z', checkedAt: '2026-10-28T22:04:00Z', message: 'Recibida',
  inventory: { found: true, deviceId: 'exact-id', serial, lastInform: '2026-10-28T22:04:00Z', hostsReportedAt: null, hosts: [] } });

test('crear panel, renders o refrescar con Hosts cerrado no consulta; apertura explícita una vez, cerrar sin consulta', async () => {
  const state = emptyHostsPanelState(); let calls = 0;
  const panel = createHostsPanelController(state, async () => { calls++; return sample(); });
  assert.equal(calls, 0);
  await panel.refresh('id', serial, true); assert.equal(calls, 0);
  for (let i = 0; i < 5; i++) { assert.equal(state.opened.id, undefined); }
  await panel.toggle('id', serial, true); assert.equal(calls, 1);
  await panel.toggle('id', serial, true); assert.equal(calls, 1);
  await panel.refresh('id', serial, true); assert.equal(calls, 1);
  await panel.toggle('id', serial, true); assert.equal(calls, 2, 'Otra apertura explícita sí solicita lectura');
});

test('actualización manual solicita otra lectura; callback solo recibe modo activo cuando el rol lo permite', async () => {
  const state = emptyHostsPanelState(), calls: boolean[] = [];
  const panel = createHostsPanelController(state, async (_, active) => { calls.push(active); return sample(); });
  await panel.toggle('admin', serial, true); await panel.refresh('admin', serial, true);
  await panel.toggle('support', serial, false); await panel.refresh('support', serial, false);
  assert.deepEqual(calls, [true, true, false, false]);
});

test('respuestas pendientes, cierre/apertura rápida y seriales equivalentes no duplican la solicitud en vuelo', async () => {
  const state = emptyHostsPanelState(); let calls = 0, release!: (r: HostsReadResult) => void;
  const wait = new Promise<HostsReadResult>(resolve => { release = resolve; });
  const panel = createHostsPanelController(state, async () => { calls++; return wait; });
  const a = panel.toggle('id', serial, true);
  const b = panel.refresh('id', '485754431D3691B7', true);
  panel.close('id');
  const c = panel.toggle('id', serial, true);
  await Promise.resolve(); assert.equal(calls, 1); assert.equal(state.loading.id, true);
  release({ ...sample(), state: 'pending', message: 'Esperando al equipo' });
  await Promise.all([a, b, c]); assert.equal(state.loading.id, false); assert.equal(calls, 1);
  assert.equal(state.result.id!.state, 'pending');
});

test('fallo o timeout conserva datos, informa error y no dispara ningún reintento ni otra ONT', async () => {
  const state = emptyHostsPanelState(); let calls = 0;
  const panel = createHostsPanelController(state, async () => { calls++; if (calls > 1) throw new Error('timeout'); return sample(); });
  await panel.toggle('id', serial, true); const previous = state.inventory.id;
  await panel.refresh('id', serial, true);
  assert.equal(state.inventory.id, previous); assert.ok(state.errors.id); assert.equal(state.loading.id, false);
  await Promise.resolve(); assert.equal(calls, 2); assert.equal(state.inventory.other, undefined);
});
