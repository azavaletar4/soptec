import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isJobCompletedToday, isJobNotStarted, resolveTechDispatchStatus } from '../technicianDispatchStatus';
import type { UnifiedJob } from '../../composables/useUnifiedJobs';

function job(overrides: Partial<UnifiedJob>): UnifiedJob {
  return {
    id: 'job-1',
    jobType: 'routine',
    number: 'RUT-2026-00071',
    label: 'Jairo Bernabe',
    status: 'scheduled',
    priority: 'medium',
    assignedId: 'tech-1',
    assignedName: 'Jairo Bernabe',
    scheduledStartAt: null,
    fallbackDate: '2026-10-18',
    createdAt: '2026-10-17T19:42:12.343Z',
    finishedAt: null,
    updatedAt: '2026-10-18T17:28:43.806Z',
    raw: {} as UnifiedJob['raw'],
    ...overrides,
  };
}

// ---- Caso real: Jairo Bernabe / RUT-2026-00071 (2026-10-18) — asignar una
// rutina con fecha/turno la deja 'scheduled', nunca 'in_progress'. Antes de
// la correccion, esto se mostraba como "En camino" (como si ya hubiera
// iniciado el desplazamiento); ahora debe ser 'asignado'. ----

test('resolveTechDispatchStatus: rutina recien asignada (scheduled) -> asignado, no en_atencion', () => {
  const r = resolveTechDispatchStatus(false, [job({ jobType: 'routine', status: 'scheduled' })]);
  assert.equal(r.status, 'asignado');
  assert.equal(r.job?.number, 'RUT-2026-00071');
});

test('resolveTechDispatchStatus: alta/rutina pending -> asignado', () => {
  const r = resolveTechDispatchStatus(false, [job({ jobType: 'installation', status: 'pending' })]);
  assert.equal(r.status, 'asignado');
});

test('resolveTechDispatchStatus: ticket open asignado -> asignado', () => {
  const r = resolveTechDispatchStatus(false, [job({ jobType: 'ticket', status: 'open' })]);
  assert.equal(r.status, 'asignado');
});

test('resolveTechDispatchStatus: orden in_progress -> en_atencion, manda sobre cualquier otra asignada', () => {
  const r = resolveTechDispatchStatus(false, [
    job({ id: 'job-2', status: 'scheduled' }),
    job({ id: 'job-3', status: 'in_progress' }),
  ]);
  assert.equal(r.status, 'en_atencion');
  assert.equal(r.job?.id, 'job-3');
});

test('resolveTechDispatchStatus: En Almuerzo manda sobre cualquier orden activa (incluida in_progress)', () => {
  const r = resolveTechDispatchStatus(true, [job({ status: 'in_progress' })]);
  assert.equal(r.status, 'en_almuerzo');
  assert.equal(r.job, null);
});

test('resolveTechDispatchStatus: sin ordenes activas -> disponible', () => {
  const r = resolveTechDispatchStatus(false, []);
  assert.equal(r.status, 'disponible');
  assert.equal(r.job, null);
});

test('resolveTechDispatchStatus: solo ordenes ya finalizadas -> disponible', () => {
  const r = resolveTechDispatchStatus(false, [job({ jobType: 'routine', status: 'completed' })]);
  assert.equal(r.status, 'disponible');
});

test('isJobNotStarted / isJobCompletedToday', () => {
  assert.equal(isJobNotStarted(job({ status: 'scheduled' })), true);
  assert.equal(isJobNotStarted(job({ status: 'in_progress' })), false);
  assert.equal(isJobCompletedToday(job({ jobType: 'routine', status: 'completed' })), true);
  assert.equal(isJobCompletedToday(job({ jobType: 'ticket', status: 'resolved' })), true);
  assert.equal(isJobCompletedToday(job({ jobType: 'ticket', status: 'open' })), false);
});
