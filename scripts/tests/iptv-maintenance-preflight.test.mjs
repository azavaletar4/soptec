// Verifica la evidencia de lectura y la integridad del candidato. No accede
// a la red ni escribe en el servidor. PASS no autoriza publicar ni prueba celulares.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const evidence = JSON.parse(readFileSync(new URL('../../docs/ALTAS-IPTV-MANTENIMIENTO-LECTURA-20261111.json', import.meta.url), 'utf8'));
const reviewedCommit = process.env.IPTV_REVIEWED_COMMIT ?? '8086fba';
assert.match(reviewedCommit, /^[a-f0-9]{7,40}$/, 'Identifica el commit candidato revisado');
test('fotografía tomada en READ ONLY; no afirma acceso al almacenamiento móvil', () => {
  assert.equal(evidence.readOnly, 'on');
  assert.equal(evidence.snapshotOnly, true); assert.equal(evidence.mobileStorageVisible, false);
  assert.ok(Number.isFinite(Date.parse(evidence.checkedAt)));
});
test('sin ejecución ni recibos incompletos en la muestra, sin interpretar órdenes programadas como ejecución', () => {
  assert.equal(evidence.inProgressCount, 0);
  assert.equal(evidence.incompleteReceiptCount, 0);
  assert.equal(evidence.activeFieldStatements, 0); assert.equal(evidence.waitingFieldLocks, 0);
  assert.equal(evidence.openFieldTransactions, 0); assert.equal(evidence.fieldWriteOrRowLocks, 0);
  assert.deepEqual(evidence.inProgressSample, []); assert.deepEqual(evidence.incompleteReceiptSample, []);
  assert.equal(evidence.pendingMaterialRejections.onOpenOrders, 0);
  assert.equal(evidence.pendingMaterialRejections.onClosedOrMissingOrders, 0);
  assert.equal(evidence.openOrderCount, evidence.orderCounts.filter(x => ['open','pending','scheduled','in_progress','rescheduled'].includes(x.status)).reduce((sum, x) => sum+x.count,0));
});
test('sesiones huérfanas y aprobaciones históricas quedan visibles; no se borran para fabricar un cero', () => {
  assert.equal(evidence.openWorkSessionCount, evidence.openWorkSessionSample.length);
  assert.ok(evidence.openWorkSessionSample.every(s => s.status === null));
  assert.ok(evidence.pendingFieldUnitDetails.every(u => u.status === 'pending_approval' && u.ticket_status === 'resolved'));
});
test('SQL no aplicado y cuerpo de cierre coincide con el prerrequisito revisado', () => {
  assert.equal(evidence.iptvColumnsPresent, false);
  assert.equal(evidence.completionBodyMd5, 'e452ec213962f70d8db289ac17ed361f');
});
test('aplicación, Flutter, migración y rollback conservan el código del commit revisado', () => {
  const changed = execFileSync('git', ['diff','--name-only',reviewedCommit,'--','src','mobile_app','supabase/migrations','scripts/rollback-installation-iptv-mode.sql'], { encoding: 'utf8', windowsHide: true });
  assert.equal(changed.trim(), '');
});
