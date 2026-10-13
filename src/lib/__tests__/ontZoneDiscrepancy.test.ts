import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOfficialPonZoneCatalog } from '../ponZoneMapping';
import { buildPonNumberMap, evaluateOntZoneDiscrepancies, type OntZoneDiscrepancyOnt } from '../ontZoneDiscrepancy';

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
