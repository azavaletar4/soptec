import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeMaterialMovements, type MaterialMovementLike } from '../materialMovementPresentation';

function mv(id: string, movement_type: 'ingreso' | 'egreso', reverses_movement_id: string | null = null): MaterialMovementLike {
  return { id, movement_type, reverses_movement_id };
}

test('sin reversiones: se muestran todos los movimientos', () => {
  const movements = [mv('1', 'egreso'), mv('2', 'egreso')];
  assert.deepEqual(activeMaterialMovements(movements).map((m) => m.id), ['1', '2']);
});

test('un egreso revertido y su ingreso de reversión se excluyen; el egreso final queda', () => {
  const movements = [mv('1', 'egreso'), mv('2', 'ingreso', '1'), mv('3', 'egreso')];
  assert.deepEqual(activeMaterialMovements(movements).map((m) => m.id), ['3']);
});

test('caso real: 6 intentos del mismo kit (5 revertidos + 1 vigente) se reducen a solo el vigente', () => {
  const movements = [
    mv('e1', 'egreso'), mv('r1', 'ingreso', 'e1'),
    mv('e2', 'egreso'), mv('r2', 'ingreso', 'e2'),
    mv('e3', 'egreso'), mv('r3', 'ingreso', 'e3'),
    mv('e4', 'egreso'), mv('r4', 'ingreso', 'e4'),
    mv('e5', 'egreso'), mv('r5', 'ingreso', 'e5'),
    mv('e6', 'egreso'), // nunca revertido: el intento final que quedó vigente
  ];
  assert.deepEqual(activeMaterialMovements(movements).map((m) => m.id), ['e6']);
});

test('no muta ni reordena el arreglo original', () => {
  const movements = [mv('1', 'egreso'), mv('2', 'ingreso', '1')];
  const copy = movements.map((m) => ({ ...m }));
  activeMaterialMovements(movements);
  assert.deepEqual(movements, copy);
});
