import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gponVendorFromSerial, isThirdPartyOnt } from '../gponVendorId';

test('HWTC1D3691B7 (Huawei de prueba) -> fabricante Huawei', () => {
  const vendor = gponVendorFromSerial('HWTC1D3691B7');
  assert.equal(vendor.prefix, 'HWTC');
  assert.equal(vendor.name, 'Huawei');
});

test('ZTEGDCE0C3A4 -> fabricante ZTE', () => {
  const vendor = gponVendorFromSerial('ZTEGDCE0C3A4');
  assert.equal(vendor.name, 'ZTE');
});

test('prefijo desconocido -> name null, pero el prefijo se devuelve igual', () => {
  const vendor = gponVendorFromSerial('QQQQ12345678');
  assert.equal(vendor.prefix, 'QQQQ');
  assert.equal(vendor.name, null);
});

test('serial vacio o null -> prefijo vacio, nunca lanza', () => {
  assert.deepEqual(gponVendorFromSerial(''), { prefix: '', name: null });
  assert.deepEqual(gponVendorFromSerial(null), { prefix: '', name: null });
  assert.deepEqual(gponVendorFromSerial(undefined), { prefix: '', name: null });
});

test('minusculas se normalizan a mayusculas', () => {
  const vendor = gponVendorFromSerial('hwtc1d3691b7');
  assert.equal(vendor.prefix, 'HWTC');
  assert.equal(vendor.name, 'Huawei');
});

test('isThirdPartyOnt: Huawei sobre OLT ZTE -> true (de terceros)', () => {
  const vendor = gponVendorFromSerial('HWTC1D3691B7');
  assert.equal(isThirdPartyOnt(vendor, 'zte'), true);
});

test('isThirdPartyOnt: ZTE sobre OLT ZTE -> false (nativa)', () => {
  const vendor = gponVendorFromSerial('ZTEGDCE0C3A4');
  assert.equal(isThirdPartyOnt(vendor, 'zte'), false);
});

test('isThirdPartyOnt: marca de OLT no mapeada -> no se puede afirmar que sea nativa si hay un prefijo detectado', () => {
  const vendor = gponVendorFromSerial('HWTC1D3691B7');
  assert.equal(isThirdPartyOnt(vendor, 'huawei-olt-no-soportada'), true);
});
