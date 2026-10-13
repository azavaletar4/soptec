import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const sqlFile = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const contract1 = '20000000-0000-0000-0000-000000000001', contract2 = '20000000-0000-0000-0000-000000000002';
const client1 = '10000000-0000-0000-0000-000000000001', client2 = '10000000-0000-0000-0000-000000000002';
const zone1 = '40000000-0000-0000-0000-000000000001', zone2 = '40000000-0000-0000-0000-000000000002';
const nap1 = '30000000-0000-0000-0000-000000000001', nap2 = '30000000-0000-0000-0000-000000000002';
const admin = '00000000-0000-0000-0000-000000000001';
const call = (nap = nap2, contract = contract1, client = client1) =>
  `select * from public.assign_contract_nap_sync_ont_zone('${nap}','${contract}','${client}');`;
const asUser = (sql: string, user = admin) => `set role authenticated; set request.jwt.claim.sub='${user}'; ${sql}`;

test('PostgreSQL isolated: NAP + zona de ONT en una sola transaccion, permisos y rollback', { timeout: 60000 }, async t => {
  const container = `smartrayco-fase158-test-${process.pid}-${Date.now()}`;
  const docker = (args: string[], input?: string) => execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe','pipe','pipe'] });
  const psqlArgs = ['exec','-i',container,'psql','-h','127.0.0.1','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres'];
  const query = (sql: string) => docker(psqlArgs, sql).trim();
  const queryAsync = (sql: string) => new Promise<{ code: number; output: string }>((resolve, reject) => {
    const child = spawn('docker', psqlArgs, { windowsHide: true }); let output = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject); child.on('close', code => resolve({ code: code ?? 1, output })); child.stdin.end(sql);
  });
  const reset = () => query(`truncate public.fo_nap_puertos, public.olt_onts;
    insert into public.fo_nap_puertos(infra_elemento_id,puerto_numero,estado,client_id,contract_id) values
    ('${nap1}',1,'ocupado','${client1}','${contract1}'),('${nap1}',2,'ocupado','${client2}','${contract2}');
    update public.service_contracts set zone_id='${zone1}' where id='${contract1}';
    update public.service_contracts set zone_id='${zone2}' where id='${contract2}';`);
  const napSnapshot = () => query('select coalesce(jsonb_agg(to_jsonb(p) order by id),\'[]\') from public.fo_nap_puertos p;');
  try {
    docker(['run','--rm','-d','--name',container,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(ready, 'isolated Postgres must start');
    query(sqlFile('./ontZoneNapSchema.sql'));
    const roleSql = sqlFile('../../supabase/migrations/20260919020000_fase13_gestion_usuarios.sql')
      .match(/create or replace function public\.current_user_role\(\)[\s\S]*?\$\$;/)![0];
    query(roleSql);
    query(sqlFile('../../supabase/migrations/20261009120000_fase136c_provisioning_nap.sql'));
    query(sqlFile('../../supabase/migrations/20261009130000_fase136d_nap_authenticated_assignment.sql'));
    query(sqlFile('../../supabase/migrations/20261013160000_fase158_assign_contract_nap_sync_ont_zone.sql'));

    await t.test('caso feliz: reasigna NAP Y sincroniza la zona de la ONT en una sola llamada', () => {
      reset(); query(`insert into public.olt_onts(id, contract_id, zone_id) values ('50000000-0000-0000-0000-000000000001','${contract1}','${zone2}');`);
      const row = query(asUser(call())).split('|'); // nap_port_id | ont_zone_synced | ont_zone_skip_reason
      assert.equal(row[1], 't');
      assert.equal(row[2], '');
      assert.equal(query(`select zone_id from public.olt_onts where contract_id='${contract1}';`), zone1);
      assert.equal(query(`select estado from public.fo_nap_puertos where infra_elemento_id='${nap1}' and puerto_numero=1;`), 'libre');
    });

    await t.test('sin ONT vinculada: NAP se reasigna igual, pero no toca olt_onts (reporta el motivo)', () => {
      reset();
      const row = query(asUser(call())).split('|');
      assert.equal(row[1], 'f'); assert.equal(row[2], 'sin_ont_vinculada');
      assert.equal(query('select count(*) from public.olt_onts;'), '0');
    });

    await t.test('cliente con 2 servicios: solo existe la ONT del OTRO contrato — no se toca por error', () => {
      reset(); query(`insert into public.olt_onts(id, contract_id, zone_id) values ('50000000-0000-0000-0000-000000000002','${contract2}','${zone2}');`);
      const row = query(asUser(call())).split('|');
      assert.equal(row[1], 'f'); assert.equal(row[2], 'sin_ont_vinculada');
      assert.equal(query(`select zone_id from public.olt_onts where contract_id='${contract2}';`), zone2); // intacta
    });

    await t.test('ambiguo: 2 ONTs con el mismo contract_id — ninguna se toca, se informa el conteo', () => {
      reset(); query(`insert into public.olt_onts(id, contract_id, zone_id) values
        ('50000000-0000-0000-0000-000000000001','${contract1}','${zone2}'),
        ('50000000-0000-0000-0000-000000000003','${contract1}','${zone2}');`);
      const row = query(asUser(call())).split('|');
      assert.equal(row[1], 'f'); assert.equal(row[2], 'ambiguo:2');
      assert.equal(query(`select count(*) from public.olt_onts where contract_id='${contract1}' and zone_id='${zone2}';`), '2'); // ninguna cambio
    });

    await t.test('zona ya coincide: no reescribe, pero igual reporta sincronizado', () => {
      reset(); query(`insert into public.olt_onts(id, contract_id, zone_id) values ('50000000-0000-0000-0000-000000000001','${contract1}','${zone1}');`);
      const row = query(asUser(call())).split('|');
      assert.equal(row[1], 't'); assert.equal(row[2], '');
      assert.equal(query(`select zone_id from public.olt_onts where contract_id='${contract1}';`), zone1);
    });

    await t.test('TRANSACCIONAL: si falla la actualizacion de la ONT, la reserva NAP tambien se revierte', () => {
      reset(); query(`insert into public.olt_onts(id, contract_id, zone_id) values ('50000000-0000-0000-0000-000000000001','${contract1}','${zone2}');
        create function public.fail_ont_update() returns trigger language plpgsql as $$ begin raise exception 'forced ont update failure'; end $$;
        create trigger fail_ont_update before update on public.olt_onts for each row execute function public.fail_ont_update();`);
      const napBefore = napSnapshot(); const ontBefore = query(`select zone_id from public.olt_onts where contract_id='${contract1}';`);
      assert.throws(() => query(asUser(call())), /forced ont update failure/);
      assert.equal(napSnapshot(), napBefore); // la reserva NAP NO quedo aplicada, a pesar de haberse ejecutado antes en la misma funcion
      assert.equal(query(`select zone_id from public.olt_onts where contract_id='${contract1}';`), ontBefore);
      query('drop trigger fail_ont_update on public.olt_onts; drop function public.fail_ont_update();');
    });

    await t.test('permisos: SUPERADMIN/ADMIN/TECNICO_RED pueden; SOPORTE/FACTURACION/CLIENTE/inactivo/anonimo NO', () => {
      reset();
      for (const user of [
        '00000000-0000-0000-0000-000000000003', // CLIENTE
        '00000000-0000-0000-0000-000000000004', // ADMIN inactivo
        '00000000-0000-0000-0000-000000000005', // SOPORTE
        '00000000-0000-0000-0000-000000000006', // FACTURACION
      ]) assert.throws(() => query(asUser(call(), user)), /permisos/);
      assert.throws(() => query('set role anon; ' + call()), /permission denied/);

      reset(); query(asUser(call(nap2, contract1, client1), '00000000-0000-0000-0000-000000000001')); // ADMIN
      reset(); query(asUser(call(nap2, contract1, client1), '00000000-0000-0000-0000-000000000002')); // TECNICO_RED
      reset(); query(asUser(call(nap2, contract1, client1), '00000000-0000-0000-0000-000000000007')); // SUPERADMIN
    });

    await t.test('regresion: assign_contract_nap (la funcion vieja, SOPORTE/FACTURACION) sigue igual, sin tocar olt_onts', () => {
      reset(); query(`insert into public.olt_onts(id, contract_id, zone_id) values ('50000000-0000-0000-0000-000000000001','${contract1}','${zone2}');`);
      query(asUser(`select public.assign_contract_nap('${nap2}','${contract1}','${client1}');`, '00000000-0000-0000-0000-000000000005')); // SOPORTE, permitido como siempre
      assert.equal(query(`select zone_id from public.olt_onts where contract_id='${contract1}';`), zone2); // intacta — la funcion vieja nunca la toca
    });
  } finally {
    try { docker(['stop',container]); } catch { /* Already removed after a startup failure. */ }
  }
});
