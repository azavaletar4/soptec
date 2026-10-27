import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGponSerial, gponSerialsMatch, matchTr069Device } from '../gponSerial';

// ---- normalizeGponSerial ----

test('ZTE ya en forma canonica (ASCII + hex) -> passthrough en mayusculas', () => {
  assert.equal(normalizeGponSerial('ZTEGDCE0C3A4'), 'ZTEGDCE0C3A4');
  assert.equal(normalizeGponSerial('zteg dce0c3a4'.replace(' ', '')), 'ZTEGDCE0C3A4');
});

test('Huawei real: 16 hex con vendor ID hex-codificado -> decodifica a HWTC + sufijo', () => {
  // "48575443" = H W T C en ASCII — caso real confirmado 2026-10-27.
  assert.equal(normalizeGponSerial('485754431D3691B7'), 'HWTC1D3691B7');
});

test('mismo caso en minusculas -> mismo resultado normalizado', () => {
  assert.equal(normalizeGponSerial('485754431d3691b7'), 'HWTC1D3691B7');
});

test('serial GPON ya canonico, en minusculas -> se normaliza igual que en mayusculas', () => {
  assert.equal(normalizeGponSerial('hwtc1d3691b7'), 'HWTC1D3691B7');
});

test('formato invalido (longitud rara, ej. "000000") -> null, nunca inventa', () => {
  assert.equal(normalizeGponSerial('000000'), null);
});

test('16 hex que NO decodifica a ASCII imprimible valido -> null (no se fuerza una coincidencia)', () => {
  assert.equal(normalizeGponSerial('0000000000000000'), null);
});

test('null/undefined/vacio -> null, nunca lanza', () => {
  assert.equal(normalizeGponSerial(null), null);
  assert.equal(normalizeGponSerial(undefined), null);
  assert.equal(normalizeGponSerial(''), null);
  assert.equal(normalizeGponSerial('   '), null);
});

test('string con espacios alrededor se recorta antes de evaluar', () => {
  assert.equal(normalizeGponSerial('  HWTC1D3691B7  '), 'HWTC1D3691B7');
});

// ---- gponSerialsMatch ----

test('gponSerialsMatch: Huawei GPON vs su mismo serial reportado por TR-069 -> true', () => {
  assert.equal(gponSerialsMatch('HWTC1D3691B7', '485754431D3691B7'), true);
});

test('gponSerialsMatch: seriales GPON realmente distintos -> false, nunca coincidencia parcial', () => {
  assert.equal(gponSerialsMatch('HWTC1D3691B7', 'ZTEGDCE0C3A4'), false);
  // comparten sufijo pero NO son el mismo serial completo — nunca debe dar true por eso solo.
  assert.equal(gponSerialsMatch('HWTC1D3691B7', 'ZTEG1D3691B7'), false);
});

test('gponSerialsMatch: si cualquiera de los dos es invalido -> false, nunca asume', () => {
  assert.equal(gponSerialsMatch('HWTC1D3691B7', '000000'), false);
  assert.equal(gponSerialsMatch('', ''), false);
});

// ---- matchTr069Device ----

const devices = [
  { cpe_serial: '485754431D3691B7' }, // Huawei real, formato TR-069 hex
  { cpe_serial: 'ZTEGDCE0C3A4' }, // ZTE F670L, ya canonico
  { cpe_serial: '000000' }, // dispositivo viejo/incompleto
];

test('ONT Huawei real (HWTC1D3691B7) encuentra su dispositivo TR-069 exacto, formato distinto', () => {
  const result = matchTr069Device('HWTC1D3691B7', devices);
  assert.equal(result.device, devices[0]);
  assert.equal(result.rejection, undefined);
});

test('ONT ZTE encuentra su dispositivo exacto (ya canonico de ambos lados)', () => {
  const result = matchTr069Device('ZTEGDCE0C3A4', devices);
  assert.equal(result.device, devices[1]);
});

test('ONT sin ningun dispositivo TR-069 correspondiente -> NO_MATCH, nunca inventa', () => {
  const result = matchTr069Device('HWTCFFFFFFFF', devices);
  assert.equal(result.device, null);
  assert.equal(result.rejection, 'NO_MATCH');
});

test('serial de la ONT invalido -> INVALID_ONT_SERIAL, no se busca nada', () => {
  const result = matchTr069Device('no-es-un-serial', devices);
  assert.equal(result.device, null);
  assert.equal(result.rejection, 'INVALID_ONT_SERIAL');
});

test('serial de la ONT null/vacio -> INVALID_ONT_SERIAL', () => {
  assert.equal(matchTr069Device(null, devices).rejection, 'INVALID_ONT_SERIAL');
  assert.equal(matchTr069Device('', devices).rejection, 'INVALID_ONT_SERIAL');
});

test('coincidencia AMBIGUA (dos dispositivos distintos normalizan al mismo serial) -> no vincula ninguno', () => {
  const ambiguous = [{ cpe_serial: 'HWTC1D3691B7' }, { cpe_serial: '485754431D3691B7' }];
  const result = matchTr069Device('HWTC1D3691B7', ambiguous);
  assert.equal(result.device, null);
  assert.equal(result.rejection, 'AMBIGUOUS');
});

test('dispositivos con cpe_serial invalido/null en la lista nunca producen un falso positivo', () => {
  const withNulls = [{ cpe_serial: null }, { cpe_serial: '000000' }, { cpe_serial: 'HWTC1D3691B7' }];
  const result = matchTr069Device('HWTC1D3691B7', withNulls);
  assert.equal(result.device, withNulls[2]);
});
