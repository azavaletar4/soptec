import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const sqlFile = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const ticket = '10000000-0000-0000-0000-000000000001';
const installation = '20000000-0000-0000-0000-000000000001';
const routine = '30000000-0000-0000-0000-000000000001';

test('PostgreSQL isolated: el backend decide pending/approved de work_order_photos, nunca el valor que manda el navegador', { timeout: 60000 }, async t => {
  const container = `smartrayco-fase141-test-${process.pid}-${Date.now()}`;
  const docker = (args: string[], input?: string) =>
    execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const psqlArgs = ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'];
  const query = (sql: string) => docker(psqlArgs, sql).trim();

  // El "status" enviado siempre miente (lo contrario de lo correcto) para
  // probar que el trigger lo IGNORA y recalcula el valor real.
  const insert = (jobType: string, jobId: string, category: string, lyingStatus: string) =>
    query(`insert into public.work_order_photos (job_type, job_id, category, storage_path, status)
           values ('${jobType}', '${jobId}', '${category}', 'x/y.jpg', '${lyingStatus}')
           returning status;`);

  try {
    docker(['run', '--rm', '-d', '--name', container, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); ready = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(ready, 'isolated Postgres must start');
    query(sqlFile('./workOrderPhotoApprovalSchema.sql'));
    query(sqlFile('../../supabase/migrations/20261010180000_fase141_aprobacion_fotos_backend.sql'));

    await t.test('instalacion: siempre approved, aunque el navegador mande pending_approval', () => {
      assert.equal(insert('installation', installation, 'facade', 'pending_approval'), 'approved');
    });

    await t.test('averia: categoria de censo queda pending_approval, aunque el navegador mande approved', () => {
      assert.equal(insert('ticket', ticket, 'facade', 'approved'), 'pending_approval');
      assert.equal(insert('ticket', ticket, 'nap_box', 'approved'), 'pending_approval');
    });

    await t.test('averia: evidencia_1/evidencia_2 (acta de cierre) quedan approved, no pending', () => {
      assert.equal(insert('ticket', ticket, 'evidencia_1', 'pending_approval'), 'approved');
      assert.equal(insert('ticket', ticket, 'evidencia_2', 'pending_approval'), 'approved');
    });

    await t.test('rutina: approved (sin censo fotografico hoy, se preserva el comportamiento real)', () => {
      assert.equal(insert('routine', routine, 'evidencia_1', 'pending_approval'), 'approved');
    });

    await t.test('mentir el job_type no evade la aprobacion: job_id de un ticket como installation falla', () => {
      assert.throws(() => insert('installation', ticket, 'facade', 'pending_approval'), /no existe/);
    });

    await t.test('job_type invalido se rechaza', () => {
      assert.throws(() => insert('bogus', installation, 'facade', 'approved'), /job_type inválido|violates check constraint/);
    });
  } finally {
    try { docker(['stop', container]); } catch { /* Already removed after a startup failure. */ }
  }
});
