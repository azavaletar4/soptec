import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSingleFlightGuard } from '../singleFlightGuard';

test('primera adquisicion de una llave -> true', () => {
  const guard = createSingleFlightGuard();
  assert.equal(guard.tryAcquire('ont-1'), true);
});

test('segunda adquisicion de la MISMA llave mientras la primera sigue en vuelo -> false (concurrencia)', () => {
  const guard = createSingleFlightGuard();
  assert.equal(guard.tryAcquire('ont-1'), true);
  assert.equal(guard.tryAcquire('ont-1'), false);
  assert.equal(guard.tryAcquire('ont-1'), false); // un tercer intento tampoco cuela
});

test('despues de release(), la misma llave se puede volver a adquirir', () => {
  const guard = createSingleFlightGuard();
  guard.tryAcquire('ont-1');
  guard.release('ont-1');
  assert.equal(guard.tryAcquire('ont-1'), true);
});

test('llaves distintas (ONTs distintas) no se bloquean entre si', () => {
  const guard = createSingleFlightGuard();
  assert.equal(guard.tryAcquire('ont-1'), true);
  assert.equal(guard.tryAcquire('ont-2'), true);
});

test('has() refleja el estado actual sin mutarlo', () => {
  const guard = createSingleFlightGuard();
  assert.equal(guard.has('ont-1'), false);
  guard.tryAcquire('ont-1');
  assert.equal(guard.has('ont-1'), true);
  assert.equal(guard.has('ont-1'), true); // llamar has() dos veces no libera la llave
  guard.release('ont-1');
  assert.equal(guard.has('ont-1'), false);
});

test('release() de una llave que nunca se adquirio no lanza', () => {
  const guard = createSingleFlightGuard();
  assert.doesNotThrow(() => guard.release('nunca-adquirida'));
});
