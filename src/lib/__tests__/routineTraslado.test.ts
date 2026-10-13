import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isTrasladoServicioRoutine,
  resolveCurrentOntForContract,
  buildTrasladoHistorialNote,
  resolveTrasladoAnteriorSnapshot,
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

// ---- Punto 3 (revision puntual 2026-10-13): cliente con 2+ servicios —
// la resolucion de "ONT actual" afecta EXCLUSIVAMENTE al contract_id
// elegido, nunca al otro servicio del mismo cliente. ----

test('resolveCurrentOntForContract: cliente con 2 servicios, cada uno con SU PROPIA ONT -> cada contract_id resuelve solo la suya, nunca la del otro servicio', () => {
  const onts = [
    { id: 'ont-internet', serial: 'S-INTERNET', slot: 2, port: 1, status: 'online', contract_id: 'contrato-internet' },
    { id: 'ont-iptv', serial: 'S-IPTV', slot: 2, port: 2, status: 'online', contract_id: 'contrato-iptv' },
  ];
  const rInternet = resolveCurrentOntForContract(onts, 'contrato-internet');
  const rIptv = resolveCurrentOntForContract(onts, 'contrato-iptv');
  assert.equal(rInternet.status, 'found');
  assert.equal(rIptv.status, 'found');
  if (rInternet.status === 'found') assert.equal(rInternet.ont.id, 'ont-internet');
  if (rIptv.status === 'found') assert.equal(rIptv.ont.id, 'ont-iptv');
});

// ---- buildTrasladoHistorialNote ----

test('buildTrasladoHistorialNote: traslado normal, ONT conservada', () => {
  const note = buildTrasladoHistorialNote({
    direccionAnterior: 'Jr. Lima 123',
    zonaAnteriorNombre: 'PON 1 - AO',
    napAnteriorNombre: 'NAP - 01',
    direccionNueva: 'Av. Trujillo 456',
    zonaNuevaNombre: 'PON 4 - B6',
    napNuevaNombre: 'NAP - 09',
    ontAction: 'keep',
    ontSerialNuevo: null,
  });
  assert.match(note, /Jr\. Lima 123 \(PON 1 - AO, NAP: NAP - 01\)/);
  assert.match(note, /Av\. Trujillo 456 \(PON 4 - B6, NAP: NAP - 09\)/);
  assert.match(note, /ONT conservada/);
});

test('buildTrasladoHistorialNote: ONT reemplazada CON serial nuevo -> lo incluye y avisa que falta actualizar la OLT', () => {
  const note = buildTrasladoHistorialNote({
    direccionAnterior: 'Jr. Lima 123',
    zonaAnteriorNombre: 'PON 1 - AO',
    napAnteriorNombre: 'NAP - 01',
    direccionNueva: 'Av. Trujillo 456',
    zonaNuevaNombre: 'PON 4 - B6',
    napNuevaNombre: 'NAP - 09',
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
    napAnteriorNombre: 'NAP - 01',
    direccionNueva: 'Av. Trujillo 456',
    zonaNuevaNombre: 'PON 4 - B6',
    napNuevaNombre: 'NAP - 09',
    ontAction: 'replaced',
    ontSerialNuevo: null,
  });
  assert.match(note, /ONT reemplazada — vínculo en la OLT pendiente/);
});

// ---- Punto 1 (revision puntual 2026-10-13): reintento no debe recalcular
// "anterior" (zona/NAP) desde un contrato que un intento previo ya pudo
// haber modificado. ----

test('resolveTrasladoAnteriorSnapshot: primera vez (sin snapshot previo) -> usa el estado actual', () => {
  const current = { direccionAnterior: 'Jr. Lima 123', zonaAnteriorNombre: 'PON 1 - AO', napAnteriorNombre: 'NAP - 01' };
  assert.deepEqual(resolveTrasladoAnteriorSnapshot(null, current), current);
});

test('resolveTrasladoAnteriorSnapshot: REINTENTO con snapshot ya guardado -> conserva el original (zona Y NAP), IGNORA el estado actual (que un intento previo ya pudo haber cambiado)', () => {
  const original = { direccionAnterior: 'Jr. Lima 123', zonaAnteriorNombre: 'PON 1 - AO', napAnteriorNombre: 'NAP - 01' };
  // "actual" ya refleja la zona/NAP NUEVOS porque un primer intento ya los
  // escribio antes de fallar en un paso posterior (ej. la caja NAP estaba llena).
  const actualYaMutado = { direccionAnterior: 'Av. Trujillo 456', zonaAnteriorNombre: 'PON 4 - B6', napAnteriorNombre: 'NAP - 09' };
  assert.deepEqual(resolveTrasladoAnteriorSnapshot(original, actualYaMutado), original);
});

test('resolveTrasladoAnteriorSnapshot: snapshot previo con valores null (contrato sin direccion/zona/NAP) sigue respetandose, no se reemplaza por el actual', () => {
  const original = { direccionAnterior: null, zonaAnteriorNombre: null, napAnteriorNombre: null };
  const actual = { direccionAnterior: 'Av. Trujillo 456', zonaAnteriorNombre: 'PON 4 - B6', napAnteriorNombre: 'NAP - 09' };
  assert.deepEqual(resolveTrasladoAnteriorSnapshot(original, actual), original);
});

test('buildTrasladoHistorialNote: sin datos previos registrados (contrato nuevo o migracion incompleta) -> no inventa direccion/zona/NAP', () => {
  const note = buildTrasladoHistorialNote({
    direccionAnterior: null,
    zonaAnteriorNombre: null,
    napAnteriorNombre: null,
    direccionNueva: 'Av. Trujillo 456',
    zonaNuevaNombre: 'PON 4 - B6',
    napNuevaNombre: 'NAP - 09',
    ontAction: 'keep',
    ontSerialNuevo: null,
  });
  assert.match(note, /sin datos previos registrados/);
});

test('buildTrasladoHistorialNote: NO duplica la nota — reusar la misma funcion 2 veces con el mismo input da EXACTAMENTE el mismo texto (overwrite, no append)', () => {
  const input = {
    direccionAnterior: 'Jr. Lima 123',
    zonaAnteriorNombre: 'PON 1 - AO',
    napAnteriorNombre: 'NAP - 01',
    direccionNueva: 'Av. Trujillo 456',
    zonaNuevaNombre: 'PON 4 - B6',
    napNuevaNombre: 'NAP - 09',
    ontAction: 'keep' as const,
    ontSerialNuevo: null,
  };
  const primera = buildTrasladoHistorialNote(input);
  const reintento = buildTrasladoHistorialNote(input);
  assert.equal(primera, reintento);
  // una sola flecha "->" -> nunca se concatena una nota sobre la otra.
  assert.equal(reintento.split('→').length, 2);
});
