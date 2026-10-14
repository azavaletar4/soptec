import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOfficialPonZoneCatalog } from '../ponZoneMapping';
import {
  buildPonNumberMap,
  evaluateOntZoneDiscrepancies,
  countPonPortIssues,
  ontsInZone,
  type OntZoneDiscrepancyOnt,
} from '../ontZoneDiscrepancy';

const catalog = buildOfficialPonZoneCatalog([
  { id: 'ao', name: 'PON 1 - AO' },
  { id: 'sm', name: 'PON 2 - SM' },
  { id: 'b6', name: 'PON 4 - B6' },
]);

// slot2/puerto1 = PON 1, slot2/puerto2 = PON 2, slot3/puerto1 = PON 4 (correlativo real, ver 13ac/13ad)
const ponMap = buildPonNumberMap([
  { slot: 2, port: 1, ponNumber: 1 },
  { slot: 2, port: 2, ponNumber: 2 },
  { slot: 3, port: 1, ponNumber: 4 },
  { slot: 9, port: 9, ponNumber: 99 }, // numero sin ninguna zona en el catalogo
]);

function base(overrides: Partial<OntZoneDiscrepancyOnt>): OntZoneDiscrepancyOnt {
  return {
    id: 'ont-1',
    serial: 'ZTEG0001',
    slot: 2,
    port: 1,
    ont_id: 1,
    client_id: null,
    contract_id: null,
    ...overrides,
  };
}

test('ONT vinculada con zona de ONT y de contrato coincidiendo con la oficial -> match, con cliente/contrato visibles', () => {
  const ont = base({
    client_id: 'cli-1',
    contract_id: 'ctr-1',
    zones: { id: 'ao', name: 'PON 1 - AO' },
    clients: { id: 'cli-1', first_name: 'Violeta', last_name: 'Garcia Silva' },
    service_contracts: { id: 'ctr-1', contract_number: 'C-001', client_code: 'CL-001', status: 'active', zones: { id: 'ao', name: 'PON 1 - AO' } },
  });
  const [r] = evaluateOntZoneDiscrepancies([ont], ponMap, catalog);
  assert.equal(r.caseStatus, 'match');
  assert.equal(r.ponNumber, 1);
  assert.deepEqual(r.client, { id: 'cli-1', name: 'Violeta Garcia Silva' });
  assert.deepEqual(r.contract, { id: 'ctr-1', contractNumber: 'C-001', clientCode: 'CL-001' });
});

test('ONT vinculada pero con zona de ONT distinta de la oficial del PON -> zone_mismatch (caso real: puerto con varias zonas)', () => {
  // mismo puerto PON 1 (slot2/puerto1) pero esta ONT en particular quedo con zona "SM" vinculada -> no es "el puerto", es ESTA ont.
  const ont = base({
    client_id: 'cli-2',
    contract_id: 'ctr-2',
    zones: { id: 'sm', name: 'PON 2 - SM' },
    clients: { id: 'cli-2', first_name: 'Mayco', last_name: 'Paredes Rodriguez' },
    service_contracts: { id: 'ctr-2', contract_number: 'C-002', client_code: 'CL-002', status: 'active', zones: { id: 'sm', name: 'PON 2 - SM' } },
  });
  const [r] = evaluateOntZoneDiscrepancies([ont], ponMap, catalog);
  assert.equal(r.caseStatus, 'zone_mismatch');
  assert.equal(r.ontVsOfficial, 'mismatch');
  assert.equal(r.contractVsOfficial, 'mismatch');
  assert.equal(r.officialZone?.id, 'ao');
});

test('un puerto con ONTs de VARIAS zonas no genera falso positivo: cada ONT se evalua por su propio vinculo, no por el puerto', () => {
  const ontOk = base({
    id: 'ont-ok',
    client_id: 'cli-3',
    contract_id: 'ctr-3',
    zones: { id: 'ao', name: 'PON 1 - AO' },
    clients: { id: 'cli-3', first_name: 'Cliente', last_name: 'Correcto' },
    service_contracts: { id: 'ctr-3', contract_number: 'C-003', client_code: 'CL-003', status: 'active', zones: { id: 'ao', name: 'PON 1 - AO' } },
  });
  const ontMal = base({
    id: 'ont-mal',
    client_id: 'cli-4',
    contract_id: 'ctr-4',
    zones: { id: 'sm', name: 'PON 2 - SM' },
    clients: { id: 'cli-4', first_name: 'Cliente', last_name: 'Desalineado' },
    service_contracts: { id: 'ctr-4', contract_number: 'C-004', client_code: 'CL-004', status: 'active', zones: { id: 'sm', name: 'PON 2 - SM' } },
  });
  const [ok, mal] = evaluateOntZoneDiscrepancies([ontOk, ontMal], ponMap, catalog);
  assert.equal(ok.caseStatus, 'match');
  assert.equal(mal.caseStatus, 'zone_mismatch');
});

