import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTr069EnableRequest, verifyLivePosition, type Tr069EnableOntInput } from '../tr069Enable';

const ontLinked: Tr069EnableOntInput = {
  serial: 'HWTC1D3691B7',
  retired_at: null,
  tr069_enabled: false,
  client_id: 'client-1',
  contract_id: 'contract-1',
  service_contract: { id: 'contract-1' },
};

test('TECNICO_RED no puede habilitar TR-069 (solo ADMIN/SUPERADMIN) — permisos', () => {
  const r = validateTr069EnableRequest({ role: 'TECNICO_RED', ont: ontLinked, oltBrand: 'zte' });
  assert.equal(r.ok, false);
  assert.equal(r.rejection, 'FORBIDDEN_ROLE');
});

test('SOPORTE tampoco puede (rol no usado operativamente, pero por si aparece) — permisos', () => {
  const r = validateTr069EnableRequest({ role: 'SOPORTE', ont: ontLinked, oltBrand: 'zte' });
  assert.equal(r.ok, false);
  assert.equal(r.rejection, 'FORBIDDEN_ROLE');
});

test('ADMIN con ONT vinculada y sin TR-069 previo -> permitido', () => {
  const r = validateTr069EnableRequest({ role: 'ADMIN', ont: ontLinked, oltBrand: 'zte' });
  assert.equal(r.ok, true);
});

test('SUPERADMIN tambien permitido', () => {
  const r = validateTr069EnableRequest({ role: 'SUPERADMIN', ont: ontLinked, oltBrand: 'zte' });
  assert.equal(r.ok, true);
});

test('ONT retirada -> rechazada aunque el rol sea correcto', () => {
  const r = validateTr069EnableRequest({ role: 'ADMIN', ont: { ...ontLinked, retired_at: '2026-01-01T00:00:00Z' }, oltBrand: 'zte' });
  assert.equal(r.ok, false);
  assert.equal(r.rejection, 'RETIRED');
});

test('TR-069 ya habilitado -> rechazada (evita re-ejecutar el comando dos veces por error)', () => {
  const r = validateTr069EnableRequest({ role: 'ADMIN', ont: { ...ontLinked, tr069_enabled: true }, oltBrand: 'zte' });
  assert.equal(r.ok, false);
  assert.equal(r.rejection, 'ALREADY_ENABLED');
});

test('sin client_id -> NOT_LINKED (identidad)', () => {
  const r = validateTr069EnableRequest({ role: 'ADMIN', ont: { ...ontLinked, client_id: null }, oltBrand: 'zte' });
  assert.equal(r.rejection, 'NOT_LINKED');
});

test('sin contract_id -> NOT_LINKED', () => {
  const r = validateTr069EnableRequest({ role: 'ADMIN', ont: { ...ontLinked, contract_id: null }, oltBrand: 'zte' });
  assert.equal(r.rejection, 'NOT_LINKED');
});

test('contract_id presente pero el contrato no se pudo resolver (borrado/invalido) -> NOT_LINKED, nunca se infiere', () => {
  const r = validateTr069EnableRequest({ role: 'ADMIN', ont: { ...ontLinked, service_contract: null }, oltBrand: 'zte' });
  assert.equal(r.rejection, 'NOT_LINKED');
});

test('detecta fabricante Huawei por el serial y marca thirdPartyVendor=true sobre una OLT ZTE', () => {
  const r = validateTr069EnableRequest({ role: 'ADMIN', ont: ontLinked, oltBrand: 'zte' });
  assert.equal(r.vendor.name, 'Huawei');
  assert.equal(r.thirdPartyVendor, true);
});

test('una ONT ZTE sobre OLT ZTE no es de terceros', () => {
  const r = validateTr069EnableRequest({ role: 'ADMIN', ont: { ...ontLinked, serial: 'ZTEGDCE0C3A4' }, oltBrand: 'zte' });
  assert.equal(r.thirdPartyVendor, false);
});

test('el rechazo por rol tambien calcula fabricante/thirdParty (la UI puede mostrar ambos datos igual)', () => {
  const r = validateTr069EnableRequest({ role: 'TECNICO_RED', ont: ontLinked, oltBrand: 'zte' });
  assert.equal(r.vendor.name, 'Huawei');
});

// ---- verifyLivePosition (reverificacion en vivo antes de escribir) ----

test('verifyLivePosition: serial vivo coincide -> ok', () => {
  const r = verifyLivePosition({ expectedSerial: 'HWTC1D3691B7', liveSerial: 'HWTC1D3691B7' });
  assert.equal(r.ok, true);
});

test('verifyLivePosition: coincide salvo mayusculas/minusculas -> ok (la OLT no es consistente con el casing)', () => {
  const r = verifyLivePosition({ expectedSerial: 'HWTC1D3691B7', liveSerial: 'hwtc1d3691b7' });
  assert.equal(r.ok, true);
});

test('verifyLivePosition: la posicion no existe en la config viva -> rechaza, nunca asume', () => {
  const r = verifyLivePosition({ expectedSerial: 'HWTC1D3691B7', liveSerial: null });
  assert.equal(r.ok, false);
  assert.match(r.message!, /no se encontró/i);
});

test('verifyLivePosition: discrepancia real de serial (ONT reemplazada/trasladada) -> rechaza con el detalle de ambos seriales', () => {
  const r = verifyLivePosition({ expectedSerial: 'HWTC1D3691B7', liveSerial: 'ZTEGDCE0C3A4' });
  assert.equal(r.ok, false);
  assert.match(r.message!, /HWTC1D3691B7/);
  assert.match(r.message!, /ZTEGDCE0C3A4/);
});
