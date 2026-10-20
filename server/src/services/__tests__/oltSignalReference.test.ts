import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OntTelemetryEvidence, type OntEvidence } from '../oltTelemetry';
import { detectSignalAlert } from '../oltAlerts';

const row = {id:'old',olt_device_id:'olt',serial:'MSTC8CCE647E',frame:1,slot:2,port:8,ont_id:3};
const at = Date.parse('2026-10-20T20:00:00Z');
const evidence = (rx = -23.98): OntEvidence => ({oltDeviceId:'olt',serial:row.serial,position:'1/2/8:3',outcome:'valid',status:'online',checkedAt:new Date(at).toISOString(),stateReadAt:new Date(at).toISOString(),validUntil:new Date(at+60000).toISOString(),signalReadAt:new Date(at).toISOString(),observedSerial:row.serial,rxPower:rx,txPower:2,signalOutcome:'valid'});

test('referencia óptica: lectura ausente/fallida conserva comparación, no potencia actual ni duplicados', () => {
  const cache = new OntTelemetryEvidence(()=>at+1000);
  cache.remember(row,evidence()); cache.rememberSignal(row,evidence());
  for (const outcome of ['valid','failed'] as const) {
    cache.remember(row,{...evidence(),outcome,signalOutcome:'not-read',rxPower:null,txPower:null});
    assert.equal(cache.project(row).rx_power,null); assert.equal(cache.signalReference(row),-23.98);
  }
  assert.equal(detectSignalAlert(cache.signalReference(row),-30,-27),'lowSignal');
  cache.rememberSignal(row,evidence(-30));
  assert.equal(detectSignalAlert(cache.signalReference(row),-30,-27),null);
  assert.equal(detectSignalAlert(cache.signalReference(row),-23.98,-27),'signalRecovered');
});

test('referencia óptica: aislamiento por fila, dispositivo, serial, posición y conflicto', () => {
  const cache = new OntTelemetryEvidence(()=>at+1000); cache.rememberSignal(row,evidence());
  for (const changed of [{...row,id:'other'},{...row,olt_device_id:'other'},{...row,serial:'HWTCE5C94DB6'},{...row,ont_id:50}]) {
    const isolated = new OntTelemetryEvidence(()=>at+1000); isolated.rememberSignal(row,evidence());
    assert.equal(isolated.signalReference(changed),null);
  }
  cache.remember(row,{...evidence(),outcome:'conflict'}); assert.equal(cache.signalReference(row),null);
  cache.rememberSignal(row,evidence()); cache.invalidate(row.id); assert.equal(cache.signalReference(row),null);
});

test('referencia óptica: caduca, reinicio sin referencia y lectura histórica nunca sirve de base', () => {
  let now=at; const cache=new OntTelemetryEvidence(()=>now); cache.rememberSignal(row,evidence());
  now += 25*60*60*1000; assert.equal(cache.signalReference(row),null);
  assert.equal(new OntTelemetryEvidence().signalReference(row),null);
  cache.remember(row,evidence()); assert.equal(cache.signalReference(row),null);
});

test('señal cada 90 min: referencia para alertas sobrevive a la vigencia visual, pero tiene límite', () => {
  const savedInterval=process.env.OLT_SYNC_INTERVAL_MINUTES, savedEvery=process.env.OLT_SYNC_SIGNAL_EVERY_N_RUNS;
  try {
    process.env.OLT_SYNC_INTERVAL_MINUTES='30'; process.env.OLT_SYNC_SIGNAL_EVERY_N_RUNS='3';
    let now=at; const cache=new OntTelemetryEvidence(()=>now);
    cache.remember(row,evidence()); cache.rememberSignal(row,evidence());
    now+=90*60000;
    assert.equal(cache.project(row).status,'unknown'); assert.equal(cache.project(row).rx_power,null);
    assert.equal(detectSignalAlert(cache.signalReference(row),-30,-27),'lowSignal');
    now=at+186*60000; assert.equal(cache.signalReference(row),null);
  } finally {
    if(savedInterval===undefined) delete process.env.OLT_SYNC_INTERVAL_MINUTES; else process.env.OLT_SYNC_INTERVAL_MINUTES=savedInterval;
    if(savedEvery===undefined) delete process.env.OLT_SYNC_SIGNAL_EVERY_N_RUNS; else process.env.OLT_SYNC_SIGNAL_EVERY_N_RUNS=savedEvery;
  }
});
