import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const sqlFile = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const c1 = '20000000-0000-0000-0000-000000000001', c2 = '20000000-0000-0000-0000-000000000002';
const client1 = '10000000-0000-0000-0000-000000000001', client2 = '10000000-0000-0000-0000-000000000002';
const old = '30000000-0000-0000-0000-000000000001', dest = '30000000-0000-0000-0000-000000000002', other = '30000000-0000-0000-0000-000000000003';
const admin = '00000000-0000-0000-0000-000000000001';
const call = (nap = dest, contract = c1, client = client1) => `select public.assign_contract_nap('${nap}','${contract}','${client}');`;
const asUser = (sql: string, user = admin) => `set role authenticated; set request.jwt.claim.sub='${user}'; ${sql}`;

test('PostgreSQL isolated: atomic NAP assignment, permissions, rollback and concurrent connections', { timeout: 60000 }, async t => {
  const container = `smartrayco-fase2-test-${process.pid}-${Date.now()}`;
  const docker = (args: string[], input?: string) => execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe','pipe','pipe'] });
  const psqlArgs = ['exec','-i',container,'psql','-h','127.0.0.1','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres'];
  const query = (sql: string) => docker(psqlArgs, sql).trim();
  const queryAsync = (sql: string) => new Promise<{ code: number; output: string }>((resolve, reject) => {
    const child = spawn('docker', psqlArgs, { windowsHide: true }); let output = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject); child.on('close', code => resolve({ code: code ?? 1, output })); child.stdin.end(sql);
  });
  const reset = () => query(`truncate public.fo_nap_puertos;
    insert into public.fo_nap_puertos(infra_elemento_id,puerto_numero,estado,client_id,contract_id) values
    ('${old}',1,'ocupado','${client1}','${c1}'),('${old}',2,'ocupado','${client2}','${c2}');`);
  const snapshot = () => query('select coalesce(jsonb_agg(to_jsonb(p) order by id),\'[]\') from public.fo_nap_puertos p;');
  try {
    docker(['run','--rm','-d','--name',container,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      // The temporary init server only listens on a socket. TCP confirms the final server.
      try { docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(ready, 'isolated Postgres must start');
    query(sqlFile('./napSchema.sql'));
    // The role function is taken from the project's actual migration, including inactive-account behavior.
    const roleSql = sqlFile('../../supabase/migrations/20260919020000_fase13_gestion_usuarios.sql')
      .match(/create or replace function public\.current_user_role\(\)[\s\S]*?\$\$;/)![0];
    query(roleSql);
    query(sqlFile('../../supabase/migrations/20261009120000_fase136c_provisioning_nap.sql'));
    query(sqlFile('../../supabase/migrations/20261009130000_fase136d_nap_authenticated_assignment.sql'));

    await t.test('full destination keeps previous assignment byte-for-byte', () => {
      reset(); query(`insert into public.fo_nap_puertos(infra_elemento_id,puerto_numero,estado) values ('${dest}',1,'reservado');`);
      const before = snapshot(); assert.throws(() => query(asUser(call())), /llena/); assert.equal(snapshot(), before);
    });
    await t.test('reservation insert failure rolls back without releasing old port', () => {
      reset(); query(`create function public.fail_destination() returns trigger language plpgsql as $$ begin raise exception 'forced reservation failure'; end $$;
        create trigger fail_destination before insert on public.fo_nap_puertos for each row execute function public.fail_destination();`);
      const before = snapshot(); assert.throws(() => query(asUser(call())), /forced reservation failure/); assert.equal(snapshot(), before);
      query('drop trigger fail_destination on public.fo_nap_puertos; drop function public.fail_destination();');
    });
    await t.test('failure releasing old port also rolls back destination reservation', () => {
      reset(); query(`create function public.fail_release() returns trigger language plpgsql as $$ begin if new.estado='libre' then raise exception 'forced release failure'; end if; return new; end $$;
        create trigger fail_release before update on public.fo_nap_puertos for each row execute function public.fail_release();`);
      const before = snapshot(); assert.throws(() => query(asUser(call())), /forced release failure/); assert.equal(snapshot(), before);
      query('drop trigger fail_release on public.fo_nap_puertos; drop function public.fail_release();');
    });
    await t.test('successful move and replay release only this contract, retain other client, and reuse port', () => {
      reset(); const port = query(asUser(call())); const again = query(asUser(call())); assert.equal(port, again);
      assert.equal(query(`select estado from public.fo_nap_puertos where infra_elemento_id='${old}' and puerto_numero=1;`),'libre');
      assert.equal(query(`select contract_id from public.fo_nap_puertos where infra_elemento_id='${old}' and puerto_numero=2;`),c2);
      assert.equal(query(`select count(*) from public.fo_nap_puertos where contract_id='${c1}';`),'1');
    });
    await t.test('invalid NAP and wrong contract/client conserve every assignment', () => {
      reset(); const before = snapshot();
      assert.throws(() => query(asUser(call(dest, c1, client2))), /no coinciden/);
      assert.throws(() => query(asUser(call('30000000-0000-0000-0000-000000000099'))), /invalida/);
      assert.equal(snapshot(),before);
    });
    await t.test('reserved and damaged ports are skipped', () => {
      reset(); query(`insert into public.fo_nap_puertos(infra_elemento_id,puerto_numero,estado) values ('${other}',1,'reservado'),('${other}',2,'dañado');`);
      query(asUser(call(other))); assert.equal(query(`select puerto_numero from public.fo_nap_puertos where infra_elemento_id='${other}' and contract_id='${c1}';`),'3');
    });
    await t.test('client, inactive admin and anonymous cannot assign; technician can', () => {
      reset(); const before = snapshot();
      for (const user of ['00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004']) assert.throws(() => query(asUser(call(),user)), /permisos/);
      assert.throws(() => query('set role anon; '+call()), /permission denied/);
      assert.throws(() => query(asUser(`select public.assign_provisioning_nap('${dest}','${c1}','${client1}');`)), /permission denied/);
      assert.equal(snapshot(),before); query(asUser(call(),'00000000-0000-0000-0000-000000000002'));
    });
    await t.test('two connections compete for last slot: loser preserves its old assignment', async () => {
      reset();
      const outcomes = await Promise.all([
        queryAsync(asUser('begin; '+call(dest,c1,client1)+' select pg_sleep(0.3); commit;')),
        queryAsync(asUser('begin; '+call(dest,c2,client2)+' select pg_sleep(0.3); commit;')),
      ]);
      assert.equal(outcomes.filter(r => r.code === 0).length,1); assert.ok(outcomes.find(r => r.code !== 0)?.output.includes('llena'));
      const winner = query(`select contract_id from public.fo_nap_puertos where infra_elemento_id='${dest}';`);
      const loser = winner === c1 ? c2 : c1;
      assert.equal(query(`select count(*) from public.fo_nap_puertos where infra_elemento_id='${old}' and contract_id='${loser}' and estado='ocupado';`),'1');
      assert.equal(query(`select count(*) from public.fo_nap_puertos where contract_id='${winner}';`),'1');
    });
    await t.test('provisioning RPC and authenticated wrapper use the same capacity lock', async () => {
      reset();
      const outcomes = await Promise.all([
        queryAsync(`begin; select public.assign_provisioning_nap('${dest}','${c1}','${client1}'); select pg_sleep(0.3); commit;`),
        queryAsync(asUser('begin; '+call(dest,c2,client2)+' select pg_sleep(0.3); commit;')),
      ]);
      assert.equal(outcomes.filter(r => r.code === 0).length,1);
      assert.equal(query(`select count(*) from public.fo_nap_puertos where infra_elemento_id='${dest}' and estado='ocupado';`),'1');
    });
  } finally {
    try { docker(['stop',container]); } catch { /* Already removed after a startup failure. */ }
  }
});
