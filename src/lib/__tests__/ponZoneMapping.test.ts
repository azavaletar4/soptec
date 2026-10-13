import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePonNumberFromZoneName, buildOfficialPonZoneCatalog, comparePonZone } from '../ponZoneMapping';

// ---- parsePonNumberFromZoneName: tolera el espaciado real e inconsistente del catalogo ----

test('parsePonNumberFromZoneName: formato normal', () => {
  assert.equal(parsePonNumberFromZoneName('PON 1 - AO'), 1);
});

test('parsePonNumberFromZoneName: doble espacio antes del guion (dato real, "PON 12  - B4")', () => {
  assert.equal(parsePonNumberFromZoneName('PON 12  - B4'), 12);
  assert.equal(parsePonNumberFromZoneName('PON 13  - REV'), 13);
});

test('parsePonNumberFromZoneName: sin espacio despues del guion (dato real, "PON 20 -CB")', () => {
  assert.equal(parsePonNumberFromZoneName('PON 20 -CB'), 20);
});

test('parsePonNumberFromZoneName: nombre que NO sigue la convencion -> null, nunca inventa un numero', () => {
  assert.equal(parsePonNumberFromZoneName('Zona Centro'), null);
  assert.equal(parsePonNumberFromZoneName('PON sin numero'), null);
  assert.equal(parsePonNumberFromZoneName(''), null);
});

// ---- buildOfficialPonZoneCatalog ----

test('buildOfficialPonZoneCatalog: mapea 1 a 1 cuando no hay numeros repetidos', () => {
  const zones = [{ id: 'z1', name: 'PON 1 - AO' }, { id: 'z2', name: 'PON 2 - SM' }];
  const catalog = buildOfficialPonZoneCatalog(zones);
  assert.equal(catalog.byPonNumber.get(1)?.id, 'z1');
  assert.equal(catalog.byPonNumber.get(2)?.id, 'z2');
  assert.equal(catalog.duplicatePonNumbers.size, 0);
});

test('buildOfficialPonZoneCatalog: ignora zonas sin numero de PON en el nombre, sin romper el resto', () => {
  const zones = [{ id: 'z1', name: 'Zona Centro' }, { id: 'z2', name: 'PON 2 - SM' }];
  const catalog = buildOfficialPonZoneCatalog(zones);
  assert.equal(catalog.byPonNumber.size, 1);
  assert.equal(catalog.byPonNumber.get(2)?.id, 'z2');
});

test('buildOfficialPonZoneCatalog: 2 zonas con el MISMO numero -> va a duplicatePonNumbers, nunca se elige una al azar', () => {
  const zones = [{ id: 'z1', name: 'PON 5 - A' }, { id: 'z2', name: 'PON 5 - B' }];
  const catalog = buildOfficialPonZoneCatalog(zones);
  assert.equal(catalog.byPonNumber.has(5), false);
  assert.equal(catalog.duplicatePonNumbers.get(5)?.length, 2);
});

// ---- comparePonZone: los 5 casos reales que puede devolver ----

const catalogReal = buildOfficialPonZoneCatalog([
  { id: 'ao', name: 'PON 1 - AO' },
  { id: 'sm', name: 'PON 2 - SM' },
  { id: 'b6', name: 'PON 4 - B6' },
]);

test('comparePonZone: zona oficial y observada coinciden -> match', () => {
  const r = comparePonZone(1, { id: 'ao', name: 'PON 1 - AO' }, catalogReal);
  assert.deepEqual(r, { status: 'match' });
});

test('comparePonZone: PUERTO CON VARIAS ZONAS (observada distinta de la oficial) -> mismatch, con ambas zonas identificadas', () => {
  // Caso real confirmado en produccion: slot2/puerto1 (PON 1) con ONTs de "PON 2 - SM" predominando.
  const r = comparePonZone(1, { id: 'sm', name: 'PON 2 - SM' }, catalogReal);
  assert.equal(r.status, 'mismatch');
  if (r.status === 'mismatch') {
    assert.equal(r.officialZone.id, 'ao');
    assert.equal(r.observedZone.id, 'sm');
  }
});

test('comparePonZone: ONT sin zona vinculada todavia (observedZone null) -> no_observed, no se inventa ninguna', () => {
  assert.deepEqual(comparePonZone(4, null, catalogReal), { status: 'no_observed' });
});

test('comparePonZone: numero de PON sin ninguna zona oficial en el catalogo -> no_official', () => {
  assert.deepEqual(comparePonZone(99, { id: 'ao', name: 'PON 1 - AO' }, catalogReal), { status: 'no_official' });
});

test('comparePonZone: catalogo ambiguo (2 zonas declaran el mismo PON) -> ambiguous_catalog, antes que cualquier otra cosa', () => {
  const dirtyCatalog = buildOfficialPonZoneCatalog([{ id: 'a', name: 'PON 7 - A' }, { id: 'b', name: 'PON 7 - B' }]);
  const r = comparePonZone(7, { id: 'a', name: 'PON 7 - A' }, dirtyCatalog);
  assert.equal(r.status, 'ambiguous_catalog');
  if (r.status === 'ambiguous_catalog') assert.equal(r.candidates.length, 2);
});

test('comparePonZone: caso real de produccion completo (Barrio 6 = PON 4, confirmado Violeta/Mayco)', () => {
  const r = comparePonZone(4, { id: 'b6', name: 'PON 4 - B6' }, catalogReal);
  assert.deepEqual(r, { status: 'match' });
});