test('ONT sin client_id (Situacion A, heredada de SmartOLT) -> unlinked, nunca se infiere cliente/contrato', () => {
  const ont = base({ client_id: null, contract_id: null, zones: null });
  const [r] = evaluateOntZoneDiscrepancies([ont], ponMap, catalog);
  assert.equal(r.caseStatus, 'unlinked');
  assert.equal(r.client, null);
  assert.equal(r.contract, null);
});

test('ONT con contract_id pero sin client_id (dato inconsistente) -> sigue unlinked, nunca expone cliente/contrato parcial', () => {
  const ont = base({
    client_id: null,
    contract_id: 'ctr-5',
    service_contracts: { id: 'ctr-5', contract_number: 'C-005', client_code: 'CL-005', status: 'active', zones: { id: 'ao', name: 'PON 1 - AO' } },
  });
  const [r] = evaluateOntZoneDiscrepancies([ont], ponMap, catalog);
  assert.equal(r.caseStatus, 'unlinked');
  assert.equal(r.client, null);
  assert.equal(r.contract, null);
});

test('contrato con multiples servicios: cada ONT evalua SU PROPIO contract_id/zone_id, sin mezclar con otro servicio del mismo cliente', () => {
  const servicioInternet = base({
    id: 'ont-internet',
    slot: 2,
    port: 1,
    client_id: 'cli-multi',
    contract_id: 'ctr-internet',
    zones: { id: 'ao', name: 'PON 1 - AO' },
    clients: { id: 'cli-multi', first_name: 'Cliente', last_name: 'MultiServicio' },
    service_contracts: { id: 'ctr-internet', contract_number: 'C-010', client_code: 'CL-010', status: 'active', zones: { id: 'ao', name: 'PON 1 - AO' } },
  });
  const servicioSegundo = base({
    id: 'ont-segundo',
    slot: 2,
    port: 2,
    ont_id: 2,
    client_id: 'cli-multi',
    contract_id: 'ctr-segundo',
    zones: { id: 'sm', name: 'PON 2 - SM' },
    clients: { id: 'cli-multi', first_name: 'Cliente', last_name: 'MultiServicio' },
    service_contracts: { id: 'ctr-segundo', contract_number: 'C-011', client_code: 'CL-011', status: 'active', zones: { id: 'sm', name: 'PON 2 - SM' } },
  });
  const [a, b] = evaluateOntZoneDiscrepancies([servicioInternet, servicioSegundo], ponMap, catalog);
  assert.equal(a.caseStatus, 'match');
  assert.equal(b.caseStatus, 'match');
  assert.equal(a.contract?.contractNumber, 'C-010');
  assert.equal(b.contract?.contractNumber, 'C-011');
});

test('traslado en curso: zona de la ONT todavia vieja, zona del contrato ya actualizada a la nueva -> zone_mismatch, muestra ambas sin resolver', () => {
  const ont = base({
    client_id: 'cli-6',
    contract_id: 'ctr-6',
    zones: { id: 'sm', name: 'PON 2 - SM' }, // vieja, no sincronizada aun
    clients: { id: 'cli-6', first_name: 'Cliente', last_name: 'Trasladado' },
    service_contracts: { id: 'ctr-6', contract_number: 'C-006', client_code: 'CL-006', status: 'active', zones: { id: 'ao', name: 'PON 1 - AO' } }, // nueva, ya correcta
  });
  const [r] = evaluateOntZoneDiscrepancies([ont], ponMap, catalog);
  assert.equal(r.caseStatus, 'zone_mismatch');
  assert.equal(r.ontVsOfficial, 'mismatch');
  assert.equal(r.contractVsOfficial, 'match');
  assert.equal(r.ontZone?.id, 'sm');
  assert.equal(r.contractZone?.id, 'ao');
});

test('PON sin ninguna zona oficial en el catalogo -> no_official, sin inventar una zona', () => {
  const ont = base({ slot: 9, port: 9, client_id: 'cli-7', contract_id: 'ctr-7' });
  const [r] = evaluateOntZoneDiscrepancies([ont], ponMap, catalog);
  assert.equal(r.caseStatus, 'no_official');
  assert.equal(r.officialZone, null);
});

