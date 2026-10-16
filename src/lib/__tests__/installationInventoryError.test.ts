import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presentInstallationInventoryError } from '../installationInventoryError.ts';

test('instalacion cancelada: oculta el 403 esperado, no hay nada que explicar', () => {
  const denied = Object.assign(new Error('Estado de orden no autorizado'), { status: 403 });
  assert.equal(presentInstallationInventoryError('cancelled', denied), '');
});

test('tecnico retirado de una orden activa: conserva el mensaje real', () => {
  const denied = Object.assign(new Error('Asignacion no vigente'), { status: 403 });
  assert.equal(presentInstallationInventoryError('in_progress', denied), 'Asignacion no vigente');
});

test('instalacion completada: tambien conserva el mensaje real (el RPC si la permite)', () => {
  const failure = Object.assign(new Error('No se pudo consultar el inventario de la orden.'), { status: 500 });
  assert.equal(presentInstallationInventoryError('completed', failure), 'No se pudo consultar el inventario de la orden.');
});

test('instalacion cancelada con un error no-Error (defensivo): igual se oculta', () => {
  assert.equal(presentInstallationInventoryError('cancelled', { code: '42501' }), '');
});

test('sin estado conocido (installation aun no cargada): usa el mensaje por defecto', () => {
  assert.equal(presentInstallationInventoryError(undefined, {}), 'No se pudo cargar el inventario de esta instalación.');
});
