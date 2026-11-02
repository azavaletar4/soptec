import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const file = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const client = '10000000-0000-0000-0000-000000000001';
const other = '10000000-0000-0000-0000-000000000002';
const a = '20000000-0000-0000-0000-000000000001', b = '20000000-0000-0000-0000-000000000002';
const order = '30000000-0000-0000-0000-000000000001';
const actor = (n: number) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
const session = (sql: string, n = 2) => `set role authenticated;set request.jwt.claim.sub='${actor(n)}';${sql}`;

// Caso real que origina esta prueba: Jheraldin Vidal Cruz, CTR-2026-00297 —
// aceptó la contratación, el técnico fue y la instalación se canceló. El
// contrato quedó 'active' y la ficha en 'prospect' crudo, sin que nada
// hubiera marcado la línea como no-instalada. Ver docs/sql/
// contract-cancel-unfulfilled-proposal.sql y
// docs/CLIENTES-CONTRATACION-NO-INSTALADA.md.
test('cancelar contratación no instalada: PostgreSQL aislado, permisos y transición correcta de la ficha', { timeout: 120000 }, async (t) => {
  const name = `contract-unfulfilled-test-${process.pid}-${Date.now()}`;
  const docker = (args: string[], input?: string) =>
    execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000 });
  const args = ['exec', '-i', name, 'psql', '-h', '127.0.0.1', '-X', '-qAt', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'];
  const query = (sql: string) => docker(args, sql).trim();

  const reset = () => query(`
    truncate installations, service_contracts, clients, inventory_units, olt_onts, invoices, tickets, routines, contract_unfulfilled_cancellations;
    insert into clients(id,status) values ('${client}','prospect'),('${other}','active');
    insert into service_contracts(id,client_id,status) values ('${a}','${client}','active'),('${b}','${client}','active');
  `);
  // Para los casos "única línea": una sola service_contracts, sin la línea
  // hermana 'b' — si no, cualquier cancelación se queda en 'active' porque
  // 'b' sigue vigente (comportamiento correcto del RPC, no es lo que estas
  // pruebas puntuales quieren ejercitar).
  const resetSingle = () => query(`
    truncate installations, service_contracts, clients, inventory_units, olt_onts, invoices, tickets, routines, contract_unfulfilled_cancellations;
    insert into clients(id,status) values ('${client}','prospect'),('${other}','active');
    insert into service_contracts(id,client_id,status) values ('${a}','${client}','active');
  `);
  const timestamp = (id = a) => query(`select updated_at from service_contracts where id='${id}';`);
  const cancel = (id = a, stamp = timestamp(id), reason = 'Rechazó la instalación cuando llegó el técnico', confirm = true) =>
    `select public.contract_cancel_unfulfilled('${id}','${stamp}','${reason}',${confirm});`;
  const state = () => query(`select jsonb_build_object('c',(select jsonb_agg(c order by id) from clients c),'s',(select jsonb_agg(s order by id) from service_contracts s));`);
  const untouched = () => query(`select jsonb_build_object('installations',(select jsonb_agg(i order by id) from installations i),'invoices',(select jsonb_agg(v order by id) from invoices v),'units',(select jsonb_agg(u order by id) from inventory_units u),'ont',(select jsonb_agg(o order by id) from olt_onts o));`);

  try {
    docker(['run', '--rm', '--pull=never', '-d', '--name', name, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
    let ready = false;
    for (let i = 0; i < 60; i++) { try { docker(['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); ready = true; break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    assert.ok(ready);

    const schema = file('./clientRetirement.fixture.sql');
    const at = schema.indexOf('create policy clients_staff_only');
    query(schema.slice(0, at));
    query(file('../../supabase/migrations/20260919020000_fase13_gestion_usuarios.sql').match(/create or replace function public\.current_user_role\(\)[\s\S]*?\$\$;/)![0]);
    query(schema.slice(at));
    query(`
      create table invoices(id uuid primary key, contract_id uuid, status text default 'pending');
      create table tickets(id uuid primary key, contract_id uuid, status text default 'open');
      create table routines(id uuid primary key, contract_id uuid, status text default 'pending');
      alter table installations add column created_at timestamptz not null default now();
    `);
    const beforeInstall = state();
    query(file('../../docs/sql/contract-cancel-unfulfilled-proposal.sql'));
    assert.equal(state(), beforeInstall);

    await t.test('rechazo antes de instalación: única línea cancela y la ficha vuelve a prospect, con motivo guardado', () => {
      resetSingle();
      query(`insert into installations (id,client_id,contract_id,status,updated_at) values('${order}','${client}','${a}','cancelled',now());`);
      const result = JSON.parse(query(session(cancel())));
      assert.equal(result.clientStatus, 'prospect');
      assert.equal(query(`select status from service_contracts where id='${a}';`), 'cancelled');
      assert.equal(query('select status from clients where id=\'' + client + '\';'), 'prospect');
      const logged = JSON.parse(query(`select row_to_json(x) from contract_unfulfilled_cancellations x;`));
      assert.equal(logged.reason, 'Rechazó la instalación cuando llegó el técnico');
      assert.equal(logged.previous_contract_status, 'active');
      assert.equal(logged.new_client_status, 'prospect');
    });

    await t.test('múltiples contratos: cancelar la línea no instalada no toca la otra línea activa ni retira la ficha', () => {
      reset();
      query(`insert into installations (id,client_id,contract_id,status,updated_at) values('${order}','${client}','${a}','cancelled',now());`);
      const otherBefore = query(`select row_to_json(s) from service_contracts s where id='${b}';`);
      query(session(cancel()));
      assert.equal(query(`select row_to_json(s) from service_contracts s where id='${b}';`), otherBefore);
      assert.equal(query(`select status from clients where id='${client}';`), 'active');
    });

    await t.test('cliente ya instalado: bloquea y no escribe nada, dirige a la baja administrativa', () => {
      reset();
      query(`insert into installations (id,client_id,contract_id,status,updated_at) values('${order}','${client}','${a}','completed',now());`);
      const before = state();
      assert.throws(() => query(session(cancel())), /baja administrativa/);
      assert.equal(state(), before);
    });

    await t.test('materiales/equipo pendiente: bloquea si hay una unidad de inventario asignada a esta línea', () => {
      reset();
      query(`insert into installations (id,client_id,contract_id,status,updated_at) values('${order}','${client}','${a}','cancelled',now());`);
      query(`insert into inventory_units values('${order}','${client}','${a}','assigned');`);
      const before = state();
      assert.throws(() => query(session(cancel())), /sin devolver/);
      assert.equal(state(), before);
      assert.equal(query(`select status from inventory_units where id='${order}';`), 'assigned');
    });

    await t.test('equipo de red (ONT) vinculado: bloquea igual que facturación y tickets/rutinas abiertas', () => {
      reset();
      query(`insert into installations (id,client_id,contract_id,status,updated_at) values('${order}','${client}','${a}','cancelled',now());`);
      query(`insert into olt_onts values('${order}','${client}','${a}','online');`);
      assert.throws(() => query(session(cancel())), /equipo de red/);
      reset();
      query(`insert into installations (id,client_id,contract_id,status,updated_at) values('${order}','${client}','${a}','cancelled',now());`);
      query(`insert into invoices values('${order}','${a}','pending');`);
      assert.throws(() => query(session(cancel())), /facturación/);
      reset();
      query(`insert into installations (id,client_id,contract_id,status,updated_at) values('${order}','${client}','${a}','cancelled',now());`);
      query(`insert into tickets values('${order}','${a}','open');`);
      assert.throws(() => query(session(cancel())), /ticket de soporte/);
      reset();
      query(`insert into installations (id,client_id,contract_id,status,updated_at) values('${order}','${client}','${a}','cancelled',now());`);
      query(`insert into routines values('${order}','${a}','pending');`);
      assert.throws(() => query(session(cancel())), /rutina abierta/);
    });

    await t.test('recontratación posterior: tras volver a prospect, se puede crear un contrato nuevo normalmente', () => {
      reset();
      query(`insert into installations (id,client_id,contract_id,status,updated_at) values('${order}','${client}','${a}','cancelled',now());`);
      query(`update service_contracts set status='cancelled' where id='${b}';`); // la otra línea ya estaba cerrada antes de esta cancelación
      query(session(cancel()));
      assert.equal(query(`select status from clients where id='${client}';`), 'prospect');
      const newContract = '20000000-0000-0000-0000-000000000099';
      query(session(`insert into service_contracts(id,client_id,status) values ('${newContract}','${client}','active');`));
      assert.equal(query(`select status from service_contracts where id='${newContract}';`), 'active');
    });

    await t.test('Alta abierta todavía (ni completada ni cancelada): bloquea, no es el caso de esta acción', () => {
      reset();
      query(`insert into installations (id,client_id,contract_id,status,updated_at) values('${order}','${client}','${a}','scheduled',now());`);
      const before = state();
      assert.throws(() => query(session(cancel())), /Alta abierta/);
      assert.equal(state(), before);
    });

    await t.test('permisos: solo SUPERADMIN activo; ADMIN y los demás roles quedan fuera (a diferencia de la baja normal)', () => {
      reset();
      query(`insert into installations (id,client_id,contract_id,status,updated_at) values('${order}','${client}','${a}','cancelled',now());`);
      for (const role of [1, 3, 4, 5, 6, 7]) assert.throws(() => query(session(cancel(a, timestamp(a), 'motivo valido', true), role)), /SUPERADMIN/);
      assert.throws(() => query(`set role anon;${cancel()}`), /permission denied/);
      assert.throws(() => query(`set role service_role;${cancel()}`), /permission denied/);
    });

    await t.test('motivo y confirmación obligatorios; ambos fallan cerrado sin escribir', () => {
      reset();
      query(`insert into installations (id,client_id,contract_id,status,updated_at) values('${order}','${client}','${a}','cancelled',now());`);
      const before = state();
      assert.throws(() => query(session(cancel(a, timestamp(a), 'ok', false))), /Confirme/);
      assert.throws(() => query(session(cancel(a, timestamp(a), 'hi', true))), /motivo/);
      assert.equal(state(), before);
    });

    await t.test('repetición tras respuesta perdida es idempotente; no vuelve a derivar el estado de la ficha', () => {
      reset();
      query(`insert into installations (id,client_id,contract_id,status,updated_at) values('${order}','${client}','${a}','cancelled',now());`);
      const stamp = timestamp(a);
      query(session(cancel(a, stamp)));
      query(session(`update clients set status='active' where id='${client}';`)); // otra sesión cambió la ficha después
      const repeated = JSON.parse(query(session(cancel(a, stamp))));
      assert.equal(repeated.alreadyCancelled, true);
      assert.equal(query(`select status from clients where id='${client}';`), 'active');
    });

    await t.test('nunca toca instalaciones, NAP, facturación ni inventario — solo contrato, ficha y su propio historial', () => {
      reset();
      query(`insert into installations (id,client_id,contract_id,status,updated_at) values('${order}','${client}','${a}','cancelled',now());`);
      const before = untouched();
      query(session(cancel()));
      assert.equal(untouched(), before);
    });

    await t.test('compatible con la guarda real de contract_administrative_guard (producción): no bloquea esta RPC ni la baja normal', () => {
      query(file('../../docs/sql/contract-administrative-cancellation-proposal.sql'));
      resetSingle();
      query(`insert into installations (id,client_id,contract_id,status,updated_at) values('${order}','${client}','${a}','cancelled',now());`);
      // Esta RPC sigue funcionando con la guarda de la baja normal ya instalada.
      const result = JSON.parse(query(session(cancel())));
      assert.equal(result.clientStatus, 'prospect');
      // Otra línea activa, aparte, para probar que la guarda sigue en pie y
      // que la baja normal (contract_cancel_administrative) sigue intacta.
      query(`insert into service_contracts(id,client_id,status) values ('${b}','${client}','active');`);
      assert.throws(() => query(session(`update service_contracts set status='cancelled' where id='${b}';`)), /baja administrativa confirmada/);
      const stamp = query(`select updated_at from service_contracts where id='${b}';`);
      query(session(`select public.contract_cancel_administrative('${b}','${stamp}',true);`));
      assert.equal(query(`select status from service_contracts where id='${b}';`), 'cancelled');
      query(file('../../docs/sql/contract-administrative-cancellation-rollback.sql'));
    });

    await t.test('rollback: retira solo la función, conserva el historial y los estados ya escritos', () => {
      resetSingle();
      query(`insert into installations (id,client_id,contract_id,status,updated_at) values('${order}','${client}','${a}','cancelled',now());`);
      query(session(cancel()));
      const stateBefore = state();
      const historyBefore = query(`select jsonb_agg(x order by id) from contract_unfulfilled_cancellations x;`);
      query(file('../../docs/sql/contract-cancel-unfulfilled-rollback.sql'));
      assert.equal(state(), stateBefore);
      assert.equal(query(`select jsonb_agg(x order by id) from contract_unfulfilled_cancellations x;`), historyBefore);
      assert.throws(() => query(session(cancel(a, timestamp(a)))), /does not exist|function public\.contract_cancel_unfulfilled/);
    });
  } finally {
    try { docker(['stop', name]); } catch { /* solo contenedor propio */ }
  }
});
