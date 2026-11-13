import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';

const file = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const id = '10000000-0000-0000-0000-000000000001', contract = '20000000-0000-0000-0000-000000000001';
const order = '30000000-0000-0000-0000-000000000001', extra = '40000000-0000-0000-0000-000000000001';
const actor = (n: number) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
const session = (sql: string, n = 1) => `set role authenticated;set request.jwt.claim.sub='${actor(n)}';${sql}`;
test('descarte administrativo: SQL real, RLS, permisos, atomicidad y concurrencia; datos sintéticos', { timeout: 90000 }, async t => {
  const name = `unfulfilled-discard-${process.pid}-${Date.now()}`;
  const docker = (args: string[], input?: string) => execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const context = docker(['context', 'inspect']);
  assert.match(context, /npipe:|unix:\/\/|localhost|127\.0\.0\.1/, 'Solo Docker local');
  const args = ['exec', '-i', name, 'psql', '-h', '127.0.0.1', '-X', '-q', '-A', '-t', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'];
  const query = (sql: string) => docker(args, sql).trim();
  const parallel = (sql: string) => new Promise<{ code: number; output: string }>((resolve, reject) => {
    const p = spawn('docker', args, { windowsHide: true }); let output = '';
    p.stdout.on('data', b => output += b); p.stderr.on('data', b => output += b); p.on('error', reject);
    p.on('close', code => resolve({ code: code ?? 1, output })); p.stdin.end(sql);
  });
  const relations = () => query(`select jsonb_build_object('contracts',(select jsonb_agg(to_jsonb(c) order by id) from service_contracts c),'orders',(select jsonb_agg(to_jsonb(i) order by id) from installations i),'history',(select jsonb_agg(to_jsonb(h) order by kind) from preserved_history h));`);
  const state = () => query('select to_jsonb(c) from clients c;');
  const reset = () => query(`truncate installations,service_contracts,clients;insert into clients(id,status,document_number)values('${id}','prospect','SYNTHETIC');insert into service_contracts(id,client_id,status)values('${contract}','${id}','cancelled');insert into installations(id,client_id,contract_id,status)values('${order}','${id}','${contract}','cancelled');`);
  const version = () => query(`select updated_at from clients where id='${id}';`);
  const discard = (v = version(), reason = 'No se concretó', confirm = 'true') => `select public.discard_unfulfilled_client_prospect('${id}','${v}','${reason}',${confirm});`;
  try {
    docker(['run', '--rm', '--pull=never', '-d', '--name', name, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
    let ready = false; for (let i = 0; i < 50; i++) { try { docker(['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); } } assert.ok(ready);
    const fixture = file('./clientRetirement.fixture.sql'), at = fixture.indexOf('create policy clients_staff_only');
    query(fixture.slice(0, at));
    query(`create function public.current_user_role()returns user_role language sql stable security definer set search_path=public as $$select role from profiles where id=auth.uid() and active$$;`);
    query(fixture.slice(at)); query('grant delete on clients to authenticated;'); reset();
    const before = relations(); query(file('../../docs/sql/unfulfilled-prospect-discard-proposal.sql')); assert.equal(relations(), before);
    await t.test('aplicar y rollback sin uso no modifican datos ni RLS; reaplicación protegida', () => {
      const clientsBefore = query(`select to_jsonb(c)-'prospect_discarded_at'-'prospect_discarded_by'-'prospect_discard_reason' from clients c;`);
      assert.throws(() => query(file('../../docs/sql/unfulfilled-prospect-discard-proposal.sql')), /already exists/);
      query(file('../../docs/sql/unfulfilled-prospect-discard-rollback-unused.sql'));
      assert.equal(state(), clientsBefore); assert.equal(relations(), before);
      assert.equal(query(`select count(*) from pg_policies where tablename='clients';`), '1');
      query(file('../../docs/sql/unfulfilled-prospect-discard-proposal.sql'));
    });
    await t.test('ADMIN/SUPERADMIN: motivo, autor y fecha; conserva ficha y relaciones; reintento idempotente', () => {
      for (const n of [1, 2]) {
        reset(); const originalRelations = relations(), v = version();
        const result = JSON.parse(query(session(discard(v), n))); assert.equal(result.alreadyDiscarded, false);
        const saved = JSON.parse(state()); assert.equal(saved.status, 'retired'); assert.equal(saved.prospect_discarded_by, actor(n)); assert.equal(saved.prospect_discard_reason, 'No se concretó'); assert.ok(saved.prospect_discarded_at);
        assert.equal(JSON.parse(query(session(discard(v), n))).alreadyDiscarded, true);
        const exact = state(); query(session(discard(v), n)); assert.equal(state(), exact);
        assert.equal(relations(), originalRelations);
        assert.throws(() => query(session(discard(v, 'Motivo diferente'), n)), /otro motivo/);
      }
    });
    await t.test('confirmación, motivo y versión obligatorios; ninguna escritura parcial', () => {
      for (const sql of [() => discard(version(), 'No se concretó', 'false'), () => discard(version(), ' '), () => discard('2000-01-01T00:00:00Z'), () => `select public.discard_unfulfilled_client_prospect('${id}',null,'No se concretó',true);`]) {
        reset(); const exact = state(), protectedRows = relations(); assert.throws(() => query(session(sql())), /Confirme|cambió/); assert.equal(state(), exact); assert.equal(relations(), protectedRows);
      }
    });
    await t.test('roles no administrativos, inactivo, sin JWT, anon y service_role denegados', () => {
      for (const n of [3, 4, 5, 6, 7]) { reset(); const exact = state(); assert.throws(() => query(session(discard(), n)), /ADMIN\/SUPERADMIN/); assert.equal(state(), exact); }
      reset(); assert.throws(() => query(`set role authenticated;${discard()}`), /ADMIN\/SUPERADMIN/);
      for (const role of ['anon', 'service_role']) assert.throws(() => query(`set role ${role};${discard()}`), /permission denied/);
    });
    await t.test('API directa y GUC falsificado no permiten fabricar trazabilidad, ni crear descartados', () => {
      reset(); const exact = state();
      for (const n of [1, 3, 5, 6]) {
        assert.throws(() => query(session(`set app.unfulfilled_prospect_discard_id='${id}';update clients set status='retired',prospect_discarded_at=now(),prospect_discarded_by='${actor(n)}',prospect_discard_reason='Falsificado' where id='${id}';`, n)), /operación administrativa/);
        assert.throws(() => query(session(`insert into clients(id,status,prospect_discarded_at,prospect_discarded_by,prospect_discard_reason)values('${extra}','retired',now(),'${actor(n)}','Falsificado');`, n)), /operación administrativa/);
      }
      assert.equal(state(), exact);
    });
    await t.test('bloquea contratos vigentes y cualquier Alta abierta o completada', () => {
      for (const status of ['active', 'suspended']) { reset(); query(`update service_contracts set status='${status}';`); const exact = state(), rows = relations(); assert.throws(() => query(session(discard())), /Solo contrataciones/); assert.equal(state(), exact); assert.equal(relations(), rows); }
      for (const status of ['pending', 'scheduled', 'in_progress', 'completed']) { reset(); query(`update installations set status='${status}';`); const exact = state(), rows = relations(); assert.throws(() => query(session(discard())), /Solo contrataciones/); assert.equal(state(), exact); assert.equal(relations(), rows); }
      reset(); query('delete from installations;delete from service_contracts;'); assert.throws(() => query(session(discard())), /Solo contrataciones/);
    });
    await t.test('falla al actualizar ficha revierte toda la acción', () => {
      reset(); query(`create function force_discard_failure()returns trigger language plpgsql as $$begin raise exception 'injected failure';end$$;create trigger zz_force_discard_failure before update on clients for each row execute function force_discard_failure();`);
      const exact = state(), rows = relations(); assert.throws(() => query(session(discard())), /injected failure/); assert.equal(state(), exact); assert.equal(relations(), rows); query('drop trigger zz_force_discard_failure on clients;drop function force_discard_failure();');
    });
    await t.test('conserva trazabilidad, bloquea borrado/reactivación; contacto sigue editable', () => {
      reset(); query(session(discard()));
      for (const sql of [`delete from clients where id='${id}';`, `update clients set status='prospect' where id='${id}';`, `update clients set prospect_discard_reason='Otro motivo' where id='${id}';`]) assert.throws(() => query(session(sql)), /histórica|trazabilidad/);
      query(session(`update clients set first_name='Contacto corregido' where id='${id}';`, 3)); assert.equal(JSON.parse(state()).first_name, 'Contacto corregido');
      assert.throws(() => query(session(`update service_contracts set status='active';`)), /descartada/);
      assert.throws(() => query(session(`insert into service_contracts(id,client_id,status)values('${extra}','${id}','active');`)), /descartada/);
      assert.throws(() => query(session(`update installations set status='pending';`)), /descartada/);
    });
    await t.test('dos descartes concurrentes generan una única marca y no duplican fichas', async () => {
      reset(); const sql = discard(); const outcomes = await Promise.all([parallel(session(sql)), parallel(session(sql))]);
      assert.equal(outcomes.filter(o => o.code === 0).length, 2, JSON.stringify(outcomes)); assert.equal(query('select count(*) from clients;'), '1');
      assert.equal(outcomes.filter(o => o.output.includes('"alreadyDiscarded": false')).length, 1);
    });
    await t.test('contrato/Alta concurrente no deja descartado con relaciones vigentes', async () => {
      for (const sql of [`insert into service_contracts(id,client_id,status)values('${extra}','${id}','active');`, `insert into installations(id,client_id,contract_id,status)values('${extra}','${id}','${contract}','pending');`, 'update service_contracts set status=\'active\';', 'update installations set status=\'in_progress\';']) {
        reset(); const command = discard();
        const outcomes = await Promise.all([parallel(session(`begin;select 1 from clients where id='${id}' for update;select pg_sleep(0.1);${command}commit;`)), parallel(session(sql))]);
        assert.equal(outcomes.filter(o => o.code === 0).length, 1, JSON.stringify(outcomes));
        assert.equal(query(`select count(*) from clients c where prospect_discarded_at is not null and (exists(select 1 from service_contracts s where s.client_id=c.id and status<>'cancelled') or exists(select 1 from installations i where i.client_id=c.id and status<>'cancelled'));`), '0');
      }
    });
    await t.test('conversión de otra ficha no descartada conserva creación y activación normales', () => {
      reset();query(session(`insert into clients(id,status,document_number)values('${extra}','prospect','SYNTHETIC-CONVERSION');insert into service_contracts(id,client_id,status)values('${extra}','${extra}','active');insert into installations(id,client_id,contract_id,status)values('${extra}','${extra}','${extra}','pending');update installations set status='in_progress' where id='${extra}';`));
      assert.equal(query(`select status from service_contracts where id='${extra}';`),'active');
      assert.equal(query(`select status from installations where id='${extra}';`),'in_progress');
    });
    await t.test('rollback tras uso no borra auditoría; deshabilitar RPC conserva evidencia', () => {
      reset(); query(session(discard())); const exact = state(), rows = relations();
      assert.throws(() => query(file('../../docs/sql/unfulfilled-prospect-discard-rollback-unused.sql')), /Rollback bloqueado/); assert.equal(state(), exact); assert.equal(relations(), rows);
      query(file('../../docs/sql/unfulfilled-prospect-discard-disable-used.sql')); assert.throws(() => query(session(discard())), /permission denied/); assert.equal(state(), exact);
    });
  } finally { try { docker(['stop', name]); } catch { /* Solo contenedor sintético efímero de este test. */ } }
});
