import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enforceOntEvidence } from '../ontTelemetryEvidence';

const now = Date.parse('2026-10-20T21:00:00Z');
const historical = { status: 'online', rxPower: -19.67, txPower: 2.32, at: '2026-10-20T20:31:31Z' };
const live = { status: 'online' as const, rx_power: -23.98, tx_power: 2.35,
  telemetry: { outcome: 'valid', checkedAt: '2026-10-20T20:59:00Z', validUntil: '2026-10-20T21:34:00Z', signalOutcome: 'valid', historical } };
test('pantalla: sin prueba o con prueba caducada nunca se conserva el badge En línea', () => {
  assert.equal(enforceOntEvidence({ status: 'online', rx_power: -19, tx_power: 2 },now).status,'unknown');
  assert.equal(enforceOntEvidence(live,now).status,'online');
  const expired = enforceOntEvidence(live,Date.parse(live.telemetry.validUntil)+1);
  assert.equal(expired.status,'unknown');assert.equal(expired.rx_power,null);assert.deepEqual(expired.telemetry.historical,historical);
});
test('pantalla: conflicto/ausencia/fallo y timestamp ilegible no son desconexiones confirmadas', () => {
  for(const outcome of ['conflict','absent','moved','failed','unconfirmed']){
    const result=enforceOntEvidence({...live,telemetry:{...live.telemetry,outcome}},now);
    assert.equal(result.status,'unknown');assert.equal(result.tx_power,null);
  }
  assert.equal(enforceOntEvidence({...live,telemetry:{...live.telemetry,validUntil:'invalid'}},now).status,'unknown');
});
test('pantalla: estado confirmado y señal no leída/fallida son independientes; no muta el original', () => {
  const original=structuredClone(live);
  for(const signalOutcome of ['failed','not-read']){
    const result=enforceOntEvidence({...live,telemetry:{...live.telemetry,signalOutcome}},now);
    assert.equal(result.status,'online');assert.equal(result.rx_power,null);
  }
  assert.deepEqual(live,original);
});
