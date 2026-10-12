import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countOcupadosReales, serviciosOcupados } from '../napOccupancy';

test('NAP occupancy: counts only ocupado ports that still have a client_id', () => {
  const puertos = [
    { estado: 'ocupado', client_id: 'c1' },
    { estado: 'ocupado', client_id: null }, // residuo: cliente/contrato eliminado (ON DELETE SET NULL)
    { estado: 'ocupado', client_id: null },
    { estado: 'libre', client_id: null },
    { estado: 'reservado', client_id: null },
    { estado: 'ocupado', client_id: 'c2' },
  ] as const;
  assert.equal(countOcupadosReales(puertos), 2);
});

test('NAP occupancy: real-world case (caja NAP - 01) — 9 filas ocupado, 5 residuos sin cliente', () => {
  const puertos = [
    { estado: 'ocupado', client_id: 'cliente-1' },
    { estado: 'ocupado', client_id: null },
    { estado: 'ocupado', client_id: null },
    { estado: 'ocupado', client_id: null },
    { estado: 'ocupado', client_id: null },
    { estado: 'ocupado', client_id: null },
    { estado: 'ocupado', client_id: 'cliente-2' },
    { estado: 'ocupado', client_id: 'cliente-3' },
    { estado: 'ocupado', client_id: 'cliente-4' },
  ] as const;
  assert.equal(countOcupadosReales(puertos), 4);
});

test('NAP occupancy: sin residuos, el conteo no cambia', () => {
  const puertos = [
    { estado: 'ocupado', client_id: 'c1' },
    { estado: 'ocupado', client_id: 'c2' },
    { estado: 'libre', client_id: null },
  ] as const;
  assert.equal(countOcupadosReales(puertos), 2);
});

test('NAP occupancy: caja vacia', () => {
  assert.equal(countOcupadosReales([]), 0);
});

test('Fase 157 — serviciosOcupados: sin duplicados, devuelve un puerto por servicio', () => {
  const puertos = [
    { estado: 'ocupado', client_id: 'c1', contract_id: 'ctr1', puerto_numero: 2 },
    { estado: 'ocupado', client_id: 'c2', contract_id: 'ctr2', puerto_numero: 1 },
    { estado: 'libre', client_id: null, contract_id: null, puerto_numero: 3 },
  ] as const;
  const result = serviciosOcupados(puertos);
  assert.equal(result.length, 2);
  // Ordenado por puerto_numero, aunque el numero en si no se use en la UI.
  assert.deepEqual(result.map((r) => r.contract_id), ['ctr2', 'ctr1']);
});

test('Fase 157 — serviciosOcupados: el mismo contrato en 2 puertos cuenta UNA sola vez (edicion manual fuera del flujo normal)', () => {
  const puertos = [
    { estado: 'ocupado', client_id: 'c1', contract_id: 'ctr1', puerto_numero: 5 },
    { estado: 'ocupado', client_id: 'c1', contract_id: 'ctr1', puerto_numero: 1 },
    { estado: 'ocupado', client_id: 'c2', contract_id: 'ctr2', puerto_numero: 3 },
  ] as const;
  const result = serviciosOcupados(puertos);
  assert.equal(result.length, 2);
  // Se queda con el de menor puerto_numero (representante estable).
  assert.equal(result.find((r) => r.contract_id === 'ctr1')?.puerto_numero, 1);
});

test('Fase 157 — serviciosOcupados: caso ambiguo (client_id sin contract_id) dedupe por client_id', () => {
  const puertos = [
    { estado: 'ocupado', client_id: 'c1', contract_id: null, puerto_numero: 2 },
    { estado: 'ocupado', client_id: 'c1', contract_id: null, puerto_numero: 4 },
  ] as const;
  const result = serviciosOcupados(puertos);
  assert.equal(result.length, 1);
  assert.equal(result[0].puerto_numero, 2);
});

test('Fase 157 — serviciosOcupados: puertos fantasma (sin client_id) e inactivos se excluyen igual que countOcupadosReales', () => {
  const puertos = [
    { estado: 'ocupado', client_id: null, contract_id: null, puerto_numero: 1 },
    { estado: 'reservado', client_id: 'c1', contract_id: 'ctr1', puerto_numero: 2 },
    { estado: 'ocupado', client_id: 'c2', contract_id: 'ctr2', puerto_numero: 3 },
  ] as const;
  const result = serviciosOcupados(puertos);
  assert.equal(result.length, 1);
  assert.equal(result[0].contract_id, 'ctr2');
});
