import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isTrasladoServicioRoutine,
  resolveCurrentOntForContract,
  buildTrasladoHistorialNote,
} from '../routineTraslado';

// ---- isTrasladoServicioRoutine ----

test('isTrasladoServicioRoutine: servicio_cliente + traslado_servicio -> true', () => {
  assert.equal(isTrasladoServicioRoutine('servicio_cliente', 'traslado_servicio'), true);
});

test('isTrasladoServicioRoutine: otro subtipo del mismo grupo -> false', () => {
  assert.equal(isTrasladoServicioRoutine('servicio_cliente', 'tv_box'), false);
});

test('isTrasladoServicioRoutine: subtipo correcto pero OTRO tipo_rutina -> false (nunca se adivina por subtipo solo)', () => {
  assert.equal(isTrasladoServicioRoutine('planta_interna', 'traslado_servicio'), false);
});

test('isTrasladoServicioRoutine: subtipo null (rutina sin subtipo elegido) -> false', () => {
  assert.equal(isTrasladoServicioRoutine('servicio_cliente', null), false);
  assert.equal(isTrasladoServicioRoutine('servicio_cliente', undefined), false);
});

// ---- resolveCurrentOntForContract ----

test('resolveCurrentOntForContract: contrato sin ninguna ONT vinculada -> none', () => {
  const onts = [{ id: 'o1', serial: 'S1', slot: 2, port: 1, status: 'online', contract_id: 'otro-contrato' }];
  assert.deepEqual(resolveCurrentOntForContract(onts, 'contrato-1'), { status: 'none' });
});

test('resolveCurrentOntForContract: exactamente 1 ONT vinculada -> found, con esa ONT', () => {
  const onts = [
    { id: 'o-otro', serial: 'SX', slot: 2, port: 2, status: 'online', contract_id: 'otro-contrato' },
    { id: 'o1', serial: 'S1', slot: 2, port: 1, status: 'online', contract_id: 'contrato-1' },
  ];
  const r = resolveCurrentOntForContract(onts, 'contrato-1');
  assert.equal(r.status, 'found');
  if (r.status === 'found') assert.equal(r.ont.id, 'o1');
});

test('resolveCurrentOntForContract: 2+ ONTs con el mismo contract_id (dato ambiguo) -> ambiguous, nunca elige una al azar', () => {
  const onts = [
    { id: 'o1', serial: 'S1', slot: 2, port: 1, status: 'online', contract_id: 'contrato-1' },
    { id: 'o2', serial: 'S2', slot: 3, port: 1, status: 'online', contract_id: 'contrato-1' },
  ];
  const r = resolveCurrentOntForContract(onts, 'contrato-1');
  assert.deepEqual(r, { status: 'ambiguous', count: 2 });
});

test('resolveCurrentOntForContract: lista vacia -> none', () => {
  assert.deepEqual(resolveCurrentOntForContract([], 'contrato-1'), { status: 'none' });
});

// ---- buildTrasladoHistorialNote ----

test('buildTrasladoHistorialNote: traslado normal, ONT conservada', () => {
  const note = buildTrasladoHistorialNote({
    direccionAnterior: 'Jr. Lima 123',
    zonaAnteriorNombre: 'PON 1 - AO',
    direccionNueva: 'Av. Trujillo 456',
    zonaNuevaNombre: 'PON 4 - B6',
    ontAction: 'keep',
    ontSerialNuevo: null,
  });
  assert.match(note, /Jr\. Lima 123 \(PON 1 - AO\)/);
  assert.match(note, /Av\. Trujillo 456 \(PON 4 - B6\)/);
  assert.match(note, /ONT conservada/);
});

test('buildTrasladoHistorialNote: ONT reemplazada CON serial nuevo -> lo incluye y avisa que falta actualizar la OLT', () => {
  const note = buildTrasladoHistorialNote({
    direccionAnterior: 'Jr. Lima 123',
    zonaAnteriorNombre: 'PON 1 - AO',
    direccionNueva: 'Av. Trujillo 456',
    zonaNuevaNombre: 'PON 4 - B6',
    ontAction: 'replaced',
    ontSerialNuevo: 'ZTEGC1234567',
  });
  assert.match(note, /ONT reemplazada \(nuevo serial: ZTEGC1234567\)/);
  assert.match(note, /pendiente de actualización manual/);
});

test('buildTrasladoHistorialNote: ONT reemplazada SIN serial nuevo (tecnico no lo cargo) -> nota sigue siendo clara, no revienta', () => {
  const note = buildTrasladoHistorialNote({
    direccionAnterior: 'Jr. Lima 123',
    zonaAnteriorNombre: 'PON 1 - AO',
    direccionNueva: 'Av. Trujillo 456',
    zonaNuevaNombre: 'PON 4 - B6',
    ontAction: 'replaced',
    ontSerialNuevo: null,
  });
  assert.match(note, /ONT reemplazada — vínculo en la OLT pendiente/);
});

test('buildTrasladoHistorialNote: sin datos previos registrados (contrato nuevo o migracion incompleta) -> no inventa direccion/zona', () => {
  const note = buildTrasladoHistorialNote({
    direccionAnterior: null,
    zonaAnteriorNombre: null,
    direccionNueva: 'Av. Trujillo 456',
    zonaNuevaNombre: 'PON 4 - B6',
    ontAction: 'keep',
    ontSerialNuevo: null,
  });
  assert.match(note, /sin datos previos registrados/);
});
