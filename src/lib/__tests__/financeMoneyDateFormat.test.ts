import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDateLima } from '../financeMoney';

// Fase 30: formatDateLima se extrajo a un lugar compartido para que
// PonCollections.vue y FinanceDueInvoices.vue dejen de mostrar fechas ISO
// crudas (antes solo existía una copia local en ContractFinanceSummary.vue).
test('formatDateLima: reordena YYYY-MM-DD a DD/MM/AAAA sin pasar por Date()', () => {
  assert.equal(formatDateLima('2026-12-03'), '03/12/2026');
  assert.equal(formatDateLima('2027-01-02'), '02/01/2027');
});
test('formatDateLima: vacío/null/undefined da un guion, nunca "Invalid Date"', () => {
  assert.equal(formatDateLima(null), '—');
  assert.equal(formatDateLima(undefined), '—');
  assert.equal(formatDateLima(''), '—');
});
test('formatDateLima: un valor que no es fecha ISO se devuelve tal cual (nunca se oculta)', () => {
  assert.equal(formatDateLima('no-es-fecha'), 'no-es-fecha');
});