test('catalogo ambiguo (2 zonas con el mismo numero de PON) -> ambiguous_catalog antes que cualquier otra clasificacion', () => {
  const dirtyCatalog = buildOfficialPonZoneCatalog([{ id: 'x', name: 'PON 7 - X' }, { id: 'y', name: 'PON 7 - Y' }]);
  const dirtyMap = buildPonNumberMap([{ slot: 5, port: 1, ponNumber: 7 }]);
  const ont = base({ slot: 5, port: 1, client_id: 'cli-8', contract_id: 'ctr-8', zones: { id: 'x', name: 'PON 7 - X' } });
  const [r] = evaluateOntZoneDiscrepancies([ont], dirtyMap, dirtyCatalog);
  assert.equal(r.caseStatus, 'ambiguous_catalog');
  assert.equal(r.ambiguousCandidates?.length, 2);
});

test('slot/puerto que no aparece en el mapa de PON (nunca sincronizado ese puerto) -> no_official, no explota', () => {
  const ont = base({ slot: 99, port: 99, client_id: 'cli-9', contract_id: 'ctr-9' });
  const [r] = evaluateOntZoneDiscrepancies([ont], ponMap, catalog);
  assert.equal(r.caseStatus, 'no_official');
  assert.equal(r.ponNumber, null);
});

// ---- countPonPortIssues (corregion puntual 2026-10-13, ver 13aq): migracion
// SmartOLT (~400 ONTs sin vincular) nunca debe inflar "discrepancia real". ----

test('countPonPortIssues: puerto con 1 sola ONT y todo coincide (match) -> los 3 contadores en cero', () => {
  const ontOk = base({
    client_id: 'cli-1',
    contract_id: 'ctr-1',
    zones: { id: 'ao', name: 'PON 1 - AO' },
    clients: { id: 'cli-1', first_name: 'Cliente', last_name: 'Ok' },
    service_contracts: { id: 'ctr-1', contract_number: 'C-1', client_code: 'CL-1', status: 'active', zones: { id: 'ao', name: 'PON 1 - AO' } },
  });
  const [r] = evaluateOntZoneDiscrepancies([ontOk], ponMap, catalog);
  assert.deepEqual(countPonPortIssues([r]), { pendienteVinculacion: 0, discrepanciaReal: 0, datosAmbiguos: 0 });
});

test('countPonPortIssues: caso real de la migracion — 9 ONTs sin vincular (SmartOLT) + 1 vinculada correcta -> pendienteVinculacion=9, discrepanciaReal=0, NUNCA se cuentan como discrepancia', () => {
  const sinVincular = Array.from({ length: 9 }, (_, i) =>
    base({ id: `ont-sinvincular-${i}`, client_id: null, contract_id: null }),
  );
  const vinculadaOk = base({
    id: 'ont-ok',
    client_id: 'cli-ok',
    contract_id: 'ctr-ok',
    zones: { id: 'ao', name: 'PON 1 - AO' },
    clients: { id: 'cli-ok', first_name: 'Cliente', last_name: 'Ok' },
    service_contracts: { id: 'ctr-ok', contract_number: 'C-OK', client_code: 'CL-OK', status: 'active', zones: { id: 'ao', name: 'PON 1 - AO' } },
  });
  const rows = evaluateOntZoneDiscrepancies([...sinVincular, vinculadaOk], ponMap, catalog);
  assert.deepEqual(countPonPortIssues(rows), { pendienteVinculacion: 9, discrepanciaReal: 0, datosAmbiguos: 0 });
});

test('countPonPortIssues: 1 ONT vinculada con zona real distinta de la oficial -> discrepanciaReal=1, separado de las sin vincular del mismo puerto', () => {
  const sinVincular = base({ id: 'ont-sinvincular', client_id: null, contract_id: null });
  const conMismatch = base({
    id: 'ont-mismatch',
    client_id: 'cli-mal',
    contract_id: 'ctr-mal',
    zones: { id: 'sm', name: 'PON 2 - SM' },
    clients: { id: 'cli-mal', first_name: 'Cliente', last_name: 'Desalineado' },
    service_contracts: { id: 'ctr-mal', contract_number: 'C-MAL', client_code: 'CL-MAL', status: 'active', zones: { id: 'sm', name: 'PON 2 - SM' } },
  });
  const rows = evaluateOntZoneDiscrepancies([sinVincular, conMismatch], ponMap, catalog);
  assert.deepEqual(countPonPortIssues(rows), { pendienteVinculacion: 1, discrepanciaReal: 1, datosAmbiguos: 0 });
});

