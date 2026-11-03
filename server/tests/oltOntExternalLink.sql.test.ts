import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const sqlFile = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const client1 = '10000000-0000-0000-0000-000000000001';
const client2 = '10000000-0000-0000-0000-000000000002';
const contract1 = '20000000-0000-0000-0000-000000000001'; // cliente1
const contract2 = '20000000-0000-0000-0000-000000000002'; // cliente2
const device1 = '50000000-0000-0000-0000-000000000001';

const admin = '00000000-0000-0000-0000-000000000001';
const tecnico = '00000000-0000-0000-0000-000000000002';
const cliente = '00000000-0000-0000-0000-000000000003';
const superadmin = '00000000-0000-0000-0000-000000000007';

const asUser = (sql: string, user: string) => `set role authenticated; set request.jwt.claim.sub='${user}'; ${sql}`;

test(
  'PostgreSQL isolado: olt_onts_contract_id_active_key (indice unico parcial) y olt_ont_link_audit (tabla + RLS)',
  { timeout: 60000 },
  async (t) => {
    const container = `smartrayco-ont-link-test-${process.pid}-${Date.now()}`;
    const docker = (args: string[], input?: string) =>
      execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const psqlArgs = ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'];
    const query = (sql: string) => docker(psqlArgs, sql).trim();
    const queryFails = (sql: string) => {
      try {
        docker(psqlArgs, sql);
        return null;
      } catch (e) {
        return String((e as { stderr?: Buffer })?.stderr ?? e);
      }
    };

    try {
      docker(['run', '--rm', '-d', '--pull=never', '--name', container, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
      let ready = false;
      for (let n = 0; n < 60; n++) {
        try { docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); ready = true; break; }
        catch { await new Promise((r) => setTimeout(r, 100)); }
      }
      assert.ok(ready);

      query(sqlFile('./oltOntExternalLinkSchema.sql'));
      query(sqlFile('../../supabase/migrations/20261103000000_olt_ont_external_link.sql'));

      await t.test('tabla y columnas reales presentes', () => {
        assert.equal(query("select count(*) from information_schema.tables where table_name='olt_ont_link_audit';"), '1');
        assert.equal(
          query("select string_agg(column_name,',' order by column_name) from information_schema.columns where table_name='olt_ont_link_audit';"),
          'action,client_id,contract_id,id,olt_device_id,ont_id,performed_at,performed_by,position,previous_client_id,previous_contract_id,serial',
        );
      });

      await t.test('indice unico parcial: 2 ONTs activas NO pueden compartir el mismo contract_id', () => {
        query(
          `insert into olt_onts(olt_device_id, client_id, contract_id, serial) values ('${device1}','${client1}','${contract1}','ZTEG0001');`,
        );
        const err = queryFails(
          `insert into olt_onts(olt_device_id, client_id, contract_id, serial) values ('${device1}','${client1}','${contract1}','ZTEG0002');`,
        );
        assert.ok(err, 'una segunda ONT activa con el mismo contract_id debe fallar');
        assert.match(err!, /olt_onts_contract_id_active_key|duplicate key/i);
        query('delete from olt_onts;');
      });

      await t.test('el mismo contract_id SI puede repetirse si la fila anterior esta retirada', () => {
        query(
          `insert into olt_onts(olt_device_id, client_id, contract_id, serial, retired_at) values ('${device1}','${client1}','${contract1}','ZTEG0003', now());`,
        );
        // La retirada no cuenta para el indice (where retired_at is null) -- esta nueva activa no choca con ella.
        query(
          `insert into olt_onts(olt_device_id, client_id, contract_id, serial) values ('${device1}','${client1}','${contract1}','ZTEG0004');`,
        );
        assert.equal(query('select count(*) from olt_onts;'), '2');
        query('delete from olt_onts;');
      });

      await t.test('multiples ONTs sin contract_id (null) nunca chocan entre si', () => {
        query(`insert into olt_onts(olt_device_id, serial) values ('${device1}','ZTEG0005'), ('${device1}','ZTEG0006');`);
        assert.equal(query('select count(*) from olt_onts;'), '2');
        query('delete from olt_onts;');
      });

      await t.test('contract_id distinto para 2 clientes distintos nunca choca', () => {
        query(
          `insert into olt_onts(olt_device_id, client_id, contract_id, serial) values
           ('${device1}','${client1}','${contract1}','ZTEG0007'),
           ('${device1}','${client2}','${contract2}','ZTEG0008');`,
        );
        assert.equal(query('select count(*) from olt_onts;'), '2');
        query('delete from olt_onts;');
      });

      await t.test('RLS: ADMIN/SUPERADMIN pueden leer la auditoria; TECNICO_RED y CLIENTE no', () => {
        query(
          `insert into olt_ont_link_audit(ont_id, olt_device_id, action, client_id, contract_id, serial, position, performed_by) values
           (gen_random_uuid(), '${device1}', 'link', '${client1}', '${contract1}', 'ZTEG0001', '1/2/8:1', '${admin}');`,
        );
        assert.equal(query(asUser('select count(*) from olt_ont_link_audit;', admin)), '1');
        assert.equal(query(asUser('select count(*) from olt_ont_link_audit;', superadmin)), '1');
        assert.equal(query(asUser('select count(*) from olt_ont_link_audit;', tecnico)), '0');
        assert.equal(query(asUser('select count(*) from olt_ont_link_audit;', cliente)), '0');
      });

      await t.test('RLS: ningun rol autenticado puede escribir directo en la auditoria (solo supabaseAdmin desde el backend)', () => {
        const err = queryFails(
          asUser(
            `insert into olt_ont_link_audit(ont_id, olt_device_id, action, client_id, contract_id, serial, position, performed_by) values (gen_random_uuid(), '${device1}', 'link', '${client1}', '${contract1}', 'ZTEG9999', '1/2/8:9', '${admin}');`,
            admin,
          ),
        );
        assert.ok(err, 'authenticated (incluso ADMIN) no debe poder insertar directo');
      });

      await t.test('check constraint: action solo acepta import/link', () => {
        const err = queryFails(
          `insert into olt_ont_link_audit(ont_id, olt_device_id, action, serial, position, performed_by) values (gen_random_uuid(), '${device1}', 'reprovision', 'ZTEG0001', '1/2/8:1', '${admin}');`,
        );
        assert.ok(err);
      });
    } finally {
      try { docker(['rm', '-f', container]); } catch { /* best effort cleanup */ }
    }
  },
);
