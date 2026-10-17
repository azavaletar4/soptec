import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileInventory, normalizeMac, normalizeSerial, readInventoryReconciliation, type ReconciliationUnit, type ReconciliationInstallation, type ReconciliationClosure } from '../inventoryReconciliation';
import { matchesEquipmentFilter } from '../inventoryPresentation';
import type { SupabaseClient } from '@supabase/supabase-js';

function unit(overrides: Partial<ReconciliationUnit> = {}): ReconciliationUnit {
  return { id: 'unit', product_id: 'product', serial_number: 'ONT-001', mac_address: null, status: 'in_stock', client_id: null, contract_id: null, installation_id: null, custody_technician_id: null,
    product: { name: 'Modelo ONT', is_serialized: true, inventory_categories: { slug: 'onu', name: 'ONUs / ONTs' } }, clients: null, contract: null, technician: null, ...overrides };
}
const order: ReconciliationInstallation = { id: 'order', client_id: 'client', contract_id: 'contract', status: 'completed' };
const closure: ReconciliationClosure = { id: 'closure', job_id: 'order', client_id: 'client', ont_serial: ' ont-001 ', created_at: '2026-10-17T20:00:00Z' };

test('un cierre o una orden finalizada no convierten almacén en instalado', () => {
  assert.equal(reconcileInventory([unit()], [order], [])[0]!.classification, 'unknown');
  const match = reconcileInventory([unit()], [order], [closure])[0]!;
  assert.equal(match.classification, 'possible'); assert.equal(match.serialMatches, 1);
  assert.equal(match.unit.client_id, null); assert.equal(match.installation, null);
  assert.equal(reconcileInventory([unit()], [{ ...order, status: 'pending' }], [closure])[0]!.classification, 'unknown');
  assert.equal(reconcileInventory([unit()], [order], [{ ...closure, client_id: 'another-client' }])[0]!.classification, 'unknown');
});
test('asignación vigente requiere vínculos coherentes y no comparte identidad', () => {
  const installed = unit({ status: 'assigned', client_id: 'client', clients: { id: 'client', first_name: 'Ana', last_name: 'Prueba' }, contract_id: 'contract', contract: { id: 'contract', client_id: 'client', contract_number: 'C1' }, installation_id: 'order' });
  assert.equal(reconcileInventory([installed], [order], [closure])[0]!.classification, 'installed');
  assert.equal(reconcileInventory([{ ...installed, contract: { ...installed.contract!, client_id: 'other' } }], [order], [])[0]!.classification, 'possible');
  assert.equal(reconcileInventory([installed, unit({ id: 'duplicate' })], [order], [])[0]!.classification, 'possible');
  assert.equal(reconcileInventory([{ ...installed, custody_technician_id: 'tech' }], [order], [])[0]!.classification, 'possible');
});
test('custodia se confirma únicamente con estado y técnico verificables', () => {
  const custody = unit({ status: 'with_technician', custody_technician_id: 'tech', technician: { id: 'tech', full_name: 'Técnico', email: null } });
  assert.equal(reconcileInventory([custody], [], [])[0]!.classification, 'custody');
  assert.equal(reconcileInventory([{ ...custody, status: 'pending_return' }], [], [])[0]!.classification, 'custody');
  assert.notEqual(reconcileInventory([{ ...custody, technician: null }], [], [])[0]!.classification, 'custody');
  assert.equal(reconcileInventory([{ ...custody, status: 'in_stock' }], [], [])[0]!.classification, 'possible');
});
test('serie exacta, MAC completa y categorías sin inferencia por nombre', () => {
  assert.equal(normalizeSerial(' ab-01 '), 'AB-01'); assert.notEqual(normalizeSerial('AB01'), normalizeSerial('AB-01'));
  assert.equal(normalizeMac('AA:BB:CC:DD:EE:01'), normalizeMac('aabb.ccdd.ee01')); assert.equal(normalizeMac('BBCC'), '');
  const duplicateMac = [unit({ serial_number: null, mac_address: 'AA:BB:CC:DD:EE:01' }), unit({ id: 'second', serial_number: 'OTHER', mac_address: 'aabb.ccdd.ee01' })];
  assert(reconcileInventory(duplicateMac, [], []).every(row => row.classification === 'possible'));
  const tv = unit({ product: { name: 'TV Box', is_serialized: true, inventory_categories: { slug: 'tvbox', name: 'TV Box' } } });
  assert.equal(reconcileInventory([tv], [order], [closure])[0]!.serialMatches, 0);
});
test('conciliación y filtros no alteran unidades ni conteos por estado', () => {
  const units = [unit(), unit({ id: 'two', serial_number: 'OTHER', status: 'pending_approval' })];
  const before = JSON.stringify(units);
  const rows = reconcileInventory(units, [order], [closure]);
  assert.equal(rows.length, 2); assert.equal(rows.filter(r => r.unit.status === 'in_stock').length, 1);
  assert.equal(units.filter(u => matchesEquipmentFilter(u, 'ont-001', 'in_stock')).length, 1);
  assert.equal(units.filter(u => matchesEquipmentFilter(u, '', 'pending_approval')).length, 1);
  assert(matchesEquipmentFilter({ ...units[0]!, mac_address: 'AA:BB:CC:DD:EE:01' }, 'aabb.ccdd.ee01', 'in_stock'));
  assert.equal(JSON.stringify(units), before);
});
test('lector: solo SELECT, paginación completa, errores visibles y rol restringido', async () => {
  const calls: Array<{ table: string; from: number; to: number }> = [];
  const makeDb = (fail = false, pageLimit = 500, total: number | null = 501) => ({ from(table: string) {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'not', 'order', 'abortSignal']) chain[method] = () => chain;
    chain.range = (from: number, to: number) => {
      calls.push({ table, from, to });
      const data = table === 'inventory_units' ? Array.from({ length: Math.max(0, Math.min(pageLimit, 501 - from)) }, (_, i) => unit({ id: 'u' + (from + i), serial_number: 'SN' + (from + i) })) : [];
      chain.then = (resolve: (x: unknown) => void) => resolve({ data, count: table === 'inventory_units' ? total : 0, error: fail ? { message: 'READ_DENIED' } : null });
      return chain;
    };
    return chain;
  } }) as unknown as SupabaseClient;
  const signal = new AbortController().signal;
  const result = await readInventoryReconciliation(makeDb(), 'ADMIN', signal);
  assert.equal(result.counts.units, 501); assert.equal(result.rows.length, 501);
  assert(calls.some(c => c.from === 500));
  assert.equal((await readInventoryReconciliation(makeDb(false, 100), 'ADMIN', signal)).rows.length, 501);
  await assert.rejects(readInventoryReconciliation(makeDb(true), 'ADMIN', signal), /READ_DENIED/);
  await assert.rejects(readInventoryReconciliation(makeDb(false, 500, null), 'ADMIN', signal), /verificar el total/);
  await assert.rejects(readInventoryReconciliation(makeDb(false, 500, 20001), 'ADMIN', signal), /20 000/);
  const before = calls.length;
  await assert.rejects(readInventoryReconciliation(makeDb(), 'TECNICO_RED', signal));
  assert.equal(calls.length, before);
});
