// Circuito integrado REAL (Alta/Averia/Rutina) contra el laboratorio aislado:
// Postgres restaurado, GoTrue y PostgREST reales, JWT reales por login.
// Sin mocks de negocio. Nunca toca produccion/OLT/MikroTik.
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { config, root, sql, localFetch, wait } from './custody-integral-lab-common.mjs';
import fs from 'node:fs';

const c = config();
const fixture = JSON.parse(fs.readFileSync(path.join(c.directory, 'fixture.json'), 'utf8'));
const material = fixture.material;
const results = [];
const pass = (name) => { results.push({ name, status: 'PASS' }); console.log('PASS ' + name); };

function clientFor(jwt) {
  return createClient(c.gateway, c.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: localFetch, headers: jwt ? { Authorization: 'Bearer ' + jwt } : {} },
  });
}

async function login(role) {
  const account = c.accounts.find(a => a.role === role);
  const anon = createClient(c.gateway, c.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: localFetch } });
  const { data, error } = await anon.auth.signInWithPassword({ email: account.email, password: account.password });
  if (error) throw Error('LOGIN_FAILED_' + role + '_' + error.message);
  return data.session.access_token;
}

function custodyOf(technicianId, productId) {
  return Number(sql(`select coalesce((select quantity from technician_material_custody where technician_id='${technicianId}' and product_id='${productId}'),0);`));
}

// Reinicio idempotente del estado de custodia del laboratorio (solo datos
// sinteticos d1650000-%, nunca produccion): permite reintentar este guion
// completo sin recrear el laboratorio entero.
// El Kardex (inventory_movements) y sus recibos de operacion son
// insert-only por diseno (ver guard_routine_inventory_movement) -- nunca se
// borran, ni siquiera en el laboratorio. Solo se reinicia la custodia (no
// forma parte del Kardex); UUID de operacion nuevos en cada corrida evitan
// cualquier colision con movimientos de una corrida anterior.
sql(`delete from technician_material_custody_events where technician_id in ('${fixture.users.leader}','${fixture.users.support}');`);
sql(`delete from technician_material_custody where technician_id in ('${fixture.users.leader}','${fixture.users.support}');`);
sql(`delete from technician_material_return_requests where technician_id in ('${fixture.users.leader}','${fixture.users.support}');`);
sql(`delete from material_inventory_rejections where job_id::text like 'd1650000-%';`);

const adminJwt = await login('admin');
const leaderJwt = await login('leader');
const supportJwt = await login('support');
const admin = clientFor(adminJwt);
const leader = clientFor(leaderJwt);
const support = clientFor(supportJwt);
const leaderId = fixture.users.leader, supportId = fixture.users.support;

// ===================== 1) Entrega administrativa =====================
{
  const before = custodyOf(leaderId, material);
  assert.equal(before, 0);
  const { error } = await admin.rpc('deliver_material_to_technician', {
    p_technician_id: leaderId, p_product_id: material, p_quantity: 30, p_reason: 'Entrega de prueba laboratorio integral',
  });
  assert.equal(error, null, JSON.stringify(error));
  assert.equal(custodyOf(leaderId, material), 30);
  pass('entrega administrativa real: 0 -> 30 en technician_material_custody');
}

// ===================== 2) Consulta de disponibilidad (tecnico) =====================
{
  const { data, error } = await leader.rpc('my_inventory_custody');
  assert.equal(error, null, JSON.stringify(error));
  const row = data.materials.find(m => m.product.id === material);
  assert.equal(row.quantity, 30);
  pass('consulta de disponibilidad real: my_inventory_custody refleja la entrega');
}

// ===================== 3) Consumo valido en Alta/Averia/Rutina =====================
const jobs = { installation: fixture.jobs.find(j => j.kind === 'installation' && j.materials), ticket: fixture.jobs.find(j => j.kind === 'ticket' && j.materials), routine: fixture.jobs.find(j => j.kind === 'routine' && j.materials) };
sql(`update routines set status='in_progress' where id='${jobs.routine.id}';`);

