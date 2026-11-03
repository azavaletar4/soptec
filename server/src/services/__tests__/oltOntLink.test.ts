import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateOntLinkRequest, ontLinkAuditRow, type OntLinkCandidate, type ContractLike } from '../oltOntLink';

// Datos de referencia reales (solo para validar la LOGICA de lectura, ver
// diagnostico 2026-11-02/03 — nunca se escribio nada sobre el caso real).
const GUSTAVO_SERIAL = 'ZTEGD4FE1386';
const GUSTAVO_CONTRACT_ID = 'b9704df4-f465-4ce9-a83e-43d415eeacf5';
const GUSTAVO_CLIENT_ID = 'b7525f0c-1ada-4419-b69b-f79db215aca2';

const ont = (over: Partial<OntLinkCandidate> = {}): OntLinkCandidate => ({
  serial: GUSTAVO_SERIAL, client_id: null, contract_id: null, retired_at: null, ...over,
});
const contract = (over: Partial<ContractLike> = {}): ContractLike => ({
  id: GUSTAVO_CONTRACT_ID, client_id: GUSTAVO_CLIENT_ID, status: 'active', ...over,
});
const request = (over: Partial<{ clientId: string; contractId: string; expectedSerial: string }> = {}) => ({
  clientId: GUSTAVO_CLIENT_ID, contractId: GUSTAVO_CONTRACT_ID, expectedSerial: GUSTAVO_SERIAL, ...over,
});

test('caso real de referencia (Gustavo Reyes Sandoval, CTR-2026-00764, ZTEGD4FE1386): vinculacion valida', () => {
  const decision = validateOntLinkRequest(ont(), contract(), request(), false);
  assert.deepEqual(decision, { ok: true });
});

test('ONT retirada -> rechazada, nunca se vincula una ONT retirada', () => {
  const decision = validateOntLinkRequest(ont({ retired_at: '2026-10-01T00:00:00Z' }), contract(), request(), false);
  assert.equal(decision.ok, false);
  if (!decision.ok) { assert.equal(decision.status, 404); }
});

test('ONT ya vinculada a otro cliente/contrato -> rechazada, nunca transfiere un vinculo existente', () => {
  const yaVinculada = ont({ client_id: 'otro-cliente', contract_id: 'otro-contrato' });
  const decision = validateOntLinkRequest(yaVinculada, contract(), request(), false);
  assert.equal(decision.ok, false);
  if (!decision.ok) { assert.equal(decision.status, 409); assert.match(decision.error, /ya está vinculada/); }
});

test('ONT con SOLO client_id ya puesto (vinculo parcial) -> igual rechazada', () => {
  const parcial = ont({ client_id: 'algun-cliente', contract_id: null });
  const decision = validateOntLinkRequest(parcial, contract(), request(), false);
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.status, 409);
});

test('falta clientId o contractId en la solicitud -> rechazada', () => {
  assert.equal(validateOntLinkRequest(ont(), contract(), request({ clientId: '' }), false).ok, false);
  assert.equal(validateOntLinkRequest(ont(), contract(), request({ contractId: '' }), false).ok, false);
});

test('serial distinto al esperado (cambio entre consulta y confirmacion) -> rechazada, concurrencia', () => {
  const decision = validateOntLinkRequest(ont(), contract(), request({ expectedSerial: 'ZTEGOTRASERIE' }), false);
  assert.equal(decision.ok, false);
  if (!decision.ok) { assert.equal(decision.status, 409); assert.match(decision.error, /cambió/); }
});

test('comparacion de serial case-insensitive (no rechaza solo por mayusculas/minusculas)', () => {
  const decision = validateOntLinkRequest(ont(), contract(), request({ expectedSerial: GUSTAVO_SERIAL.toLowerCase() }), false);
  assert.deepEqual(decision, { ok: true });
});

test('contrato inexistente -> rechazada', () => {
  const decision = validateOntLinkRequest(ont(), null, request(), false);
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.status, 404);
});

test('contrato pertenece a OTRO cliente (no al seleccionado) -> rechazada', () => {
  const decision = validateOntLinkRequest(ont(), contract({ client_id: 'cliente-distinto' }), request(), false);
  assert.equal(decision.ok, false);
  if (!decision.ok) { assert.equal(decision.status, 400); assert.match(decision.error, /no pertenece al cliente/); }
});

test('contrato cancelado -> no elegible para vincular', () => {
  const decision = validateOntLinkRequest(ont(), contract({ status: 'cancelled' }), request(), false);
  assert.equal(decision.ok, false);
  if (!decision.ok) { assert.equal(decision.status, 400); assert.match(decision.error, /cancelado/); }
});

test('contrato suspendido SI es elegible (vigente incluye suspendido, mismo criterio del resto del proyecto)', () => {
  const decision = validateOntLinkRequest(ont(), contract({ status: 'suspended' }), request(), false);
  assert.deepEqual(decision, { ok: true });
});

test('contrato ya vinculado a OTRA ONT activa -> rechazada (conflicto, nunca doble vinculo)', () => {
  const decision = validateOntLinkRequest(ont(), contract(), request(), true);
  assert.equal(decision.ok, false);
  if (!decision.ok) { assert.equal(decision.status, 409); assert.match(decision.error, /ya está vinculado a otra ONT/); }
});

test('orden de validacion: ONT ya vinculada se detecta antes que cualquier otro problema', () => {
  // Aunque el contrato tambien este cancelado Y ocupado, el motivo informado
  // es el de la ONT -- evita un mensaje confuso que no explica la causa real.
  const yaVinculada = ont({ client_id: 'x', contract_id: 'y' });
  const decision = validateOntLinkRequest(yaVinculada, contract({ status: 'cancelled' }), request(), true);
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.match(decision.error, /ya está vinculada/);
});

test('ontLinkAuditRow: arma la fila con la posicion formateada y preserva el vinculo previo', () => {
  const row = ontLinkAuditRow({
    ontId: 'ont-1', oltDeviceId: 'device-1', action: 'link',
    clientId: GUSTAVO_CLIENT_ID, contractId: GUSTAVO_CONTRACT_ID,
    previousClientId: null, previousContractId: null,
    serial: GUSTAVO_SERIAL, frame: 1, slot: 2, port: 8, ontNumber: 26,
    performedBy: 'admin-1',
  });
  assert.equal(row.position, '1/2/8:26');
  assert.equal(row.action, 'link');
  assert.equal(row.client_id, GUSTAVO_CLIENT_ID);
  assert.equal(row.previous_client_id, null);
});

test('ontLinkAuditRow: accion "import" siempre sin cliente/contrato (metadata-only)', () => {
  const row = ontLinkAuditRow({
    ontId: 'ont-2', oltDeviceId: 'device-1', action: 'import',
    clientId: null, contractId: null, previousClientId: null, previousContractId: null,
    serial: 'ASKY0001', frame: 1, slot: 2, port: 6, ontNumber: 90,
    performedBy: 'admin-1',
  });
  assert.equal(row.client_id, null);
  assert.equal(row.contract_id, null);
  assert.equal(row.position, '1/2/6:90');
});
