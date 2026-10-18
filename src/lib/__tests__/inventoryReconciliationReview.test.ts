import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileInventory, type ReconciliationUnit, type ReconciliationTicket } from '../inventoryReconciliation';
import { needsReview, reviewTier, reviewReasonLabel, sortByReviewPriority } from '../inventoryReconciliationReview';

function unit(overrides: Partial<ReconciliationUnit> = {}): ReconciliationUnit {
  return { id: 'unit', product_id: 'product', serial_number: 'ONT-001', mac_address: null, status: 'in_stock', client_id: null, contract_id: null, installation_id: null, ticket_id: null, custody_technician_id: null,
    product: { name: 'Modelo ONT', is_serialized: true, inventory_categories: { slug: 'onu', name: 'ONUs / ONTs' } }, clients: null, contract: null, technician: null, ...overrides };
}
const ticket: ReconciliationTicket = { id: 'ticket', client_id: 'client', contract_id: 'contract', status: 'resolved' };

test('instalado/custodia coherentes nunca necesitan revisión', () => {
  const installed = unit({ status: 'assigned', client_id: 'client', clients: { id: 'client', first_name: 'Ana', last_name: 'Prueba' }, contract_id: 'contract', contract: { id: 'contract', client_id: 'client', contract_number: 'C1' }, installation_id: 'order' });
  const [row] = reconcileInventory([installed], [{ id: 'order', client_id: 'client', contract_id: 'contract', status: 'completed' }], []);
  assert.equal(row!.classification, 'installed'); assert.equal(needsReview(row!), false);

  const custody = unit({ status: 'with_technician', custody_technician_id: 'tech', technician: { id: 'tech', full_name: 'Técnico', email: null } });
  const [custodyRow] = reconcileInventory([custody], [], []);
  assert.equal(custodyRow!.classification, 'custody'); assert.equal(needsReview(custodyRow!), false);
});

test('almacén con indicio de ubicación es la prioridad más alta (tier 1)', () => {
  const staged = unit({ status: 'in_stock', client_id: 'client', ticket_id: 'ticket' });
  const [row] = reconcileInventory([staged], [], [], [ticket]);
  assert.equal(row!.classification, 'possible'); assert.equal(needsReview(row!), true);
  assert.equal(reviewTier(row!), 1);
  assert.equal(reviewReasonLabel(row!), 'En almacén con indicios de estar instalado');
});

test('serie o MAC duplicada sin otro vínculo es tier 2, no tier 1', () => {
  const duplicateMac = [unit({ serial_number: null, mac_address: 'AA:BB:CC:DD:EE:01' }), unit({ id: 'second', serial_number: 'OTHER', mac_address: 'aabb.ccdd.ee01' })];
  const rows = reconcileInventory(duplicateMac, [], []);
  for (const row of rows) { assert.equal(row.classification, 'possible'); assert.equal(reviewTier(row), 2); }
});

test('ubicación sin verificar (sin ningún vínculo) ya NO es pendiente de revisión', () => {
  // Caso normal de un equipo "En almacén" sin ninguna evidencia contradictoria
  // (problema reportado): reviewTier() sigue calculando 3 internamente, pero
  // needsReview lo excluye — no debe ocupar espacio en "Necesitan revisión".
  const [row] = reconcileInventory([unit()], [], []);
  assert.equal(row!.classification, 'unknown');
  assert.equal(needsReview(row!), false);
  assert.equal(reviewTier(row!), 3);
});

test('otros vínculos por confirmar (possible fuera de almacén/duplicado) son tier 4', () => {
  const mismatchedCustody = unit({ status: 'with_technician', custody_technician_id: 'tech', technician: { id: 'otro-tecnico', full_name: 'Otro', email: null } });
  const [row] = reconcileInventory([mismatchedCustody], [], []);
  assert.equal(row!.classification, 'possible'); assert.equal(reviewTier(row!), 4);
});

test('contrato huérfano en almacén (caso real ZTE) NUNCA es tier 1, con motivo específico', () => {
  const returned = unit({ status: 'in_stock', contract_id: 'contrato-viejo', contract: { id: 'contrato-viejo', client_id: 'otro-cliente', contract_number: 'CTR-OLD' } });
  const [row] = reconcileInventory([returned], [], []);
  assert.equal(row!.classification, 'possible');
  assert.equal(reviewTier(row!), 4);
  assert.equal(reviewReasonLabel(row!), 'Contrato registrado sin cliente vinculado — probable dato remanente de un movimiento revertido, no indica instalación');
});

test('el orden de prioridad nunca reclasifica ni cambia la lista completa, solo reordena lo pendiente', () => {
  const units = [
    unit({ id: 'coherente', status: 'with_technician', custody_technician_id: 'tech', technician: { id: 'tech', full_name: 'Técnico', email: null } }),
    unit({ id: 'tier3-unknown', serial_number: 'SN-3' }),
    unit({ id: 'tier1-almacen', serial_number: 'SN-1', status: 'in_stock', ticket_id: 'ticket' }),
    unit({ id: 'tier2-duplicado', serial_number: null, mac_address: 'AA:BB:CC:DD:EE:02' }),
    unit({ id: 'tier2-duplicado-b', serial_number: 'OTHER-2', mac_address: 'aabb.ccdd.ee02' }),
  ];
  const before = JSON.stringify(units);
  const rows = reconcileInventory(units, [], [], [ticket]);
  const sorted = sortByReviewPriority(rows);
  assert.equal(sorted.length, rows.length);
  assert.deepEqual(new Set(sorted.map((r) => r.unit.id)), new Set(rows.map((r) => r.unit.id)));
  const reviewIds = sorted.filter(needsReview).map((r) => r.unit.id);
  // 'tier3-unknown' (sin ningún vínculo) ya no es pendiente de revisión.
  assert.deepEqual(reviewIds, ['tier1-almacen', 'tier2-duplicado', 'tier2-duplicado-b']);
  // Los no-pendientes conservan su orden relativo original al final (orden estable).
  assert.deepEqual(sorted.slice(-2).map((r) => r.unit.id), ['coherente', 'tier3-unknown']);
  assert.equal(JSON.stringify(units), before);
});
