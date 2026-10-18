import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileInventory, normalizeMac, normalizeSerial, readInventoryReconciliation, type ReconciliationUnit, type ReconciliationInstallation, type ReconciliationTicket, type ReconciliationClosure } from '../inventoryReconciliation';
import { matchesEquipmentFilter } from '../inventoryPresentation';
import type { SupabaseClient } from '@supabase/supabase-js';

function unit(overrides: Partial<ReconciliationUnit> = {}): ReconciliationUnit {
  return { id: 'unit', product_id: 'product', serial_number: 'ONT-001', mac_address: null, status: 'in_stock', client_id: null, contract_id: null, installation_id: null, ticket_id: null, custody_technician_id: null,
    product: { name: 'Modelo ONT', is_serialized: true, inventory_categories: { slug: 'onu', name: 'ONUs / ONTs' } }, clients: null, contract: null, technician: null, ...overrides };
}
const order: ReconciliationInstallation = { id: 'order', client_id: 'client', contract_id: 'contract', status: 'completed' };
const closure: ReconciliationClosure = { id: 'closure', job_id: 'order', client_id: 'client', ont_serial: ' ont-001 ', created_at: '2026-10-17T20:00:00Z' };
const ticket: ReconciliationTicket = { id: 'ticket', client_id: 'client', contract_id: 'contract', status: 'resolved' };
const ticketClosure: ReconciliationClosure = { id: 'tclosure', job_id: 'ticket', client_id: 'client', ont_serial: ' ont-001 ', created_at: '2026-10-17T20:00:00Z' };

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
test('asignado a cliente con orden completada confirma instalación aunque la unidad no tenga contract_id propio (caso real Huawei)', () => {
  // La Alta ya capturó el contrato (installation.contract_id); la unidad
  // nunca sincronizó ese campo — no es una contradicción, es un dato ausente.
  const noContractOnUnit = unit({ status: 'assigned', client_id: 'client', clients: { id: 'client', first_name: 'Marcela', last_name: 'Tomas Rodríguez' }, contract_id: null, contract: null, installation_id: 'order' });
  assert.equal(reconcileInventory([noContractOnUnit], [order], [])[0]!.classification, 'installed');
  // Pero si la unidad SÍ declara un contrato distinto al de la orden, sigue
  // siendo una contradicción real y debe quedarse en revisión.
  const wrongContractOnUnit = unit({ status: 'assigned', client_id: 'client', clients: { id: 'client', first_name: 'Marcela', last_name: 'Tomas Rodríguez' }, contract_id: 'otro-contrato', contract: { id: 'otro-contrato', client_id: 'client', contract_number: 'C2' }, installation_id: 'order' });
  assert.equal(reconcileInventory([wrongContractOnUnit], [order], [])[0]!.classification, 'possible');
});
test('contrato huérfano (sin cliente, orden ni avería) de un movimiento ya revertido no es indicio de instalación (caso real ZTE)', () => {
  // Devuelto a bodega: client_id ya se limpió, pero contract_id quedó
  // remanente de la asignación anterior (ya anulada por la devolución).
  const returned = unit({ status: 'in_stock', contract_id: 'contrato-viejo', contract: { id: 'contrato-viejo', client_id: 'otro-cliente', contract_number: 'CTR-OLD' } });
  const row = reconcileInventory([returned], [], [])[0]!;
  assert.equal(row.classification, 'possible'); // sigue para revisión (dato por limpiar), nunca 'installed'
  assert(row.reasons.some((r) => r.includes('remanente') && r.includes('revertido')));
  assert(!row.reasons.some((r) => r.includes('indicios de estar instalado')));
  // Un equipo devuelto SIN ningún remanente (caso normal) sigue sin evidencia.
  assert.equal(reconcileInventory([unit({ status: 'in_stock' })], [], [])[0]!.classification, 'unknown');
  // Si además tiene cliente vinculado, ya no es "huérfano" — sigue el camino normal.
  const withClient = unit({ status: 'in_stock', client_id: 'client', contract_id: 'contract' });
  assert.equal(reconcileInventory([withClient], [], [])[0]!.classification, 'possible');
  assert(!reconcileInventory([withClient], [], [])[0]!.reasons.some((r) => r.includes('remanente')));
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
test('avería resuelta con serie coincidente es señal por revisar, nunca instalación confirmada', () => {
  assert.equal(reconcileInventory([unit()], [], [], [], [ticketClosure])[0]!.ticketSerialMatches, 0);
  const match = reconcileInventory([unit()], [], [], [ticket], [ticketClosure])[0]!;
  assert.equal(match.classification, 'possible'); assert.equal(match.ticketSerialMatches, 1); assert.equal(match.serialMatches, 0);
  assert(match.reasons.some(r => r.includes('avería')));
  const manyTickets = reconcileInventory([unit()], [], [], [ticket], [ticketClosure, { ...ticketClosure, id: 'tclosure-2' }])[0]!;
  assert.equal(manyTickets.ticketSerialMatches, 2); assert.notEqual(manyTickets.classification, 'installed');
});
test('avería abierta, en progreso o con cliente distinto no genera coincidencia', () => {
  assert.equal(reconcileInventory([unit()], [], [], [{ ...ticket, status: 'open' }], [ticketClosure])[0]!.ticketSerialMatches, 0);
  assert.equal(reconcileInventory([unit()], [], [], [{ ...ticket, status: 'in_progress' }], [ticketClosure])[0]!.ticketSerialMatches, 0);
  assert.equal(reconcileInventory([unit()], [], [], [{ ...ticket, status: 'rescheduled' }], [ticketClosure])[0]!.ticketSerialMatches, 0);
  assert.equal(reconcileInventory([unit()], [], [], [ticket], [{ ...ticketClosure, client_id: 'otro' }])[0]!.ticketSerialMatches, 0);
  assert.equal(reconcileInventory([unit()], [], [], [{ ...ticket, status: 'closed' }], [ticketClosure])[0]!.ticketSerialMatches, 1);
});
test('coincidencias de Alta y de Avería se cuentan por separado, sin mezclarse', () => {
  const row = reconcileInventory([unit()], [order], [closure], [ticket], [ticketClosure])[0]!;
  assert.equal(row.serialMatches, 1); assert.equal(row.ticketSerialMatches, 1);
  assert(row.reasons.some(r => r.includes('instalación finalizada')));
  assert(row.reasons.some(r => r.includes('avería')));
  const tv = unit({ product: { name: 'TV Box', is_serialized: true, inventory_categories: { slug: 'tvbox', name: 'TV Box' } } });
  assert.equal(reconcileInventory([tv], [order], [closure], [ticket], [ticketClosure])[0]!.ticketSerialMatches, 0);
});
test('inventory_units.ticket_id enlaza la Avería vinculada, sin instalar automáticamente', () => {
  // ONT entrante de una Avería, pendiente de aprobación, cliente/contrato coherentes.
  const staged = unit({ status: 'pending_approval', client_id: 'client', clients: { id: 'client', first_name: 'Ana', last_name: 'Prueba' }, contract_id: 'contract', contract: { id: 'contract', client_id: 'client', contract_number: 'C1' }, ticket_id: 'ticket' });
  const stagedRow = reconcileInventory([staged], [], [], [ticket])[0]!;
  assert.notEqual(stagedRow.classification, 'installed'); assert.equal(stagedRow.classification, 'possible');
  assert.deepEqual(stagedRow.ticket, ticket);
  assert(stagedRow.reasons.some(r => r.includes('pendiente de aprobación')));

  // ONT vinculada a Alta (installation_id), sin ticket — comportamiento existente intacto.
  const installed = unit({ status: 'assigned', client_id: 'client', clients: { id: 'client', first_name: 'Ana', last_name: 'Prueba' }, contract_id: 'contract', contract: { id: 'contract', client_id: 'client', contract_number: 'C1' }, installation_id: 'order' });
  const installedRow = reconcileInventory([installed], [order], [])[0]!;
  assert.equal(installedRow.classification, 'installed'); assert.equal(installedRow.ticket, null);

  // ONT sin ticket vinculado.
  assert.equal(reconcileInventory([unit()], [], [])[0]!.ticket, null);

  // Ticket de otro cliente: vínculo documental, nunca una coincidencia confirmada.
  const mismatched = unit({ status: 'pending_approval', client_id: 'other-client', clients: { id: 'other-client', first_name: 'Beto', last_name: 'Otro' }, ticket_id: 'ticket' });
  const mismatchedRow = reconcileInventory([mismatched], [], [], [ticket])[0]!;
  assert.notEqual(mismatchedRow.classification, 'installed');
  assert(mismatchedRow.reasons.some(r => r.includes('no coincide')));
  assert(!mismatchedRow.reasons.some(r => r.includes('pendiente de aprobación')));

  // ONT retirada (el trigger real limpia ticket_id al volver a in_stock): sin vínculo que mostrar.
  assert.equal(reconcileInventory([unit({ status: 'in_stock', ticket_id: null })], [], [], [ticket])[0]!.ticket, null);
});
test('Avería enlazada no duplica consultas ni altera unidades/conteos (regresión)', () => {
  const units = [unit({ status: 'pending_approval', client_id: 'client', ticket_id: 'ticket' }), unit({ id: 'two' })];
  const before = JSON.stringify(units);
  const rows = reconcileInventory(units, [order], [closure], [ticket], [ticketClosure]);
  assert.equal(rows.length, 2);
  assert.equal(JSON.stringify(units), before);
});
test('omitir tickets/cierres de avería preserva exactamente el comportamiento anterior (regresión)', () => {
  const withoutTickets = reconcileInventory([unit()], [order], [closure]);
  const withEmptyTickets = reconcileInventory([unit()], [order], [closure], [], []);
  assert.deepEqual(withoutTickets, withEmptyTickets);
  assert.equal(withoutTickets[0]!.ticketSerialMatches, 0);
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
  assert(calls.some(c => c.table === 'tickets'));
  assert.equal(calls.filter(c => c.table === 'work_order_closures').length, 2);
  assert.equal(result.counts.tickets, 0); assert.equal(result.counts.ticketClosures, 0);
  assert.equal((await readInventoryReconciliation(makeDb(false, 100), 'ADMIN', signal)).rows.length, 501);
  await assert.rejects(readInventoryReconciliation(makeDb(true), 'ADMIN', signal), /READ_DENIED/);
  await assert.rejects(readInventoryReconciliation(makeDb(false, 500, null), 'ADMIN', signal), /verificar el total/);
  await assert.rejects(readInventoryReconciliation(makeDb(false, 500, 20001), 'ADMIN', signal), /20 000/);
  const before = calls.length;
  await assert.rejects(readInventoryReconciliation(makeDb(), 'TECNICO_RED', signal));
  assert.equal(calls.length, before);
});
