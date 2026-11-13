import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDashboardSupport, type DashboardJob } from '../dashboardSupport';
import { countPendingInstallationClients } from '../dashboardClients';
import { canDiscardUnfulfilledProspect } from '../unfulfilledProspect';
import { ACTIVE_STATUS } from '../jobStatus';
import type { ClientLifecycle } from '../clientLifecycle';

const job = (jobType: DashboardJob['jobType'], status: string, id = status, priority = 'medium'): DashboardJob =>
  ({ id, jobType, status, priority, number: null, title: 'Sintético', created_at: '2026-11-12T12:00:00Z', clients: null });
test('Soporte usa todos los estados operativos de avería, rutina y Alta', () => {
  const rows = Object.entries(ACTIVE_STATUS).flatMap(([kind, statuses]) => statuses.map(status => job(kind as DashboardJob['jobType'], status)));
  const summary = summarizeDashboardSupport(rows);
  assert.equal(summary.open, 6);
  assert.equal(summary.inProgress, 3);
  assert.equal(summary.urgent, 0);
});
test('cerrados/resueltos/completados/cancelados no cuentan, ni como urgentes', () => {
  const rows = (['ticket', 'routine', 'installation'] as const).flatMap(kind =>
    ['resolved', 'closed', 'completed', 'cancelled'].map(status => job(kind, status, status, 'urgent')));
  assert.deepEqual(summarizeDashboardSupport(rows), { open: 0, inProgress: 0, urgent: 0, pendingByType: { ticket: 0, routine: 0, installation: 0 }, recent: [] });
});
test('deduplica por tipo e ID; urgentes son subconjunto, no un tercer estado', () => {
  const rows = [job('ticket', 'open', 'same', 'urgent'), job('routine', 'in_progress', 'same', 'urgent'), job('ticket', 'open', 'same', 'urgent')];
  const summary = summarizeDashboardSupport(rows);
  assert.equal(summary.open, 1); assert.equal(summary.inProgress, 1); assert.equal(summary.urgent, 2); assert.equal(summary.recent.length, 2);
});
test('caso leído: una avería, diez rutinas, un Alta pendientes; recientes limitados', () => {
  const rows = [job('ticket', 'open'), ...Array.from({ length: 10 }, (_, i) => job('routine', 'scheduled', String(i))), job('installation', 'scheduled')];
  const summary = summarizeDashboardSupport(rows);
  assert.equal(summary.open, 12); assert.equal(summary.inProgress, 0); assert.equal(summary.urgent, 0); assert.equal(summary.recent.length, 5);
  assert.deepEqual(summary.pendingByType, { ticket: 1, routine: 10, installation: 1 });
});
const client = (id: string, installs: string[], contracts: string[] = ['cancelled'], status = 'prospect') => ({
  id, status, installations: installs.map(status => ({ status })), service_contracts: contracts.map(status => ({ status })),
}) as ClientLifecycle & { id: string };
test('prospectos vigentes = sección Pendientes de instalación; no CRM ni cancelados', () => {
  const pending = client('pending', ['scheduled']);
  const cancelled = Array.from({ length: 4 }, (_, i) => client('cancelled' + i, ['cancelled'], ['cancelled'], i === 0 ? 'retired' : 'prospect'));
  assert.equal(countPendingInstallationClients([pending, pending, ...cancelled, client('active', [], ['active'], 'active')]), 1);
  for (const status of ['pending', 'scheduled', 'in_progress']) assert.equal(countPendingInstallationClients([client(status, [status])]), 1);
});
test('descarte solo para nunca instalados, conserva histórico y no habilita clientes vigentes', () => {
  const candidate = client('cancelled', ['cancelled']);
  assert.equal(canDiscardUnfulfilledProspect(candidate), true);
  assert.equal(canDiscardUnfulfilledProspect({ ...candidate, prospect_discarded_at: '2026-11-12T12:00:00Z' }), false);
  for (const row of [client('pending', ['scheduled']), client('completed', ['completed']), client('active', ['cancelled'], ['active']), client('orphan', [], [])])
    assert.equal(canDiscardUnfulfilledProspect(row), false);
  assert.equal(countPendingInstallationClients([{ ...candidate, status: 'retired' }]), 0);
});