const movementOf = {};
for (const kind of ['installation', 'ticket', 'routine']) {
  const job = jobs[kind];
  const opId = crypto.randomUUID();
  if (kind === 'routine') {
    const { data, error } = await leader.rpc('routine_inventory_operation', { p_routine_id: job.id, p_operation_id: opId, p_action: 'consume', p_payload: { product_id: material, quantity: 4 } });
    assert.equal(error, null, JSON.stringify(error));
    movementOf[kind] = data.movement_or_event_id;
  } else {
    const { data, error } = await leader.rpc('campo_inventory_operation', { p_operation_id: opId, p_job_type: kind, p_job_id: job.id, p_action: 'consume', p_payload: { productId: material, quantity: 4 } });
    assert.equal(error, null, JSON.stringify(error));
    movementOf[kind] = data.ids[0];
  }
  pass('consumo valido real (' + kind + '): egreso de 4 registrado via RPC real');
}
assert.equal(custodyOf(leaderId, material), 18); // 30 - 4*3
pass('custodia descontada correctamente tras los 3 consumos (30 -> 18)');

// ===================== 4) Consumo insuficiente: rechazo controlado (no error SQL) + bloqueo de cierre =====================
// Candidato 20261019170000: la falta de custodia ya NO revienta el RPC con
// un error -- queda registrada en material_inventory_rejections y la orden
// no puede cerrarse hasta resolverla (reintento valido o anulacion admin).
const rejectedOpId = crypto.randomUUID();
{
  const { data, error } = await leader.rpc('campo_inventory_operation', { p_operation_id: rejectedOpId, p_job_type: 'installation', p_job_id: jobs.installation.id, p_action: 'consume', p_payload: { productId: material, quantity: 100 } });
  assert.equal(error, null, JSON.stringify(error));
  assert.equal(data.materialRejected, true);
  assert.equal(custodyOf(leaderId, material), 18);
  assert.equal(sql(`select status from material_inventory_rejections where operation_id='${rejectedOpId}';`), 'pending');
  pass('consumo insuficiente real: rechazo controlado (materialRejected), custodia intacta en 18');
}
{
  const { error } = await leader.rpc('assert_material_closure_ready', { p_job_type: 'installation', p_job_id: jobs.installation.id });
  assert.ok(error);
  assert.equal(error.code, 'P1651');
  pass('cierre bloqueado real mientras el rechazo siga pendiente (P1651)');
}
const rejectedQuantity = 100;
{
  // La misma clave de operacion SOLO se puede reintentar con la MISMA carga
  // exacta (el propio candidato lo exige: "Identificador de operacion ya
  // utilizado" si cambia el payload) -- el reintento real es "pide la
  // entrega y reintenta la MISMA operacion", no cambiar la cantidad.
  const { error: deliverErr } = await admin.rpc('deliver_material_to_technician', { p_technician_id: leaderId, p_product_id: material, p_quantity: 90, p_reason: 'Entrega adicional tras rechazo' });
  assert.equal(deliverErr, null, JSON.stringify(deliverErr));
  const { data, error } = await leader.rpc('campo_inventory_operation', { p_operation_id: rejectedOpId, p_job_type: 'installation', p_job_id: jobs.installation.id, p_action: 'consume', p_payload: { productId: material, quantity: rejectedQuantity } });
  assert.equal(error, null, JSON.stringify(error));
  assert.ok(data.ids?.length, JSON.stringify(data));
  assert.equal(custodyOf(leaderId, material), 8); // 18 + 90 - 100
  assert.equal(sql(`select status from material_inventory_rejections where operation_id='${rejectedOpId}';`), 'resolved');
  const closure = await leader.rpc('assert_material_closure_ready', { p_job_type: 'installation', p_job_id: jobs.installation.id });
  assert.equal(closure.error, null, JSON.stringify(closure.error));
  pass('reintento con la MISMA clave y la misma carga, tras entrega adicional, resuelve el rechazo y desbloquea el cierre real');
  movementOf.installation = data.ids[0];
}

