import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { identifierFilter, searchInventory } from '../inventorySearch.ts';

function fixture(products: unknown[] = [], units: unknown[] = [], denied = false) {
  const calls: { url: URL; method: string; authorization: string | null }[] = [];
  const db = createClient('https://inventory.invalid', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, method: init?.method ?? 'GET', authorization: new Headers(init?.headers).get('authorization') });
      return new Response(JSON.stringify(denied ? { message: 'permission denied', code: '42501' } :
        url.pathname.endsWith('/inventory_products') ? products : units), {
        status: denied ? 403 : 200, headers: { 'Content-Type': 'application/json' },
      });
    } },
  });
  return { db, calls };
}

test('empty term performs no requests', async () => {
  const { db, calls } = fixture();
  assert.deepEqual(await searchInventory(db, '  ', 0), { products: [], units: [], more: false });
  assert.equal(calls.length, 0);
});

for (const term of ['Huawei HG8245', 'HWTC12345678', '123456', 'aa:bb:cc:dd:ee:ff', 'AABBCCDDEEFF', 'aa-bb-cc', 'aabb.ccdd.eeff']) {
  test(`remote bounded search: ${term}`, async () => {
    const { db, calls } = fixture([{ id: 'consumable', is_serialized: false }], [
      { id: 'assigned', status: 'assigned', clients: { first_name: 'Visible' } },
      { id: 'available', status: 'in_stock', clients: null, contract: null },
    ]);
    const result = await searchInventory(db, term, 0);
    assert.equal(calls.length, 2);
    assert.equal(result.products[0]?.id, 'consumable');
    assert.equal(result.units.length, 2);
    for (const call of calls) {
      assert.equal(call.method, 'GET');
      assert.equal(call.url.searchParams.get('limit'), '26');
      assert.equal(call.url.searchParams.get('offset'), '0');
      assert.equal(call.authorization, 'Bearer test-anon-key');
    }
    assert.match(calls[0]!.url.searchParams.get('or')!, /name.ilike/);
    assert.match(calls[1]!.url.searchParams.get('or')!, /serial_number.ilike/);
    assert.equal(calls[1]!.url.searchParams.has('status'), false);
    assert.equal(calls[1]!.url.searchParams.has('product.category_id'), false);
  });
}

test('MAC regex has identical meaning across separators and case, including partials', () => {
  for (const term of ['aabbccddeeff', 'AA:BB:CC:DD:EE:FF', 'aabb.ccdd.eeff', 'aa-bb-cc-dd-ee-ff']) {
    const filter = identifierFilter(term);
    const pattern = filter.split('mac_address.imatch."')[1]!.slice(0, -1).replaceAll('[:space:]', '\\s');
    const regex = new RegExp(pattern, 'i');
    for (const mac of ['AABBCCDDEEFF', 'aa:bb:cc:dd:ee:ff', 'aabb.ccdd.eeff', 'aa-bb-cc-dd-ee-ff']) assert.ok(regex.test(mac));
    assert.equal(regex.test('aa:bb:00:cc:dd:ee:ff'), false);
  }
  assert.match(identifierFilter('bbcc'), /mac_address.imatch/);
  assert.doesNotMatch(identifierFilter('HWTC123'), /mac_address.imatch/);
});

test('literal wildcards and PostgREST punctuation are quoted', () => {
  const filter = identifierFilter('a%,b_(x)"');
  assert.match(filter, /serial_number.ilike."/);
  assert.ok(filter.includes('\\\\%'));
  assert.ok(filter.includes('\\\\_'));
  assert.ok(filter.includes('\\"'));
});

test('category filters both products and units on the server', async () => {
  const { db, calls } = fixture();
  await searchInventory(db, 'ONT', 0, { categoryId: 'onu' });
  assert.equal(calls[0]!.url.searchParams.get('category_id'), 'eq.onu');
  assert.equal(calls[1]!.url.searchParams.get('product.category_id'), 'eq.onu');
});

test('virtual albums restrict units by status and support product names', async () => {
  const { db, calls } = fixture();
  await searchInventory(db, 'Huawei', 0, { statuses: ['damaged', 'in_repair', 'retired'] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url.searchParams.get('status'), 'in.(damaged,in_repair,retired)');
  assert.equal(calls[0]!.url.searchParams.get('matched_product.name'), 'ilike.%Huawei%');
  assert.match(calls[0]!.url.searchParams.get('or')!, /matched_product.not.is.null/);
});

test('pagination uses stable ordering and lookahead; no matches are empty', async () => {
  const { db, calls } = fixture([], Array.from({ length: 26 }, (_, id) => ({ id: String(id) })));
  const result = await searchInventory(db, 'aa', 2);
  assert.equal(result.units.length, 25);
  assert.equal(result.more, true);
  assert.ok(calls.every(c => c.url.searchParams.get('offset') === '50'));
  assert.ok(calls.every(c => c.url.searchParams.get('order')?.includes('id.asc')));
  const empty = fixture();
  assert.deepEqual(await searchInventory(empty.db, 'missing', 0), { products: [], units: [], more: false });
});

test('RLS denial propagates without fallback or privileged requests', async () => {
  const { db, calls } = fixture([], [], true);
  await assert.rejects(searchInventory(db, 'secret', 0), { code: '42501' });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(c => c.method === 'GET'));
});

test('hidden client/contract relations remain null and original identifiers survive', async () => {
  const original = { id: 'unit', serial_number: 'Sn-AbC', mac_address: 'AA:bb:CC:dd:EE:ff', clients: null, contract: null };
  const { db } = fixture([], [original]);
  const result = await searchInventory(db, 'abc', 0);
  assert.deepEqual(result.units[0], original);
});
