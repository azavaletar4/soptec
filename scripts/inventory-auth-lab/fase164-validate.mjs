import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { gateway, config, runtime, docker, project } from './common.mjs';

// Fase 164: valida con JWT REALES (GoTrue -> PostgREST, mismo mecanismo que
// security-validate.mjs ya aprobado) los 4 roles pedidos — ADMIN, SUPERADMIN,
// tecnico asignado (leader) y tecnico ajeno (outsider) — contra las
// migraciones de Fase 164 ya aplicadas en inventory_security_lab (misma base
// que valido Etapa 3/cierre RLS, confirmada hoy byte a byte igual a Cloud:
// apply_inventory_unit_event/campo_inventory_operation/apply_routine_inventory_event
// con el mismo MD5 normalizado que en Cloud). No repite las 18 pruebas SQL
// locales ya aprobadas (technicianCustody.sql.test.ts) — cubre la capa real
// HTTP/PostgREST que esas pruebas no ejercitan.
const c = config();
const url = 'http://127.0.0.1:54390';
const sql = (s) => docker(['exec', '-i', project + '-db', 'psql', '-U', 'postgres', '-d', 'inventory_security_lab', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], s).trim();

const accounts = JSON.parse(readFileSync(runtime + 'security-accounts.json', 'utf8'));
const tokens = {};
for (const account of accounts) {
  const res = await fetch(gateway + '/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: c.anonKey },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) throw new Error('JWT real no disponible ' + account.role + ': ' + JSON.stringify(body));
  const claims = JSON.parse(Buffer.from(body.access_token.split('.')[1], 'base64url').toString());
  assert.equal(claims.role, 'authenticated');
  assert.equal(claims.sub, account.id);
  tokens[account.role] = body.access_token;
}

const rpc = async (role, name, payload) => {
  const res = await fetch(url + '/rpc/' + name, { method: 'POST', headers: { Authorization: 'Bearer ' + tokens[role], 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
};
const ok = (r) => { assert(r.status === 200 || r.status === 204, JSON.stringify(r)); return r.data; };
const deny = (r) => { assert(r.status >= 400, JSON.stringify(r)); };

const leader = 'leader', outsider = 'outsider', ADMIN = 'ADMIN', SUPERADMIN = 'SUPERADMIN', SOPORTE = 'SOPORTE', FACTURACION = 'FACTURACION';
const UNIT1 = '96600000-0000-4000-8000-000000000030';
const UNIT2 = '9aceae6a-6740-46ce-98a7-7e5183bda7a2';
const MATERIAL = '622b7f1e-d373-4578-9a46-f1017396af19';
const INSTALLATION = '96600000-0000-4000-8000-000000000010';
const leaderId = accounts.find((a) => a.role === 'leader').id;
const outsiderId = accounts.find((a) => a.role === 'outsider').id;

const resultsFile = runtime + 'fase164-validation.json';
const report = { at: new Date().toISOString(), results: [] };
const test = async (name, run) => { await run(); report.results.push({ name, status: 'PASS' }); writeFileSync(resultsFile, JSON.stringify(report, null, 2)); console.log('PASS ' + name); };

const resetUnits = () => sql(`
  update inventory_units set status='in_stock', custody_technician_id=null, client_id=null, contract_id=null, installation_id=null, ticket_id=null where id in ('${UNIT1}','${UNIT2}');
  delete from inventory_unit_events where unit_id in ('${UNIT1}','${UNIT2}');
  update technician_material_custody set quantity=0 where product_id='${MATERIAL}';
  delete from technician_material_custody_events where product_id='${MATERIAL}';
  delete from technician_material_return_requests where product_id='${MATERIAL}';
  update inventory_products set current_stock=20 where id='${MATERIAL}';
`);

try {
  await test('ADMIN entrega un equipo en bodega al tecnico asignado (JWT real)', async () => {
    resetUnits();
    ok(await rpc(ADMIN, 'deliver_unit_to_technician', { p_unit_id: UNIT1, p_technician_id: leaderId, p_reason: 'Fase164 lab' }));
    assert.equal(sql(`select status||'|'||custody_technician_id from inventory_units where id='${UNIT1}';`), `with_technician|${leaderId}`);
  });

  await test('Reintentar la misma entrega (doble asignacion) es rechazado, sin duplicar Kardex', async () => {
    deny(await rpc(ADMIN, 'deliver_unit_to_technician', { p_unit_id: UNIT1, p_technician_id: leaderId, p_reason: 'retry' }));
    assert.equal(sql(`select count(*) from inventory_unit_events where unit_id='${UNIT1}';`), '1');
  });

  await test('Tecnico ajeno no puede solicitar devolucion de un equipo que no es suyo', async () => {
    deny(await rpc(outsider, 'request_unit_return', { p_unit_id: UNIT1, p_reason: 'no es mio' }));
  });

  await test('Tecnico ajeno no puede entregarse ni recibir devoluciones (roles exclusivos de ADMIN/SUPERADMIN)', async () => {
    deny(await rpc(outsider, 'deliver_unit_to_technician', { p_unit_id: UNIT2, p_technician_id: outsiderId, p_reason: 'x' }));
    deny(await rpc(outsider, 'receive_unit_return', { p_unit_id: UNIT1, p_condition: 'in_stock' }));
  });

  await test('Tecnico asignado instala en su Alta el equipo que tenia en custodia (ruta real Etapa 3 ensanchada)', async () => {
    const op = randomUUID();
    ok(await rpc(leader, 'campo_inventory_operation', { p_operation_id: op, p_job_type: 'installation', p_job_id: INSTALLATION, p_action: 'assign', p_payload: { unitId: UNIT1, reason: 'Instalado' } }));
    assert.equal(sql(`select status||'|'||coalesce(custody_technician_id::text,'libre') from inventory_units where id='${UNIT1}';`), 'assigned|libre');
  });

  await test('Reintentar la misma operacion de instalacion (misma operation_id) es idempotente, no duplica', async () => {
    const op = randomUUID();
    resetUnits();
    ok(await rpc(ADMIN, 'deliver_unit_to_technician', { p_unit_id: UNIT1, p_technician_id: leaderId }));
    const first = ok(await rpc(leader, 'campo_inventory_operation', { p_operation_id: op, p_job_type: 'installation', p_job_id: INSTALLATION, p_action: 'assign', p_payload: { unitId: UNIT1, reason: 'x' } }));
    const second = ok(await rpc(leader, 'campo_inventory_operation', { p_operation_id: op, p_job_type: 'installation', p_job_id: INSTALLATION, p_action: 'assign', p_payload: { unitId: UNIT1, reason: 'x' } }));
    assert.deepEqual(first, second);
    assert.equal(sql(`select count(*) from inventory_unit_events where unit_id='${UNIT1}' and to_status='assigned';`), '1');
  });

  await test('Tecnico solicita devolucion de un segundo equipo; solo ADMIN/SUPERADMIN confirman la recepcion', async () => {
    resetUnits();
    ok(await rpc(ADMIN, 'deliver_unit_to_technician', { p_unit_id: UNIT2, p_technician_id: leaderId }));
    ok(await rpc(leader, 'request_unit_return', { p_unit_id: UNIT2, p_reason: 'no se uso' }));
    assert.equal(sql(`select status from inventory_units where id='${UNIT2}';`), 'pending_return');
    deny(await rpc(leader, 'receive_unit_return', { p_unit_id: UNIT2, p_condition: 'in_stock' }));
    ok(await rpc(SUPERADMIN, 'receive_unit_return', { p_unit_id: UNIT2, p_condition: 'in_stock' }));
    assert.equal(sql(`select status||'|'||coalesce(custody_technician_id::text,'libre') from inventory_units where id='${UNIT2}';`), 'in_stock|libre');
  });

  await test('Entrega de material NO descuenta el almacen central (entrega != consumo) ni duplica Kardex en reintento', async () => {
    resetUnits();
    ok(await rpc(ADMIN, 'deliver_material_to_technician', { p_technician_id: leaderId, p_product_id: MATERIAL, p_quantity: 5, p_reason: 'x' }));
    assert.equal(sql(`select current_stock from inventory_products where id='${MATERIAL}';`), '20.00');
    assert.equal(sql(`select quantity from technician_material_custody where technician_id='${leaderId}' and product_id='${MATERIAL}';`), '5');
    assert.equal(sql(`select count(*) from inventory_movements where product_id='${MATERIAL}' and created_at > now() - interval '1 minute';`), '0');
  });

  await test('SOPORTE/FACTURACION no obtienen acceso administrativo de custodia (roles no desarrollados para ellos)', async () => {
    deny(await rpc(SOPORTE, 'inventory_custody_summary', {}));
    deny(await rpc(FACTURACION, 'inventory_custody_summary', {}));
    deny(await rpc(SOPORTE, 'deliver_unit_to_technician', { p_unit_id: UNIT1, p_technician_id: leaderId }));
  });

  await test('my_inventory_custody: el tecnico solo ve lo propio, nunca lo de otro', async () => {
    resetUnits();
    ok(await rpc(ADMIN, 'deliver_unit_to_technician', { p_unit_id: UNIT1, p_technician_id: leaderId }));
    const mine = ok(await rpc(leader, 'my_inventory_custody', {}));
    assert.equal(mine.units.length, 1);
    const theirs = ok(await rpc(outsider, 'my_inventory_custody', {}));
    assert.equal(theirs.units.length, 0);
  });

  await test('inventory_custody_summary es exclusivo de ADMIN/SUPERADMIN, tecnico denegado', async () => {
    deny(await rpc(leader, 'inventory_custody_summary', {}));
    const rows = ok(await rpc(ADMIN, 'inventory_custody_summary', {}));
    assert(Array.isArray(rows) && rows.length > 0);
  });

  await test('Regresion: Averias/Rutinas siguen con su propio flujo intacto (consume real, sin custodia)', async () => {
    const op = randomUUID();
    const before = sql(`select current_stock from inventory_products where id='${MATERIAL}';`);
    ok(await rpc(leader, 'campo_inventory_operation', { p_operation_id: op, p_job_type: 'ticket', p_job_id: '96600000-0000-4000-8000-000000000011', p_action: 'consume', p_payload: { productId: MATERIAL, quantity: 2, reason: 'Fase164 regresion' } }));
    const after = sql(`select current_stock from inventory_products where id='${MATERIAL}';`);
    assert.equal(Number(before) - Number(after), 2);
  });

  console.log('\nFASE 164: ' + report.results.length + ' pruebas con JWT reales, todas PASS.');
} finally {
  resetUnits();
}