// ===================== 4b) Anulacion administrativa de un intento rechazado =====================
{
  const opId = crypto.randomUUID();
  const { data } = await leader.rpc('campo_inventory_operation', { p_operation_id: opId, p_job_type: 'ticket', p_job_id: jobs.ticket.id, p_action: 'consume', p_payload: { productId: material, quantity: 500 } });
  assert.equal(data.materialRejected, true);
  const { error: supportErr } = await support.rpc('cancel_rejected_material_operation', { p_operation_id: opId, p_reason: 'Intento ajeno' });
  assert.ok(supportErr, 'un tecnico (support) no es administracion: no puede anular un intento rechazado');
  const { error: cancelErr } = await admin.rpc('cancel_rejected_material_operation', { p_operation_id: opId, p_reason: 'Pedido equivocado en laboratorio' });
  assert.equal(cancelErr, null, JSON.stringify(cancelErr));
  assert.equal(sql(`select status,resolution_note from material_inventory_rejections where operation_id='${opId}';`), 'cancelled|Pedido equivocado en laboratorio');
  const retry = await leader.rpc('campo_inventory_operation', { p_operation_id: opId, p_job_type: 'ticket', p_job_id: jobs.ticket.id, p_action: 'consume', p_payload: { productId: material, quantity: 500 } });
  assert.equal(retry.error, null, JSON.stringify(retry.error));
  assert.equal(retry.data.materialCancelled, true);
  const closure = await leader.rpc('assert_material_closure_ready', { p_job_type: 'ticket', p_job_id: jobs.ticket.id });
  assert.equal(closure.error, null, JSON.stringify(closure.error));
  assert.equal(custodyOf(leaderId, material), 8);
  pass('administracion anula un intento rechazado con motivo; reintento ya no vuelve a ejecutarlo, cierre queda desbloqueado');
}

// ===================== 5) Reintento idempotente (misma clave, misma carga) =====================
{
  const opId = crypto.randomUUID();
  const payload = { productId: material, quantity: 3, reason: 'idempotencia' };
  const first = await leader.rpc('campo_inventory_operation', { p_operation_id: opId, p_job_type: 'ticket', p_job_id: jobs.ticket.id, p_action: 'consume', p_payload: payload });
  assert.equal(first.error, null);
  const afterFirst = custodyOf(leaderId, material);
  const second = await leader.rpc('campo_inventory_operation', { p_operation_id: opId, p_job_type: 'ticket', p_job_id: jobs.ticket.id, p_action: 'consume', p_payload: payload });
  assert.equal(second.error, null);
  assert.deepEqual(first.data, second.data);
  assert.equal(custodyOf(leaderId, material), afterFirst);
  pass('reintento con misma clave/misma carga no duplica consumo ni custodia');
  // Reversa ese consumo de prueba para no afectar las siguientes cifras.
  const baseline = afterFirst + 3;
  await leader.rpc('campo_inventory_operation', { p_operation_id: crypto.randomUUID(), p_job_type: 'ticket', p_job_id: jobs.ticket.id, p_action: 'reverse', p_payload: { movementId: first.data.ids[0] } });
  assert.equal(custodyOf(leaderId, material), baseline);
}