test('countPonPortIssues: catalogo ambiguo y PON sin zona oficial van juntos a "datosAmbiguos", nunca a discrepanciaReal', () => {
  const dirtyCatalog = buildOfficialPonZoneCatalog([{ id: 'x', name: 'PON 7 - X' }, { id: 'y', name: 'PON 7 - Y' }]);
  const dirtyMap = buildPonNumberMap([{ slot: 5, port: 1, ponNumber: 7 }]);
  const ambiguo = base({ id: 'ont-ambiguo', slot: 5, port: 1, client_id: 'cli-8', contract_id: 'ctr-8' });
  const sinOficial = base({ id: 'ont-sinoficial', slot: 9, port: 9, client_id: 'cli-9', contract_id: 'ctr-9' });
  const rowsAmbiguo = evaluateOntZoneDiscrepancies([ambiguo], dirtyMap, dirtyCatalog);
  const rowsSinOficial = evaluateOntZoneDiscrepancies([sinOficial], ponMap, catalog);
  assert.deepEqual(countPonPortIssues([...rowsAmbiguo, ...rowsSinOficial]), { pendienteVinculacion: 0, discrepanciaReal: 0, datosAmbiguos: 2 });
});

test('countPonPortIssues: lista vacia -> los 3 contadores en cero', () => {
  assert.deepEqual(countPonPortIssues([]), { pendienteVinculacion: 0, discrepanciaReal: 0, datosAmbiguos: 0 });
});

// ---- ontsInZone (ajuste puntual 2026-10-13, 13ar): caso real reportado en
// produccion — PON 01 (Slot 2/Puerto 1), 61 ONTs totales: 57 en "PON 1 - AO",
// 2 en "PON 2 - SM", 2 sin ninguna zona propia asignada (quedaban "sin
// explicar" en el desglose). La suma de las 3 categorias debe dar el total
// exacto, sin inventar ni duplicar. ----

test('ontsInZone: caso real 57 + 2 + 2 = 61 — cada zona (y "sin zona") resuelve exactamente su propio subconjunto, la suma da el total', () => {
  const zonaAo = { id: 'ao', name: 'PON 1 - AO' };
  const zonaSm = { id: 'sm', name: 'PON 2 - SM' };
  const onts: OntZoneDiscrepancyOnt[] = [
    ...Array.from({ length: 57 }, (_, i) => base({ id: `ao-${i}`, zones: zonaAo })),
    ...Array.from({ length: 2 }, (_, i) => base({ id: `sm-${i}`, zones: zonaSm })),
    ...Array.from({ length: 2 }, (_, i) => base({ id: `sinzona-${i}` })), // sin zones -> ontZone null
  ];
  const rows = evaluateOntZoneDiscrepancies(onts, ponMap, catalog);
  assert.equal(rows.length, 61);

  const enAo = ontsInZone(rows, 'ao');
  const enSm = ontsInZone(rows, 'sm');
  const sinZona = ontsInZone(rows, null);

  assert.equal(enAo.length, 57);
  assert.equal(enSm.length, 2);
  assert.equal(sinZona.length, 2);
  assert.equal(enAo.length + enSm.length + sinZona.length, 61); // suma = total real, sin duplicar ni inventar

  // ninguna fila aparece en mas de una categoria (sin duplicar equipos).
  const ids = [...enAo, ...enSm, ...sinZona].map((r) => r.ontDbId);
  assert.equal(new Set(ids).size, ids.length);
});

test('ontsInZone: zona sin ninguna ONT -> vacio, no inventa filas', () => {
  const onts = [base({ id: 'o1', zones: { id: 'ao', name: 'PON 1 - AO' } })];
  const rows = evaluateOntZoneDiscrepancies(onts, ponMap, catalog);
  assert.deepEqual(ontsInZone(rows, 'sm'), []);
});

test('ontsInZone: todas sin zona -> ontsInZone(rows, null) devuelve todas, ninguna zona real tiene ninguna', () => {
  const onts = [base({ id: 'o1' }), base({ id: 'o2' })];
  const rows = evaluateOntZoneDiscrepancies(onts, ponMap, catalog);
  assert.equal(ontsInZone(rows, null).length, 2);
  assert.equal(ontsInZone(rows, 'ao').length, 0);
});

test('evaluateOntZoneDiscrepancies: description pasa tal cual (solo para mostrar en el modal), null si no viene', () => {
  const conDescripcion = base({ id: 'o1', description: 'Juan Perez - Jr. Lima 123' });
  const sinDescripcion = base({ id: 'o2' });
  const [r1, r2] = evaluateOntZoneDiscrepancies([conDescripcion, sinDescripcion], ponMap, catalog);
  assert.equal(r1.description, 'Juan Perez - Jr. Lima 123');
  assert.equal(r2.description, null);
});
