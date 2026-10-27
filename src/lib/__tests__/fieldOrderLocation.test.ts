import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldOrderLocation, isOrderContract } from '../fieldOrderLocation.ts';
import { mapsLink, wazeLink } from '../phone.ts';

const client = { id: 'client', address: 'Dirección general' };
const job = { clientId: client.id, contractId: 'contract-3', direccion: 'Dirección anterior' };
const contract = { id: 'contract-3', client_id: client.id, contract_number: 'CTR-TEST-003',
  installation_address: 'Dirección del tercer contrato', latitude: -12.3, longitude: -77.3 };
const generalGps = { lat: -11, lng: -76 };

test('contrato exacto del mismo cliente: dirección, código y navegación coherentes', () => {
  const result = fieldOrderLocation(job, client, contract, generalGps);
  assert.equal(result.address, contract.installation_address);
  assert.equal(result.contractNumber, contract.contract_number);
  assert.equal(result.source, 'contract');
  assert.deepEqual(result.gps, { lat: -12.3, lng: -77.3 });
  assert.equal(mapsLink(result.gps!.lat, result.gps!.lng), 'https://www.google.com/maps/dir/?api=1&destination=-12.3,-77.3');
  assert.equal(wazeLink(result.gps!.lat, result.gps!.lng), 'https://waze.com/ul?ll=-12.3,-77.3&navigate=yes');
});

test('contrato vacío o con espacios: alternativa general identificada y GPS propio', () => {
  for (const installation_address of [null, '', '   ']) {
    const result = fieldOrderLocation(job, client, { ...contract, installation_address }, generalGps);
    assert.equal(result.address, client.address);
    assert.equal(result.source, 'client');
    assert.deepEqual(result.gps, { lat: -12.3, lng: -77.3 });
  }
});

test('sin dirección en ninguna ficha: no inventa un destino', () => {
  assert.equal(fieldOrderLocation(job, { ...client, address: null }, { ...contract, installation_address: null }, generalGps).address, null);
});

test('contrato ausente, distinto o de otro cliente: no usa el primer servicio ni su GPS', () => {
  for (const invalid of [null, { ...contract, id: 'contract-1' }, { ...contract, client_id: 'another-client' }]) {
    assert.equal(isOrderContract(job, invalid), false);
    const result = fieldOrderLocation(job, client, invalid, generalGps);
    assert.equal(result.source, 'unavailable');
    assert.equal(result.address, null);
    assert.equal(result.contractNumber, null);
    assert.equal(result.gps, null);
  }
});

test('GPS parcial, inválido o ausente: no mezcla coordenadas con las del cliente', () => {
  for (const patch of [{ latitude: null }, { longitude: null }, { latitude: NaN }, { longitude: Infinity }, { latitude: 91 }, { longitude: 181 }]) {
    const result = fieldOrderLocation(job, client, { ...contract, ...patch }, generalGps);
    assert.equal(result.address, contract.installation_address);
    assert.equal(result.gps, null);
  }
  assert.deepEqual(fieldOrderLocation(job, client, { ...contract, latitude: 0, longitude: 0 }, generalGps).gps, { lat: 0, lng: 0 });
});

test('sin contrato: conserva dirección y GPS anteriores, incluido destino de rutina', () => {
  for (const direccion of [null, 'Dirección anterior', 'Destino de rutina sin cliente']) {
    const result = fieldOrderLocation({ ...job, contractId: null, direccion }, client, contract, generalGps);
    assert.equal(result.address, direccion);
    assert.deepEqual(result.gps, generalGps);
    assert.equal(result.source, 'legacy');
    assert.equal(result.contractNumber, null);
  }
});

test('la alternativa no toma dirección de un cliente ajeno ni muta objetos', () => {
  const input = Object.freeze({ ...contract, installation_address: null });
  const result = fieldOrderLocation(Object.freeze(job), Object.freeze({ ...client, id: 'other' }), input, generalGps);
  assert.equal(result.address, null);
  assert.equal(input.installation_address, null);
});