// ===================== 6) Correccion (atribuida al tecnico original del consumo) =====================
{
  const before = custodyOf(leaderId, material);
  const originalQty = rejectedQuantity; // movementOf.installation viene del reintento resuelto en el paso 4
  const correctionOpId = crypto.randomUUID();
  const { data, error } = await leader.rpc('campo_inventory_operation', { p_operation_id: correctionOpId, p_job_type: 'installation', p_job_id: jobs.installation.id, p_action: 'correct', p_payload: { movementId: movementOf.installation, quantity: 2 } });
  assert.equal(error, null, JSON.stringify(error));
  movementOf.installation = data.ids[1];
  assert.equal(custodyOf(leaderId, material), before + originalQty - 2); // repone la cantidad original, descuenta la corregida
  pass('correccion real: repone ' + originalQty + ' y descuenta 2, custodia ' + before + ' -> ' + (before + originalQty - 2) + ', atribuida al tecnico original');
}

// ===================== 7) Reversion completa =====================
{
  const before = custodyOf(leaderId, material);
  const { error } = await leader.rpc('campo_inventory_operation', { p_operation_id: crypto.randomUUID(), p_job_type: 'installation', p_job_id: jobs.installation.id, p_action: 'reverse', p_payload: { movementId: movementOf.installation } });
  assert.equal(error, null, JSON.stringify(error));
  assert.equal(custodyOf(leaderId, material), before + 2);
  pass('reversion completa real: custodia repuesta (' + before + ' -> ' + (before + 2) + ')');
}

// ===================== 8) Consumo historico (sin control de custodia) no se repone ni bloquea =====================
{
  const historicMovementId = sql(`insert into inventory_movements(product_id,movement_type,quantity,reason,ticket_id,created_by) values('${material}','egreso',7,'Consumo historico anterior a Fase165 etapa2','${jobs.ticket.id}','${leaderId}') returning id;`);
  const before = custodyOf(leaderId, material);
  const { error } = await leader.rpc('campo_inventory_operation', { p_operation_id: crypto.randomUUID(), p_job_type: 'ticket', p_job_id: jobs.ticket.id, p_action: 'correct', p_payload: { movementId: historicMovementId, quantity: 5 } });
  assert.equal(error, null, JSON.stringify(error));
  assert.equal(custodyOf(leaderId, material), before, 'un consumo historico sin rastro de custodia NUNCA debe tocar la custodia al corregirse');
  assert.equal(sql(`select count(*) from technician_material_custody_events where source_movement_id='${historicMovementId}';`), '0');
  pass('consumo historico sin custodia rastreada: la correccion no repone ni bloquea, custodia intacta (' + before + ')');
}

// ===================== 9) Concurrencia: dos consumos simultaneos cerca del limite =====================
{
  const remaining = custodyOf(leaderId, material);
  const half = remaining / 2;
  const quantities = { installation: half, ticket: half + 1 };
  const [r1, r2] = await Promise.all([
    leader.rpc('campo_inventory_operation', { p_operation_id: crypto.randomUUID(), p_job_type: 'installation', p_job_id: jobs.installation.id, p_action: 'consume', p_payload: { productId: material, quantity: quantities.installation } }),
    leader.rpc('campo_inventory_operation', { p_operation_id: crypto.randomUUID(), p_job_type: 'ticket', p_job_id: jobs.ticket.id, p_action: 'consume', p_payload: { productId: material, quantity: quantities.ticket } }),
  ]);
  assert.equal(r1.error, null, JSON.stringify(r1.error));
  assert.equal(r2.error, null, JSON.stringify(r2.error));
  const outcomes = [{ kind: 'installation', result: r1 }, { kind: 'ticket', result: r2 }];
  const rejected = outcomes.filter(o => o.result.data?.materialRejected);
  const executed = outcomes.filter(o => !o.result.data?.materialRejected);
  assert.equal(rejected.length, 1, 'con dos consumos que juntos exceden el saldo, exactamente uno debe quedar rechazado');
  assert.equal(executed.length, 1);
  assert.equal(custodyOf(leaderId, material), remaining - quantities[executed[0].kind]);
  pass('concurrencia real: dos consumos simultaneos serializados por el lock existente (gano ' + executed[0].kind + '), sin saldo negativo');
}

