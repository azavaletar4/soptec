import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScannedCandidates } from '../oltScanCandidates';
import type { TelemetryScan } from '../oltTelemetry';
import type { GlobalOnt, FullConfigOnt } from '../../ssh/zteParsers';

const DEVICE_ID = 'device-zte-c300';

interface Entry {
  frame: number; slot: number; port: number; onuId: number; serial: string;
  runState: string; adminState: 'enable' | 'disable'; name?: string | null;
}

function binding(serial: string, name: string | null = null): FullConfigOnt {
  return { onuType: 'ONU', serial, name, description: null, tcontProfile: null, trafficProfile: null, vlan: null, serviceGemport: null, serviceVlan: null };
}

function baseScan(overrides: Partial<TelemetryScan> = {}): TelemetryScan {
  return {
    before: new Map(), after: new Map(), states: [],
    rx: new Map(), tx: new Map(), failedPorts: [], signalRequested: false,
    checkedAt: new Date().toISOString(), stateReadAt: new Date().toISOString(), signalReadAt: new Map(),
    ...overrides,
  };
}

function makeScan(entries: Entry[]): TelemetryScan {
  const before = new Map<string, FullConfigOnt>();
  const after = new Map<string, FullConfigOnt>();
  const states: GlobalOnt[] = [];
  for (const e of entries) {
    const key = `${e.frame}/${e.slot}/${e.port}:${e.onuId}`;
    const b = binding(e.serial, e.name ?? null);
    before.set(key, b);
    after.set(key, b);
    states.push({ frame: e.frame, slot: e.slot, port: e.port, onuId: e.onuId, runState: e.runState, adminState: e.adminState });
  }
  return baseScan({ before, after, states });
}

test('candidato real valido: caso de referencia Gustavo Reyes Sandoval (ZTEGD4FE1386, 1/2/8:26, ya autorizada en SmartOLT)', () => {
  const scan = makeScan([{ frame: 1, slot: 2, port: 8, onuId: 26, serial: 'ZTEGD4FE1386', runState: 'working', adminState: 'enable', name: 'GUSTAVO REYES' }]);
  const candidates = buildScannedCandidates(DEVICE_ID, scan.states!, scan.after!, scan);
  assert.equal(candidates.length, 1);
  const c = candidates[0]!;
  assert.deepEqual([c.frame, c.slot, c.port, c.ontId, c.serial], [1, 2, 8, 26, 'ZTEGD4FE1386']);
  assert.equal(c.binding.name, 'GUSTAVO REYES');
  assert.equal(c.state.runState, 'working');
});

test('varias ONT reales en distintas posiciones: ninguna se pierde ni se mezcla con otra', () => {
  const scan = makeScan([
    { frame: 1, slot: 2, port: 8, onuId: 26, serial: 'ZTEGD4FE1386', runState: 'working', adminState: 'enable' },
    { frame: 1, slot: 2, port: 4, onuId: 19, serial: 'ZTEGDC5C139E', runState: 'offline', adminState: 'enable' },
  ]);
  const candidates = buildScannedCandidates(DEVICE_ID, scan.states!, scan.after!, scan);
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map((c) => c.serial).sort(), ['ZTEGD4FE1386', 'ZTEGDC5C139E']);
});

test('onuId sin binding de identidad (show running-config no lo reporta): se descarta, nunca candidato a medias', () => {
  const scan = baseScan({ states: [{ frame: 1, slot: 2, port: 8, onuId: 99, runState: 'working', adminState: 'enable' }] });
  const candidates = buildScannedCandidates(DEVICE_ID, scan.states!, scan.after!, scan);
  assert.deepEqual(candidates, []);
});

test('serial inconsistente entre el escaneo "antes" y "despues" (evidencia conflict): se descarta, nunca se expone a medias', () => {
  const key = '1/2/8:26';
  const after = new Map([[key, binding('ZTEGD4FE1386')]]);
  const before = new Map([[key, binding('OTROSERIALVIEJO')]]); // identidad cambio durante el propio escaneo
  const states: GlobalOnt[] = [{ frame: 1, slot: 2, port: 8, onuId: 26, runState: 'working', adminState: 'enable' }];
  const scan = baseScan({ before, after, states });
  const candidates = buildScannedCandidates(DEVICE_ID, states, after, scan);
  assert.deepEqual(candidates, []);
});

test('estado ausente para la posicion (comunicacion fallida en ese tramo): se descarta sin inventar online/offline', () => {
  const key = '1/2/8:26';
  const after = new Map([[key, binding('ZTEGD4FE1386')]]);
  const before = new Map([[key, binding('ZTEGD4FE1386')]]);
  // scan.states vacio: el "show gpon onu state" no trajo esta posicion esta vez.
  const scan = baseScan({ before, after, states: [] });
  const candidates = buildScannedCandidates(DEVICE_ID, [{ frame: 1, slot: 2, port: 8, onuId: 26, runState: 'working', adminState: 'enable' }], after, scan);
  assert.deepEqual(candidates, []);
});

test('lista vacia no rompe', () => {
  const scan = baseScan();
  assert.deepEqual(buildScannedCandidates(DEVICE_ID, [], scan.after!, scan), []);
});
