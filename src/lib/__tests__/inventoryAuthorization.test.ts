import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { searchAdministrativeInventory } from '../inventoryAdministrativeSearch.ts';
import { canAccessAdministrativeInventory, InventoryAccessError } from '../inventoryAccess.ts';

for (const role of ['TECNICO_RED', 'SOPORTE', 'FACTURACION', 'CLIENTE', 'service_role', 'admin', 'DESCONOCIDO', null, undefined]) {
  test(`deniega búsqueda administrativa sin consultar datos: ${role}`, async () => {
    let requests = 0;
    const db = createClient('https://inventory.invalid', 'synthetic', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async () => { requests++; throw Error('No debe consultar Supabase'); } },
    });
    assert.equal(canAccessAdministrativeInventory(role), false);
    for (const scope of [{}, { categoryId: 'album' }, { statuses: ['en_recupero' as const] }]) {
      await assert.rejects(searchAdministrativeInventory(db, role, 'serie-restringida', 0, scope), InventoryAccessError);
    }
    assert.equal(requests, 0);
  });
}

for (const role of ['ADMIN', 'SUPERADMIN']) {
  test(`autoriza búsqueda administrativa de ${role}`, async () => {
    const requests: { method: string; table: string }[] = [];
    const db = createClient('https://inventory.invalid', 'synthetic', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (input, init) => {
        requests.push({ method: init?.method ?? 'GET', table: new URL(String(input)).pathname });
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
      } },
    });
    assert.equal(canAccessAdministrativeInventory(role), true);
    await searchAdministrativeInventory(db, role, 'consulta-autorizada', 0);
    assert.equal(requests.length, 2);
    assert.ok(requests.every(r => r.method === 'GET'));
    assert.ok(requests.some(r => r.table.endsWith('inventory_products')));
    assert.ok(requests.some(r => r.table.endsWith('inventory_units')));
  });
}