// ===================== 10) Devolucion de sobrante: solicitud + confirmacion =====================
{
  const leftover = custodyOf(leaderId, material);
  const { data: requestId, error: reqErr } = await leader.rpc('request_material_return', { p_product_id: material, p_quantity: leftover, p_reason: 'Fin de prueba laboratorio integral' });
  assert.equal(reqErr, null, JSON.stringify(reqErr));
  const { error: confirmErr } = await admin.rpc('confirm_material_return', { p_request_id: requestId, p_approved: true, p_note: 'Recepcion de prueba' });
  assert.equal(confirmErr, null, JSON.stringify(confirmErr));
  assert.equal(custodyOf(leaderId, material), 0);
  pass('devolucion real: solicitud del tecnico + confirmacion de administracion, custodia vuelve a 0');
}

// ===================== 11) Rechazo de devolucion no deja la solicitud "colgada" ni afecta custodia =====================
{
  await admin.rpc('deliver_material_to_technician', { p_technician_id: leaderId, p_product_id: material, p_quantity: 5, p_reason: 'Entrega para probar rechazo de devolucion' });
  const { data: requestId } = await leader.rpc('request_material_return', { p_product_id: material, p_quantity: 5, p_reason: 'Prueba de rechazo' });
  const { error } = await admin.rpc('confirm_material_return', { p_request_id: requestId, p_approved: false, p_note: 'Rechazada en prueba' });
  assert.equal(error, null, JSON.stringify(error));
  assert.equal(custodyOf(leaderId, material), 5);
  assert.equal(sql(`select status from technician_material_return_requests where id='${requestId}';`), 'rejected');
  pass('rechazo de devolucion real: custodia intacta en 5, solicitud queda "rejected"');
}

// ===================== 12) Permisos: otro tecnico (support) no ve ni usa la custodia de leader =====================
{
  const { data } = await support.rpc('my_inventory_custody');
  assert.equal((data.materials.find(m => m.product.id === material)?.quantity ?? 0), 0);
  const { error } = await support.rpc('request_material_return', { p_product_id: material, p_quantity: 1, p_reason: 'Intento ajeno' });
  assert.ok(error);
  pass('permisos reales: support no ve ni puede devolver la custodia de leader');
}

// ===================== Lectura contextual (consulta de disponibilidad por la ruta real del backend) =====================
let backend;
try {
  backend = spawn('node', ['--import', 'tsx', path.join(root, 'scripts/custody-integral-lab-backend.ts')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let ready = '';
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('backend timeout: ' + ready)), 20000);
    backend.stdout.on('data', b => { ready += b; if (ready.includes('CUSTODY_INTEGRAL_BACKEND_LOCAL_54423')) { clearTimeout(timeout); resolve(); } });
    backend.stderr.on('data', b => { ready += b; });
  });
  await wait(async () => (await localFetch(c.api + '/lab/config')).ok);
  const response = await localFetch(c.api + '/api/campo-inventory/ticket/' + jobs.ticket.id + '/materials', { headers: { Authorization: 'Bearer ' + leaderJwt } });
  const body = await response.text();
  assert.equal(response.status, 200, body);
  const page = JSON.parse(body);
  assert.equal(page.context.jobId, jobs.ticket.id);
  assert.equal(page.context.actorId, leaderId);
  pass('consulta de disponibilidad real via ruta HTTP del backend (inventory_order_read, JWT real)');
} finally {
  backend?.kill();
}

await writeFile(path.join(root, 'docs/CUSTODIA-ETAPA2-LABORATORIO-INTEGRAL-API.json'), JSON.stringify({
  at: new Date().toISOString(), scope: 'REAL_DB_REST_AUTH_NO_SIMULATION', lab: c.project, results,
}, null, 2) + '\n');
console.log('CUSTODY_INTEGRAL_API_CIRCUIT_REAL: ' + results.length + ' escenarios PASS');
