import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { readFieldInventory } from '../fieldInventory.ts';
import { fieldInventoryRoutes } from '../../routes/fieldInventory.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), job = id(2), client = id(3), contract = id(4), other = id(5), model = id(6);
function fixture(opts: { role?: string; active?: boolean; assigned?: boolean; teamRole?: string; status?: string; noContract?: boolean; revoke?: boolean } = {}) {
  const calls: { table: string; method: string; query: URLSearchParams }[] = [];
  let profileReads = 0;
  const unit = (n: number, extra: object = {}) => ({ id: id(n), product_id: model, serial_number: `SN${n}`, mac_address: `AA:${n}`, status: 'assigned', client_id: client, contract_id: contract, installation_id: job, ticket_id: job, notes: 'PRIVADO', product: { id: model, name: 'ONT', unit: 'unidad', price: 999 }, ...extra });
  const tables: Record<string, any[]> = {
    profiles: [{ id: actor, role: opts.role ?? 'TECNICO_RED', active: opts.active ?? true }],
    installations: [{ id: job, status: opts.status ?? 'in_progress', client_id: client, contract_id: opts.noContract ? null : contract }],
    tickets: [{ id: job, status: opts.status ?? 'in_progress', client_id: client, contract_id: opts.noContract ? null : contract }],
    job_assignees: opts.assigned === false ? [] : [{ job_id: job, job_type: 'installation', technician_id: actor, role: opts.teamRole ?? 'leader' }, { job_id: job, job_type: 'ticket', technician_id: actor, role: opts.teamRole ?? 'leader' }],
    service_contracts: [{ id: contract, client_id: client }, { id: other, client_id: client }],
    inventory_products: [{ id: model, name: 'ONT', unit: 'unidad', is_active: true, is_serialized: true, current_stock: 2, price: 999, inventory_categories: { slug: 'onu', total_value: 999 } }],
    inventory_units: [unit(10), unit(11, { contract_id: other, installation_id: other, ticket_id: other }), unit(12, { contract_id: null, installation_id: other, ticket_id: job }), unit(13, { status: 'pending_approval' }), unit(14, { status: 'in_stock', client_id: null, contract_id: null, installation_id: null, ticket_id: null }), unit(15, { status: 'in_stock', client_id: other })],
    inventory_movements: [{ id: id(20), product_id: model, movement_type: 'egreso', quantity: 1, reason: 'Material de orden', installation_id: job, ticket_id: job, reverses_movement_id: null, created_at: '2026-10-15T12:00:00Z', balance_after: 999, product: { id: model, name: 'Cable', unit: 'metro', price: 999 } }],
  };
  const db = createClient('https://field.invalid', 'synthetic-public', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)), table = url.pathname.split('/').at(-1)!;
      calls.push({ table, method: init?.method ?? 'GET', query: url.searchParams });
      if (table === 'profiles' && ++profileReads === 2 && opts.revoke) tables.job_assignees = [];
      let rows = structuredClone(tables[table] ?? []);
      for (const [key, filter] of url.searchParams) {
        if (filter.startsWith('eq.')) rows = rows.filter(row => String(row[key]) === filter.slice(3));
        if (filter === 'is.null') rows = rows.filter(row => row[key] == null);
      }
      if (url.searchParams.has('or')) rows = rows.filter(row => row.contract_id == null || row.contract_id === contract);
      const from = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? rows.length);
      rows = rows.slice(from, from + limit);
      const singular = new Headers(init?.headers).get('accept')?.includes('object+json');
      // Se conservan columnas extra intencionalmente: la proyección del servicio debe quitarlas.
      return new Response(JSON.stringify(singular ? rows[0] ?? null : rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  return { db, calls, tables };
}
const input = (view: string, jobType = 'installation') => ({ jobType, jobId: job, view });

for (const teamRole of ['leader', 'support']) test(`Alta/Avería: técnico ${teamRole} asignado autorizado y sin datos administrativos`, async () => {
  for (const jobType of ['installation', 'ticket']) {
    const f = fixture({ teamRole });
    for (const view of ['products', 'materials', 'assigned', 'pending']) {
      const result = await readFieldInventory(f.db, actor, input(view, jobType));
      assert.equal(result.context.actorId, actor);
      assert.equal(result.context.clientId, client);
      assert.equal(result.context.contractId, contract);
      assert.ok(result.items.length);
      assert.doesNotMatch(JSON.stringify(result), /price|balance_after|total_value|PRIVADO/);
    }
    assert.ok(f.calls.every(c => c.method === 'GET'));
  }
});
for (const opts of [{ assigned: false }, { active: false }, { role: 'SOPORTE' }, { role: 'FACTURACION' }, { role: 'CLIENTE' }, { status: 'completed' }, { status: 'rescheduled', assigned: false }]) {
  test(`deniega antes de leer inventario: ${JSON.stringify(opts)}`, async () => {
    const f = fixture(opts);
    await assert.rejects(readFieldInventory(f.db, actor, input('products')), { status: 403 });
    assert.equal(f.calls.some(c => c.table.startsWith('inventory_')), false);
  });
}
test('reasignación durante la consulta impide devolver resultados', async () => {
  const f = fixture({ revoke: true });
  await assert.rejects(readFieldInventory(f.db, actor, input('products')), { status: 403 });
});
test('cliente multicontrato: solo equipo del contrato exacto; sin fallback a otro servicio', async () => {
  const f = fixture();
  const r = await readFieldInventory(f.db, actor, input('assigned', 'ticket'));
  assert.deepEqual(r.items.map(u => u.id), [id(10)]);
  const legacy = fixture({ noContract: true });
  const noContract = await readFieldInventory(legacy.db, actor, input('assigned', 'ticket'));
  assert.deepEqual(noContract.items.map(u => u.id), [id(12)]);
  assert.ok(noContract.warning);
});
test('disponibles: modelo válido, solo libres sin vínculos de terceros', async () => {
  const f = fixture();
  const r = await readFieldInventory(f.db, actor, { ...input('available'), productId: model });
  assert.deepEqual(r.items.map(u => u.id), [id(14)]);
  await assert.rejects(readFieldInventory(f.db, actor, { ...input('available'), productId: other }), { status: 400 });
});
test('propaga contexto de retirada/desvinculación y rechaza equipo de otra orden', async () => {
  const f = fixture();
  const alta = await readFieldInventory(f.db, actor, { ...input('unit-context'), unitId: id(10), action: 'unassign' });
  assert.equal(alta.context.jobId, job);
  assert.equal(alta.items[0].id, id(10));
  const ticket = await readFieldInventory(f.db, actor, { ...input('unit-context', 'ticket'), unitId: id(13), action: 'unlink' });
  assert.equal(ticket.context.jobType, 'ticket');
  await assert.rejects(readFieldInventory(f.db, actor, { ...input('unit-context'), unitId: id(11), action: 'unassign' }), { status: 403 });
});
test('ADMIN/SUPERADMIN activos pueden leer contexto sin ampliar SOPORTE', async () => {
  for (const role of ['ADMIN', 'SUPERADMIN']) {
    const f = fixture({ role, assigned: false });
    assert.ok((await readFieldInventory(f.db, actor, input('products'))).items.length);
  }
});
test('orden cerrada propia conserva consulta histórica, sin disponibles ni validación de acciones', async () => {
  for (const [jobType, status] of [['installation', 'completed'], ['ticket', 'resolved'], ['ticket', 'closed']]) {
    const f = fixture({ status });
    assert.ok((await readFieldInventory(f.db, actor, input('materials', jobType))).items.length);
    await assert.rejects(readFieldInventory(f.db, actor, { ...input('available', jobType), productId: model }), { status: 403 });
  }
});
test('contrato de otro cliente o unidad ajena no permite ampliar el alcance', async () => {
  const f = fixture();
  f.tables.service_contracts[0].client_id = other;
  await assert.rejects(readFieldInventory(f.db, actor, input('assigned', 'ticket')), { status: 403 });
  assert.equal(f.calls.some(c => c.table === 'inventory_units'), false);
});
test('paginación remota por orden mantiene límite y no trae el catálogo administrativo', async () => {
  const f = fixture();
  f.tables.inventory_movements = Array.from({ length: 101 }, (_, i) => ({ ...f.tables.inventory_movements[0], id: id(100 + i) }));
  const first = await readFieldInventory(f.db, actor, input('materials'));
  const last = await readFieldInventory(f.db, actor, { ...input('materials'), page: '1' });
  assert.equal(first.items.length, 100); assert.equal(first.next, 1);
  assert.equal(last.items.length, 1); assert.equal(last.next, null);
  const calls = f.calls.filter(c => c.table === 'inventory_movements');
  assert.ok(calls.every(c => c.query.get('installation_id') === `eq.${job}` && c.query.get('limit') === '101'));
});
test('rechaza rutina, UUID inválido y página arbitraria; no toca Fase162', async () => {
  const f = fixture();
  for (const args of [{ ...input('products'), jobType: 'routine' }, { ...input('products'), jobId: 'bad' }, { ...input('products'), page: '-1' }]) await assert.rejects(readFieldInventory(f.db, actor, args), { status: 400 });
  assert.equal(f.calls.length, 0);
});
test('ruta rechaza petición anónima y no admite métodos de escritura', async () => {
  assert.equal((await fieldInventoryRoutes.request('/installation/' + job + '/products')).status, 401);
  assert.equal((await fieldInventoryRoutes.request('/installation/' + job + '/products', { method: 'POST' })).status, 401);
});
