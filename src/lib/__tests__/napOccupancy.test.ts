import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countOcupadosReales } from '../napOccupancy';

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
