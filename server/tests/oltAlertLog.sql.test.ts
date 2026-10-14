import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const sqlFile = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const client1 = '10000000-0000-0000-0000-000000000001';
const client2 = '10000000-0000-0000-0000-000000000002';
const contractInternet = '20000000-0000-0000-0000-000000000001'; // cliente1
const contractIptv = '20000000-0000-0000-0000-000000000002'; // cliente1, MISMO cliente, otro servicio
const device1 = '50000000-0000-0000-0000-000000000001';
const ontLinkedInternet = '60000000-0000-0000-0000-000000000001';
const ontLinkedIptv = '60000000-0000-0000-0000-000000000002';
const ontUnlinked = '60000000-0000-0000-0000-000000000003';

const superadmin = '00000000-0000-0000-0000-000000000007';
const admin = '00000000-0000-0000-0000-000000000001';
const tecnico = '00000000-0000-0000-0000-000000000002';
const cliente = '00000000-0000-0000-0000-000000000003';
const adminInactivo = '00000000-0000-0000-0000-000000000004';
const soporte = '00000000-0000-0000-0000-000000000005';
const facturacion = '00000000-0000-0000-0000-000000000006';

const asUser = (sql: string, user: string) => `set role authenticated; set request.jwt.claim.sub='${user}'; ${sql}`;

