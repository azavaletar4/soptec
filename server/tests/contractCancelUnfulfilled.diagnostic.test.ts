// Caracterización previa al diseño: documenta brechas VIGENTES, no acepta
// estas conductas como deseadas. Al autorizar la corrección, convertir los
// casos «brecha vigente» en regresiones que exijan rechazo sin escrituras.
// Ejecuta la definición leída en producción SOLO en PostgreSQL efímero,
// sin red, con UUID y datos sintéticos. Nunca invoca la RPC de producción.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const file = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const evidence = JSON.parse(file('../../docs/CONTRATACION-NO-INSTALADA-LECTURA-20261111.json'));
const client = '10000000-0000-0000-0000-000000000001';
const a = '20000000-0000-0000-0000-000000000001';
const b = '20000000-0000-0000-0000-000000000002';
const order = '30000000-0000-0000-0000-000000000001';

test('diagnóstico de RPC vigente: instalaciones y ambigüedad, sin acceso a producción', { timeout: 120000 }, async (t) => {
  assert.equal(evidence.readOnly, 'on');
  assert.equal(evidence.rpc.length, 1);
  const name = `contract-unfulfilled-diagnostic-${process.pid}-${Date.now()}`;
  const docker = (args: string[], input?: string) => execFileSync('docker', args, {
    input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000,
  });
  const query = (sql: string) => docker(['exec', '-i', name, 'psql', '-h', '127.0.0.1', '-X', '-qAt', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], sql).trim();
  const reset = () => query(`
    truncate contract_unfulfilled_cancellations, installations, inventory_units, olt_onts, invoices, tickets, routines, service_contracts, clients;
    insert into clients(id,status) values('${client}','active');
    insert into service_contracts(id,client_id,status) values('${a}','${client}','active');
  `);
  const installation = (status: string, contract: string | null = a, completedAt = false) => query(`
    insert into installations(id,client_id,contract_id,status,completed_at)
    values('${order}','${client}',${contract ? `'${contract}'` : 'null'},'${status}',${completedAt ? 'now()' : 'null'});
  `);
  const state = () => query(`select jsonb_build_object('contracts',(select jsonb_agg(s order by id) from service_contracts s),'clients',(select jsonb_agg(c order by id) from clients c),'history',(select jsonb_agg(h order by id) from contract_unfulfilled_cancellations h));`);
  const cancel = () => {
    const stamp = query(`select updated_at from service_contracts where id='${a}';`);
    return JSON.parse(query(`set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
      select public.contract_cancel_unfulfilled('${a}','${stamp}','Diagnóstico con datos sintéticos',true);`));
  };
  const blocked = (message: RegExp) => {
    const before = state();
    assert.throws(cancel, message);
    assert.equal(state(), before);
  };
  try {
    docker(['run', '--rm', '--pull=never', '-d', '--name', name, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { docker(['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); ready = true; break; }
      catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    assert.ok(ready);
    const schema = file('./clientRetirement.fixture.sql');
    const at = schema.indexOf('create policy clients_staff_only');
    assert.ok(at > 0);
    query(schema.slice(0, at));
    query(file('../../supabase/migrations/20260919020000_fase13_gestion_usuarios.sql').match(/create or replace function public\.current_user_role\(\)[\s\S]*?\$\$;/)![0]);
    query(schema.slice(at));
    query(`create table invoices(id uuid primary key,contract_id uuid,status text);
      create table tickets(id uuid primary key,contract_id uuid,status text);
      create table routines(id uuid primary key,contract_id uuid,status text);
      alter table installations add column created_at timestamptz default now(), add column completed_at timestamptz;`);
    query(file('../../docs/sql/contract-cancel-unfulfilled-proposal.sql'));
    query(evidence.rpc[0].definition);

    await t.test('completada con contrato exacto: rechaza sin escribir', () => {
      reset(); installation('completed', a, true); blocked(/instalación completada/);
    });
    for (const status of ['pending', 'scheduled', 'in_progress']) {
      await t.test(`Alta ${status}: rechaza sin escribir`, () => {
        reset(); installation(status); blocked(/Alta abierta/);
      });
    }
    await t.test('Alta cancelada sin instalación previa: permite cancelar la línea', () => {
      reset(); installation('cancelled'); assert.equal(cancel().contract.status, 'cancelled');
    });
    await t.test('patrón Carlos: sin Alta, con ONT y PPPoE: rechaza por ONT sin escribir', () => {
      reset();
      query(`update service_contracts set pppoe_username='usuario-sintetico' where id='${a}';
        insert into olt_onts(id,client_id,contract_id,status) values('${order}','${client}','${a}','online');`);
      blocked(/equipo de red/);
    });
    await t.test('brecha vigente: sin historial de instalación, permite cancelar', () => {
      reset(); assert.equal(cancel().contract.status, 'cancelled');
    });
    await t.test('brecha vigente: completed_at conservado pero estado cancelled, permite cancelar', () => {
      reset(); installation('cancelled', a, true); assert.equal(cancel().contract.status, 'cancelled');
    });
    await t.test('brecha vigente: instalación completada sin contract_id, permite cancelar', () => {
      reset(); installation('completed', null, true); assert.equal(cancel().contract.status, 'cancelled');
    });
    await t.test('brecha vigente: PPPoE asociado sin Alta ni ONT, permite cancelar', () => {
      reset(); query(`update service_contracts set pppoe_username='usuario-sintetico' where id='${a}';`);
      assert.equal(cancel().contract.status, 'cancelled');
    });
    await t.test('varios contratos: completada de otra línea no impide cancelar la Alta cancelada exacta', () => {
      reset(); installation('cancelled');
      query(`insert into service_contracts(id,client_id,status) values('${b}','${client}','active');
        insert into installations(id,client_id,contract_id,status,completed_at)
        values('30000000-0000-0000-0000-000000000002','${client}','${b}','completed',now());`);
      const sibling = query(`select row_to_json(s) from service_contracts s where id='${b}';`);
      assert.equal(cancel().contract.status, 'cancelled');
      assert.equal(query(`select row_to_json(s) from service_contracts s where id='${b}';`), sibling);
      assert.equal(query(`select status from clients where id='${client}';`), 'active');
    });
  } finally {
    try { docker(['stop', name]); } catch { /* solo el contenedor propio */ }
  }
});
