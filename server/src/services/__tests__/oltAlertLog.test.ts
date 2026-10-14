import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOltAlertLogRows, type OltAlertLogSourceEvent, type OltAlertLogSourceOnt } from '../oltAlertLog';

function event(overrides: Partial<OltAlertLogSourceEvent> = {}): OltAlertLogSourceEvent {
  return { oltDeviceId: 'dev-1', ontDbId: 'ont-1', kind: 'offline', message: 'ONT slot 2/puerto 1/onu-id 5 se desconectó', at: '2026-10-14T13:31:00.000Z', ...overrides };
}

test('ONT vinculada (client_id y contract_id presentes) -> fila con el snapshot de ambos', () => {
  const ontsById = new Map<string, OltAlertLogSourceOnt>([['ont-1', { client_id: 'cli-1', contract_id: 'ctr-1' }]]);
  const [row] = buildOltAlertLogRows([event()], ontsById);
  assert.equal(row.client_id, 'cli-1');
  assert.equal(row.contract_id, 'ctr-1');
  assert.equal(row.olt_ont_id, 'ont-1');
  assert.equal(row.kind, 'offline');
  assert.equal(row.at, '2026-10-14T13:31:00.000Z');
});

test('ONT sin ningun vinculo -> client_id/contract_id null, nunca inventa (migracion SmartOLT)', () => {
  const ontsById = new Map<string, OltAlertLogSourceOnt>([['ont-1', { client_id: null, contract_id: null }]]);
  const [row] = buildOltAlertLogRows([event()], ontsById);
  assert.equal(row.client_id, null);
  assert.equal(row.contract_id, null);
});

test('vinculo PARCIAL (contract_id sin client_id, dato inconsistente) -> ambos quedan null, nunca un vinculo a medias', () => {
  const ontsById = new Map<string, OltAlertLogSourceOnt>([['ont-1', { client_id: null, contract_id: 'ctr-1' }]]);
  const [row] = buildOltAlertLogRows([event()], ontsById);
  assert.equal(row.client_id, null);
  assert.equal(row.contract_id, null);
});

test('vinculo PARCIAL inverso (client_id sin contract_id) -> ambos null tambien', () => {
  const ontsById = new Map<string, OltAlertLogSourceOnt>([['ont-1', { client_id: 'cli-1', contract_id: null }]]);
  const [row] = buildOltAlertLogRows([event()], ontsById);
  assert.equal(row.client_id, null);
  assert.equal(row.contract_id, null);
});

test('ONT no encontrada en el mapa (no deberia pasar, pero no revienta) -> client_id/contract_id null', () => {
  const [row] = buildOltAlertLogRows([event()], new Map());
  assert.equal(row.client_id, null);
  assert.equal(row.contract_id, null);
  assert.equal(row.olt_ont_id, 'ont-1');
});

test('cliente con multiples servicios: 2 eventos de 2 ONTs distintas del mismo cliente -> cada fila con SU PROPIO contract_id, nunca mezclados', () => {
  const ontsById = new Map<string, OltAlertLogSourceOnt>([
    ['ont-internet', { client_id: 'cli-multi', contract_id: 'ctr-internet' }],
    ['ont-iptv', { client_id: 'cli-multi', contract_id: 'ctr-iptv' }],
  ]);
  const events = [event({ ontDbId: 'ont-internet', kind: 'offline' }), event({ ontDbId: 'ont-iptv', kind: 'recovered' })];
  const [rowInternet, rowIptv] = buildOltAlertLogRows(events, ontsById);
  assert.equal(rowInternet.contract_id, 'ctr-internet');
  assert.equal(rowIptv.contract_id, 'ctr-iptv');
  assert.equal(rowInternet.client_id, 'cli-multi');
  assert.equal(rowIptv.client_id, 'cli-multi');
});

test('reconexion y desconexion conservan su propio kind y mensaje tecnico', () => {
  const ontsById = new Map<string, OltAlertLogSourceOnt>([['ont-1', { client_id: null, contract_id: null }]]);
  const [offlineRow, recoveredRow] = buildOltAlertLogRows(
    [event({ kind: 'offline', message: 'se desconectó' }), event({ kind: 'recovered', message: 'volvió a estar en línea' })],
    ontsById,
  );
  assert.equal(offlineRow.kind, 'offline');
  assert.equal(offlineRow.detail, 'se desconectó');
  assert.equal(recoveredRow.kind, 'recovered');
  assert.equal(recoveredRow.detail, 'volvió a estar en línea');
});

test('lista vacia -> ninguna fila', () => {
  assert.deepEqual(buildOltAlertLogRows([], new Map()), []);
});

test('señal baja/recuperada tambien se registran (mismo criterio de vinculo que conexion/desconexion)', () => {
  const ontsById = new Map<string, OltAlertLogSourceOnt>([['ont-1', { client_id: 'cli-1', contract_id: 'ctr-1' }]]);
  const [row] = buildOltAlertLogRows([event({ kind: 'lowSignal' })], ontsById);
  assert.equal(row.kind, 'lowSignal');
  assert.equal(row.client_id, 'cli-1');
});