test('PostgreSQL isolated: olt_alert_log — esquema, dedupe, RLS y filtros por contrato', { timeout: 60000 }, async (t) => {
  const container = `smartrayco-fase160-test-${process.pid}-${Date.now()}`;
  const docker = (args: string[], input?: string) =>
    execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const psqlArgs = ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'];
  const query = (sql: string) => docker(psqlArgs, sql).trim();
  const queryAsync = (sql: string) =>
    new Promise<{ code: number; output: string }>((resolve, reject) => {
      const child = spawn('docker', psqlArgs, { windowsHide: true });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code: code ?? 1, output }));
      child.stdin.end(sql);
    });
  const reset = () => query('truncate public.olt_alert_log;');

  try {
    docker(['run', '--rm', '-d', '--name', container, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']);
        ready = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.ok(ready, 'isolated Postgres must start');

    query(sqlFile('./oltAlertLogSchema.sql'));
    const roleSql = sqlFile('../../supabase/migrations/20260919020000_fase13_gestion_usuarios.sql')
      .match(/create or replace function public\.current_user_role\(\)[\s\S]*?\$\$;/)![0];
    query(roleSql);
    const fase160Sql = sqlFile('../../supabase/migrations/20261014150451_fase160_olt_alert_log.sql');
    query(fase160Sql);

    await t.test('verificacion final (punto 3): la migracion se puede RE-APLICAR sin error (if not exists / drop policy if exists en todo), y no duplica indices/policies', () => {
      query(fase160Sql); // si algo no fuera idempotente, esto tiraria y el test fallaria aca.
      const indexCount = query("select count(*) from pg_indexes where tablename='olt_alert_log';");
      const policyCount = query("select count(*) from pg_policies where tablename='olt_alert_log';");
      assert.equal(indexCount, '6'); // 1 PK + 5 creados explicitamente (dedupe + 4 de filtros)
      assert.equal(policyCount, '2'); // select + insert, nunca mas de 1 cada una
    });

    await t.test('caso feliz: inserta un evento con cliente/contrato vinculados, queda legible', () => {
      reset();
      query(`insert into public.olt_alert_log (olt_device_id, olt_ont_id, kind, at, client_id, contract_id, detail)
        values ('${device1}','${ontLinkedInternet}','offline','2026-10-14T13:31:00Z','${client1}','${contractInternet}','ONT se desconectó');`);
      const row = query(`select client_id, contract_id, kind from public.olt_alert_log where olt_ont_id='${ontLinkedInternet}';`);
      assert.equal(row, `${client1}|${contractInternet}|offline`);
    });

    await t.test('ONT sin vincular: client_id/contract_id null, se inserta igual (Pendiente de vincular)', () => {
      reset();
      query(`insert into public.olt_alert_log (olt_device_id, olt_ont_id, kind, at, client_id, contract_id, detail)
        values ('${device1}','${ontUnlinked}','recovered','2026-10-14T14:00:00Z',null,null,'ONT volvió a estar en línea');`);
      const count = query(`select count(*) from public.olt_alert_log where olt_ont_id='${ontUnlinked}' and client_id is null and contract_id is null;`);
      assert.equal(count, '1');
    });

    await t.test('DEDUPE: el mismo evento exacto (misma ONT, mismo kind, mismo instante) NO se puede insertar 2 veces', () => {
      reset();
      const insertSql = `insert into public.olt_alert_log (olt_device_id, olt_ont_id, kind, at) values ('${device1}','${ontLinkedInternet}','offline','2026-10-14T13:31:00Z');`;
      query(insertSql);
      assert.throws(() => query(insertSql), /duplicate key|unique constraint/i);
      assert.equal(query(`select count(*) from public.olt_alert_log where olt_ont_id='${ontLinkedInternet}';`), '1');
    });

    await t.test('el MISMO ont con distinto instante o distinto kind SI se inserta (no es el mismo evento)', () => {
      reset();
      query(`insert into public.olt_alert_log (olt_device_id, olt_ont_id, kind, at) values
        ('${device1}','${ontLinkedInternet}','offline','2026-10-14T13:31:00Z'),
        ('${device1}','${ontLinkedInternet}','recovered','2026-10-14T13:40:00Z'),
        ('${device1}','${ontLinkedInternet}','offline','2026-10-14T18:00:00Z');`); // nueva caida, otro instante
      assert.equal(query(`select count(*) from public.olt_alert_log where olt_ont_id='${ontLinkedInternet}';`), '3');
    });

    await t.test('cliente con MULTIPLES servicios: filtrar por contract_id devuelve SOLO el evento de ESE servicio, nunca mezcla el otro', () => {
      reset();
      query(`insert into public.olt_alert_log (olt_device_id, olt_ont_id, kind, at, client_id, contract_id) values
        ('${device1}','${ontLinkedInternet}','offline','2026-10-14T13:31:00Z','${client1}','${contractInternet}'),
        ('${device1}','${ontLinkedIptv}','offline','2026-10-14T13:31:00Z','${client1}','${contractIptv}');`);
      const internetOnly = query(`select olt_ont_id from public.olt_alert_log where contract_id='${contractInternet}';`);
      const iptvOnly = query(`select olt_ont_id from public.olt_alert_log where contract_id='${contractIptv}';`);
      assert.equal(internetOnly, ontLinkedInternet);
      assert.equal(iptvOnly, ontLinkedIptv);
      // ambos eventos son del MISMO cliente, filtrar por client_id trae los 2 — correcto, es el mismo abonado.
      assert.equal(query(`select count(*) from public.olt_alert_log where client_id='${client1}';`), '2');
      // pero NUNCA se mezcla con el otro cliente.
      assert.equal(query(`select count(*) from public.olt_alert_log where client_id='${client2}';`), '0');
    });

    await t.test('duracion calculable en lectura: se correlaciona el offline mas reciente con su recovered por olt_ont_id', () => {
      reset();
      query(`insert into public.olt_alert_log (olt_device_id, olt_ont_id, kind, at) values
        ('${device1}','${ontLinkedInternet}','offline','2026-10-14T13:00:00Z'),
        ('${device1}','${ontLinkedInternet}','recovered','2026-10-14T13:45:00Z');`);
      const minutos = query(`
        select round(extract(epoch from (r.at - o.at)) / 60)
        from public.olt_alert_log o
        join public.olt_alert_log r on r.olt_ont_id = o.olt_ont_id and r.kind = 'recovered' and r.at > o.at
        where o.olt_ont_id = '${ontLinkedInternet}' and o.kind = 'offline'
        order by o.at desc, r.at asc limit 1;`);
      assert.equal(minutos, '45');
    });

    await t.test('FK invalida (contrato inexistente) se rechaza — nunca un vinculo inventado', () => {
      reset();
      const contratoInexistente = '20000000-0000-0000-0000-000000000099';
      assert.throws(
        () => query(`insert into public.olt_alert_log (olt_device_id, olt_ont_id, kind, at, contract_id) values ('${device1}','${ontLinkedInternet}','offline','2026-10-14T13:31:00Z','${contratoInexistente}');`),
        /violates foreign key/i,
      );
    });

    await t.test('permisos de lectura (RLS): SUPERADMIN/ADMIN/TECNICO_RED ven las filas; SOPORTE/FACTURACION/CLIENTE/admin inactivo/anonimo NO', () => {
      reset();
      query(`insert into public.olt_alert_log (olt_device_id, olt_ont_id, kind, at) values ('${device1}','${ontLinkedInternet}','offline','2026-10-14T13:31:00Z');`);
      const selectSql = 'select count(*) from public.olt_alert_log;';
      assert.equal(query(asUser(selectSql, superadmin)), '1');
      assert.equal(query(asUser(selectSql, admin)), '1');
      assert.equal(query(asUser(selectSql, tecnico)), '1');
      // RLS no lanza error para un rol sin permiso de SELECT via policy — simplemente no ve filas.
      assert.equal(query(asUser(selectSql, cliente)), '0');
      assert.equal(query(asUser(selectSql, adminInactivo)), '0');
      assert.equal(query(asUser(selectSql, soporte)), '0');
      assert.equal(query(asUser(selectSql, facturacion)), '0');
    });

    await t.test('anonimo (sin sesion): no ve ninguna fila', async () => {
      reset();
      query(`insert into public.olt_alert_log (olt_device_id, olt_ont_id, kind, at) values ('${device1}','${ontLinkedInternet}','offline','2026-10-14T13:31:00Z');`);
      const result = await queryAsync('set role anon; select count(*) from public.olt_alert_log;');
      assert.equal(result.output.trim(), '0');
    });

    await t.test('insert-only por diseño: sin policy de UPDATE/DELETE, el UPDATE corre pero no afecta ninguna fila (RLS sin policy = 0 filas visibles para ese comando, ni para SUPERADMIN)', () => {
      reset();
      query(`insert into public.olt_alert_log (olt_device_id, olt_ont_id, kind, at, detail) values ('${device1}','${ontLinkedInternet}','offline','2026-10-14T13:31:00Z','original');`);
      query(asUser(`update public.olt_alert_log set detail='editado' where olt_ont_id='${ontLinkedInternet}';`, superadmin));
      const detail = query(`select detail from public.olt_alert_log where olt_ont_id='${ontLinkedInternet}';`);
      assert.equal(detail, 'original'); // el UPDATE no tiro error, pero tampoco cambio nada.
    });
  } finally {
    try {
      docker(['stop', container]);
    } catch {
      /* Already removed after a startup failure. */
    }
  }
});
