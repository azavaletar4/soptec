import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const file = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const migration = file('../../supabase/migrations/20261111140000_installation_iptv_mode.sql');
const rollback = file('../../scripts/rollback-installation-iptv-mode.sql');
const live = JSON.parse(file('../../docs/ALTAS-IPTV-TRIGGER-LECTURA-20261111.json'));
const client = '30000000-0000-0000-0000-000000000001';
const tech = '00000000-0000-0000-0000-000000000003', admin = '00000000-0000-0000-0000-000000000002';
const ont = '50000000-0000-0000-0000-000000000001', tv = '50000000-0000-0000-0000-000000000013';
const currentRole = file('../../supabase/migrations/20260919020000_fase13_gestion_usuarios.sql').match(/create or replace function public\.current_user_role\(\)[\s\S]*?\$\$;/)![0];

test('modalidad IPTV: migración real, custodia real, cierres y concurrencia aislados', { timeout: 180000 }, async t => {
  const container = `iptv-mode-${process.pid}-${Date.now()}`;
  const docker = (args: string[], input?: string) => execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000 });
  const psql = ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-X', '-qAt', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'];
  const sql = (s: string) => docker(psql, s).trim();
  const session = (s: string, uid = tech) => `set role authenticated;set request.jwt.claim.sub='${uid}';${s}`;
  const as = (s: string, uid = tech) => sql(session(s, uid));
  const immutable = () => sql(`select jsonb_build_object('units',(select jsonb_agg(u order by id) from inventory_units u),'events',(select jsonb_agg(e order by id) from inventory_unit_events e),'moves',(select jsonb_agg(m order by id) from inventory_movements m),'custody',(select jsonb_agg(c order by technician_id,product_id) from technician_material_custody c));`);
  const orderState = (id: string) => sql(`select row_to_json(i) from installations i where id='${id}';`);
  const make = (xui: number | null = 55, service = 'internet_combo') => {
    const id = randomUUID(), contract = randomUUID();
    sql(`insert into service_contracts(id,client_id,service_type,zone_id,xui_line_id) values('${contract}','${client}','${service}',gen_random_uuid(),${xui ?? 'null'});
      insert into fo_nap_puertos(contract_id,estado) values('${contract}','ocupado');
      insert into installations(id,status,client_id,contract_id) values('${id}','in_progress','${client}','${contract}');
      insert into job_assignees values('installation','${id}','${tech}','leader');`);
    return { id, contract };
  };
  const op = (o: { id: string }, unit: string, operation = randomUUID()) => `select campo_inventory_operation('${operation}','installation','${o.id}','assign','{"unitId":"${unit}"}');`;
  const stocked = (product = tv, serial: string | null = randomUUID(), mac: string | null = null) => {
    const id = randomUUID();
    sql(`insert into inventory_units(id,product_id,serial_number,mac_address) values('${id}','${product}',${serial === null ? 'null' : `'${serial}'`},${mac === null ? 'null' : `'${mac}'`});`);
    return id;
  };
  const assign = (o: { id: string }, product = ont, serial: string | null = randomUUID(), mac: string | null = null) => {
    const unit = stocked(product, serial, mac);
    as(`select deliver_unit_to_technician('${unit}','${tech}','Prueba sintética');`, admin);
    as(op(o, unit));
    return unit;
  };
  const closeSql = (o: { id: string }, mode: string | null) => `update installations set status='completed',iptv_installation_mode=${mode === null ? 'null' : `'${mode}'`} where id='${o.id}';`;
  const preflight = (o: { id: string; contract: string }, mode: string | null) => `select installation_iptv_preflight('${o.id}','${o.contract}',${mode === null ? 'null' : `'${mode}'`});`;
  const reject = (o: { id: string; contract: string }, mode: string | null, message: RegExp, early = true) => {
    const before = orderState(o.id), inv = immutable();
    if (early) assert.throws(() => as(preflight(o, mode)), message);
    assert.throws(() => as(closeSql(o, mode)), message);
    assert.equal(orderState(o.id), before); assert.equal(immutable(), inv);
  };
  const held = async (s: string) => {
    const child = spawn('docker', psql, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const done = new Promise<void>((resolve, reject) => {
      child.stderr.on('data', b => { err += b; });
      child.on('error', reject);
      child.on('exit', code => code === 0 ? resolve() : reject(new Error(err)));
    });
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No se obtuvo el bloqueo de prueba')), 8000);
      child.stdout.on('data', b => { out += b; if (out.includes('IPTV_LOCK_HELD')) { clearTimeout(timer); resolve(); } });
      done.catch(e => { clearTimeout(timer); reject(e); });
    });
    child.stdin.end(`begin;${session(s)}select 'IPTV_LOCK_HELD';select pg_sleep(1);commit;`);
    await ready;
    return { done };
  };
  try {
    docker(['run', '--rm', '--pull=never', '-d', '--name', container, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
    let ready = false;
    for (let i = 0; i < 60; i++) { try { docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    assert.ok(ready); assert.equal(live.readOnly, 'on');
    sql(file('./closedOrdersSchema.sql'));
    sql(`alter table installations add column client_id uuid references clients(id),add column contract_id uuid;
      alter table routines add column client_id uuid references clients(id),add column contract_id uuid;
      alter table profiles add column full_name text,add column email text;
      alter table inventory_units add column pending_pickup_by uuid references profiles(id);
      alter table inventory_unit_events add column assigned_to uuid references profiles(id);
      create type contract_service_type as enum('internet_combo','solo_iptv');
      create table service_contracts(id uuid primary key,client_id uuid references clients(id),service_type contract_service_type default 'internet_combo',zone_id uuid,xui_line_id integer);
      create table fo_nap_puertos(contract_id uuid,estado text);
      insert into inventory_categories(slug) values('tvbox');
      insert into inventory_products(id,name,is_serialized,category_id) values('${tv}','TV Box sintético',true,(select id from inventory_categories where slug='tvbox'));
      alter table inventory_movements enable row level security;
      create policy moves_fixture on inventory_movements for all to authenticated using(true) with check(true);
      alter table inventory_unit_events enable row level security;
      create policy events_fixture on inventory_unit_events for all to authenticated using(true) with check(true);
      alter table installations enable row level security;
      create policy orders_fixture on installations for all to authenticated using(true) with check(true);`);
    sql(currentRole);
    sql(file('../../supabase/migrations/20261012150000_fase151_proteger_ordenes_cerradas.sql'));
    sql(`create trigger fixture_event_apply before insert on inventory_unit_events for each row execute function apply_inventory_unit_event();
      create trigger fixture_material_apply before insert on inventory_movements for each row execute function apply_inventory_movement();`);
    sql(file('../../supabase/migrations/20261016010000_campo_inventory_operations.sql'));
    sql(file('../../supabase/migrations/20261015180000_fase162_inventario_rutinas.sql'));
    sql("alter type inventory_unit_status add value 'with_technician';");
    sql("alter type inventory_unit_status add value 'pending_return';");
    sql(file('../../supabase/migrations/20261017030000_fase164_custodia_tecnicos.sql'));
    const custodyBase = file('../../scripts/rollback-campo-installation-custody-only.sql');
    sql(custodyBase.slice(custodyBase.indexOf('CREATE OR REPLACE FUNCTION'), custodyBase.lastIndexOf('COMMIT;')));
    sql(file('../../scripts/prepare-campo-installation-custody-only.sql'));
    sql(live.completionFunction);
    sql('create trigger trg_installations_validate_completion before update on installations for each row execute function validate_installation_completion();');
    const old = make();
    const historyOrder = make(); assign(historyOrder); assign(historyOrder, tv);
    as(`update installations set status='completed' where id='${historyOrder.id}';`);
    const historical = historyOrder.id, cancelled = randomUUID();
    sql(`insert into installations(id,status,client_id,contract_id) values('${cancelled}','cancelled','${client}','${old.contract}');`);
    const beforeOld = orderState(old.id), beforeHistorical = orderState(historical), beforeCancelled = orderState(cancelled), beforeInventory = immutable();
    sql(migration);

    await t.test('migración no cambia filas previas, equipos, movimientos ni custodia', () => {
      for (const [id, before] of [[old.id, beforeOld], [historical, beforeHistorical], [cancelled, beforeCancelled]]) {
        assert.equal(sql(`select to_jsonb(i)-'iptv_policy_version'-'iptv_installation_mode' from installations i where id='${id}';`), sql(`select '${before.replaceAll("'", "''")}'::jsonb;`));
        assert.equal(sql(`select iptv_policy_version is null and iptv_installation_mode is null from installations where id='${id}';`), 't');
      }
      assert.equal(immutable(), beforeInventory);
    });
    await t.test('API no permite quitar la versión, falsificarla ni insertar una orden cerrada', () => {
      const o = make();
      assert.equal(sql(`select iptv_policy_version from installations where id='${o.id}';`), '1');
      assert.throws(() => as(`update installations set iptv_policy_version=null where id='${o.id}';`), /no se puede cambiar/);
      const id = randomUUID();
      as(`insert into installations(id,client_id,contract_id,iptv_policy_version) values('${id}','${client}','${o.contract}',null);`);
      assert.equal(sql(`select iptv_policy_version from installations where id='${id}';`), '1');
      assert.throws(() => as(`insert into installations(client_id,contract_id,status) values('${client}','${o.contract}','completed');`), /Alta abierta/);
    });
    for (const mode of ['smart_tv_app', 'customer_device']) {
      await t.test(`${mode}: cierre con ONT y sin inventario TV Box, sin nuevos movimientos`, () => {
        const o = make(); assign(o); const before = immutable();
        assert.equal(JSON.parse(as(preflight(o, mode))).valid, true);
        as(closeSql(o, mode)); assert.equal(immutable(), before);
        assert.equal(JSON.parse(orderState(o.id)).iptv_installation_mode, mode);
        assert.equal(JSON.parse(orderState(o.id)).status, 'completed');
        assert.throws(() => as(`update installations set iptv_installation_mode='rayco_tv_box' where id='${o.id}';`), /orden cerrada/);
      });
    }
    await t.test('TV Box Rayco: custodia real e idempotencia de asignación; cierre conserva inventario', () => {
      const o = make(); assign(o); const unit = stocked();
      as(`select deliver_unit_to_technician('${unit}','${tech}','Prueba');`, admin);
      const operation = randomUUID(), first = as(op(o, unit, operation));
      assert.equal(as(op(o, unit, operation)), first);
      const inv = immutable(); as(preflight(o, 'rayco_tv_box')); as(closeSql(o, 'rayco_tv_box'));
      assert.equal(immutable(), inv);
      assert.equal(sql(`select count(*) from inventory_unit_events where unit_id='${unit}' and to_status='assigned';`), '1');
    });
    await t.test('TV Box solo MAC es válido; la serie no se inventa', () => {
      const o = make(); assign(o); assign(o, tv, null, 'AA:BB:CC:DD:EE:01');
      as(preflight(o, 'rayco_tv_box')); as(closeSql(o, 'rayco_tv_box'));
    });
    await t.test('Rayco exige equipo, identidad y constancia de custodia', () => {
      const o = make(); assign(o); reject(o, 'rayco_tv_box', /serie\/MAC desde custodia/);
      const u = stocked();
      // Estado inconsistente sintético, solo superusuario de la base efímera.
      sql(`update inventory_units set status='assigned',client_id='${client}',contract_id='${o.contract}',installation_id='${o.id}' where id='${u}';`);
      reject(o, 'rayco_tv_box', /serie\/MAC desde custodia/);
      const o2 = make(); assign(o2); assign(o2, tv, '   ', null); reject(o2, 'rayco_tv_box', /serie\/MAC desde custodia/);
    });
    await t.test('sin modalidad o modalidad inválida rechaza preflight y UPDATE sin escribir', () => {
      const o = make(); assign(o);
      reject(o, null, /Selecciona cómo/); reject(o, 'inventada', /Selecciona cómo/);
    });
    await t.test('Smart TV/dispositivo propio no ocultan TV Box ya vinculado', () => {
      const o = make(); assign(o); assign(o, tv);
      reject(o, 'smart_tv_app', /TV Box Rayco vinculado/); reject(o, 'customer_device', /TV Box Rayco vinculado/);
    });
    await t.test('ONT, Zona y NAP continúan obligatorias por API', () => {
      const o = make(); reject(o, 'smart_tv_app', /ONT\/Módem/, false); assign(o);
      sql(`update service_contracts set zone_id=null where id='${o.contract}';`);
      reject(o, 'smart_tv_app', /asignar la Zona/, false);
      sql(`update service_contracts set zone_id=gen_random_uuid() where id='${o.contract}';delete from fo_nap_puertos where contract_id='${o.contract}';`);
      reject(o, 'smart_tv_app', /Caja NAP/, false);
    });
    await t.test('TV Box de otra línea del mismo cliente no satisface Rayco', () => {
      const a = make(), b = make(); assign(a); assign(b, tv); reject(a, 'rayco_tv_box', /serie\/MAC desde custodia/);
    });
    await t.test('TV Box con estado, cliente o contrato incoherente nunca habilita cierre Rayco', () => {
      const o = make(); assign(o); const u = assign(o, tv);
      for (const status of ['pending_approval','with_technician','pending_return','in_stock']) {
        sql(`update inventory_units set status='${status}' where id='${u}';`);
        reject(o, 'rayco_tv_box', /serie\/MAC desde custodia/);
      }
      const other = make();
      sql(`update inventory_units set status='assigned',contract_id='${other.contract}' where id='${u}';`);
      reject(o, 'rayco_tv_box', /serie\/MAC desde custodia/);
      const foreignClient = randomUUID();
      sql(`insert into clients(id) values('${foreignClient}');update inventory_units set contract_id='${o.contract}',client_id='${foreignClient}' where id='${u}';`);
      reject(o, 'rayco_tv_box', /serie\/MAC desde custodia/);
    });
    await t.test('legacy abierto conserva obligación anterior; históricos cerrados sin nueva modalidad', () => {
      assign(old);
      assert.throws(() => as(`update installations set status='completed' where id='${old.id}';`), /incluye IPTV/);
      assert.throws(() => as(`update installations set iptv_installation_mode='smart_tv_app' where id='${old.id}';`), /órdenes anteriores/);
      assert.throws(() => as(`update installations set iptv_installation_mode='smart_tv_app' where id='${historical}';`, admin), /órdenes anteriores/);
      assign(old, tv); as(`update installations set status='completed' where id='${old.id}';`);
    });
    await t.test('solo Internet y solo IPTV conservan reglas anteriores', () => {
      const net = make(null); assign(net); as(preflight(net, null)); as(closeSql(net, null));
      const iptv = make(66, 'solo_iptv'); as(preflight(iptv, null)); as(closeSql(iptv, null));
    });
    await t.test('preflight respeta perfil y cuadrilla; validador interno no es ejecutable', () => {
      const o = make(); assign(o);
      assert.throws(() => sql(`set role anon;${preflight(o, 'smart_tv_app')}`), /permission denied/);
      assert.throws(() => sql(`set role service_role;${preflight(o, 'smart_tv_app')}`), /permission denied/);
      assert.throws(() => as(`select assert_installation_iptv_mode('${o.id}','${client}','${o.contract}','smart_tv_app');`), /permission denied/);
      sql(`delete from job_assignees where job_id='${o.id}';`);
      assert.throws(() => as(preflight(o, 'smart_tv_app')), /Asignacion no vigente/);
    });
    await t.test('concurrencia: asignación gana; el cierre por app detecta el TV Box', async () => {
      const o = make(); assign(o); const u = stocked();
      as(`select deliver_unit_to_technician('${u}','${tech}','Prueba');`, admin);
      const { done } = await held(op(o, u));
      assert.throws(() => as(closeSql(o, 'smart_tv_app')), /TV Box Rayco vinculado/);
      await done;
      assert.equal(JSON.parse(orderState(o.id)).status, 'in_progress');
    });
    await t.test('concurrencia: cierre gana; no se asigna TV Box a la orden completada', async () => {
      const o = make(); assign(o); const u = stocked();
      as(`select deliver_unit_to_technician('${u}','${tech}','Prueba');`, admin);
      const before = immutable(), { done } = await held(closeSql(o, 'smart_tv_app'));
      assert.throws(() => as(op(o, u)), /no admite nuevas operaciones/);
      await done; assert.equal(immutable(), before);
    });
    await t.test('concurrencia: dos modalidades no sobrescriben un cierre ya confirmado', async () => {
      const o = make(); assign(o); const { done } = await held(closeSql(o, 'smart_tv_app'));
      assert.throws(() => as(closeSql(o, 'customer_device')), /orden cerrada/);
      await done; assert.equal(JSON.parse(orderState(o.id)).iptv_installation_mode, 'smart_tv_app');
    });
    await t.test('rollback y reaplicación sin borrar modalidades, historial ni inventario', () => {
      const snapshot = sql('select jsonb_agg(i order by id) from installations i;'), inventory = immutable();
      sql(rollback);
      assert.equal(sql('select jsonb_agg(i order by id) from installations i;'), snapshot); assert.equal(immutable(), inventory);
      assert.equal(sql(`select to_regprocedure('installation_iptv_preflight(uuid,uuid,text)') is null;`), 't');
      sql(migration);
      assert.equal(sql('select jsonb_agg(i order by id) from installations i;'), snapshot); assert.equal(immutable(), inventory);
    });
  } finally { try { docker(['stop', container]); } catch { /* solo contenedor propio */ } }
});
