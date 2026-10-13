import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isUniqueViolation,
  photosAlreadyUploaded,
  equipmentTypesAlreadyUploaded,
  createJobClosureGuard,
} from '../jobClosureIdempotency';

// ---- isUniqueViolation ----

test('isUniqueViolation: codigo 23505 sin pista de constraint -> true', () => {
  assert.equal(isUniqueViolation({ code: '23505', message: 'duplicate key value violates unique constraint "x"' }), true);
});

test('isUniqueViolation: codigo 23505 CON pista de constraint que coincide -> true', () => {
  const e = { code: '23505', message: 'duplicate key value violates unique constraint "idx_service_contracts_client_code_unique"' };
  assert.equal(isUniqueViolation(e, 'idx_service_contracts_client_code_unique'), true);
});

test('isUniqueViolation: codigo 23505 pero otra constraint distinta -> false (no confundir con otro UNIQUE)', () => {
  const e = { code: '23505', message: 'duplicate key value violates unique constraint "otra_tabla_unique"' };
  assert.equal(isUniqueViolation(e, 'idx_service_contracts_client_code_unique'), false);
});

test('isUniqueViolation: errores de red/timeout (sin codigo, o codigo distinto) -> false', () => {
  assert.equal(isUniqueViolation(new Error('Failed to fetch')), false);
  assert.equal(isUniqueViolation({ code: '08006', message: 'connection failure' }), false);
  assert.equal(isUniqueViolation(null), false);
  assert.equal(isUniqueViolation(undefined), false);
});

// ---- photosAlreadyUploaded / equipmentTypesAlreadyUploaded ----

test('photosAlreadyUploaded: mapea categoria -> storage_path ya guardado', () => {
  const map = photosAlreadyUploaded([{ category: 'facade', storage_path: 'a.jpg' }, { category: 'nap_box', storage_path: 'b.jpg' }]);
  assert.equal(map.get('facade'), 'a.jpg');
  assert.equal(map.size, 2);
});

test('equipmentTypesAlreadyUploaded: dedup de tipos, lista vacia no rompe', () => {
  assert.deepEqual(equipmentTypesAlreadyUploaded([{ equipment_type: 'modem' }, { equipment_type: 'modem' }, { equipment_type: 'router' }]), new Set(['modem', 'router']));
  assert.deepEqual(equipmentTypesAlreadyUploaded([]), new Set());
});

// ---- createJobClosureGuard: caso real (boton + auto-sync de cola offline casi simultaneos) ----

test('guard: el mismo trabajo no puede entrar 2 veces mientras el primero esta en vuelo', () => {
  const guard = createJobClosureGuard();
  assert.equal(guard.tryEnter('installation', 'job-1'), true);
  assert.equal(guard.tryEnter('installation', 'job-1'), false); // boton + auto-sync casi al mismo tiempo
  guard.exit('installation', 'job-1');
  assert.equal(guard.tryEnter('installation', 'job-1'), true); // liberado, un reintento normal si puede entrar
});

test('guard: trabajos DISTINTOS nunca se bloquean entre si', () => {
  const guard = createJobClosureGuard();
  assert.equal(guard.tryEnter('installation', 'job-1'), true);
  assert.equal(guard.tryEnter('installation', 'job-2'), true);
  assert.equal(guard.tryEnter('ticket', 'job-1'), true); // mismo id, otro jobType -> distinto trabajo
});

test('guard: salir de un trabajo que no estaba en vuelo no rompe nada (idempotente)', () => {
  const guard = createJobClosureGuard();
  guard.exit('installation', 'nunca-entro');
  assert.equal(guard.tryEnter('installation', 'nunca-entro'), true);
});
