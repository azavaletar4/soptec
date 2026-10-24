import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeInterfaceDelta,
  decideAlertTransition,
  evaluateSaturation,
  findInterfaceByName,
  type SaturationSample,
} from '../../mikrotik/borderTraffic';

test('computeInterfaceDelta: primera lectura (sin estado previo) no inventa un delta', () => {
  const r = computeInterfaceDelta(null, { rx: 1_000_000, tx: 500_000 }, 60);
  assert.deepEqual(r, { intervalSeconds: 60, rxBytes: 0, txBytes: 0, rxBps: 0, txBps: 0 });
});

test('computeInterfaceDelta: caso normal — bytes/bps correctos', () => {
  // 60s, 75,000,000 bytes RX -> 10,000,000 bytes/s*8 = 10,000,000 bps = 10 Mbps
  const r = computeInterfaceDelta({ rx: 1_000_000_000, tx: 200_000_000 }, { rx: 1_600_000_000, tx: 260_000_000 }, 60);
  assert.equal(r.rxBytes, 600_000_000);
  assert.equal(r.txBytes, 60_000_000);
  assert.equal(r.rxBps, Math.round((600_000_000 * 8) / 60));
  assert.equal(r.txBps, Math.round((60_000_000 * 8) / 60));
});

test('computeInterfaceDelta: contador menor al anterior (reinicio/reconexion) usa el valor crudo, nunca negativo', () => {
  const r = computeInterfaceDelta({ rx: 5_000_000_000, tx: 1_000_000_000 }, { rx: 200_000, tx: 50_000 }, 60);
  assert.equal(r.rxBytes, 200_000);
  assert.equal(r.txBytes, 50_000);
  assert.ok(r.rxBps >= 0 && r.txBps >= 0);
});

test('computeInterfaceDelta: acota el intervalo entre 1s y 6h (evita bps absurdos por un gap gigante)', () => {
  const r = computeInterfaceDelta({ rx: 0, tx: 0 }, { rx: 1000, tx: 1000 }, 999_999);
  assert.equal(r.intervalSeconds, 6 * 3600);
  const r2 = computeInterfaceDelta({ rx: 0, tx: 0 }, { rx: 1000, tx: 1000 }, 0);
  assert.equal(r2.intervalSeconds, 1);
});

test('computeInterfaceDelta: con contadores REALES leidos del CCR2004 Fiberlux (verificacion de solo lectura, 2026-10-24) el bps calculado es plausible para un enlace de 500 Mbps', () => {
  // VLAN-236 (entrada del proveedor) en dos lecturas separadas 60s, con los
  // mismos ordenes de magnitud que devolvio /interface contra el router real
  // (uptime ~1 semana, enlace casi saturado) -- ver verificacion documentada
  // en ESTADO_DESARROLLO.md Fase 169.
  const prev = { rx: 48_081_234_746_417, tx: 6_949_507_588_200 };
  const curr = { rx: prev.rx + 3_000_000_000, tx: prev.tx + 70_000_000 }; // ~400 Mbps bajada, ~9 Mbps subida en 60s
  const r = computeInterfaceDelta(prev, curr, 60);
  const rxMbps = r.rxBps / 1_000_000;
  const txMbps = r.txBps / 1_000_000;
  assert.ok(rxMbps > 300 && rxMbps < 500, `rxMbps fuera de rango plausible: ${rxMbps}`);
  assert.ok(txMbps > 5 && txMbps < 20, `txMbps fuera de rango plausible: ${txMbps}`);
});

test('findInterfaceByName: coincidencia exacta, nunca parcial (nombres reales confirmados contra el CCR2004 Fiberlux)', () => {
  const ifaces = [{ name: 'sfp-sfpplus1' }, { name: 'sfp-sfpplus2' }, { name: 'VLAN-236' }, { name: 'VLAN-4000' }, { name: 'lo' }];
  assert.equal(findInterfaceByName(ifaces, 'VLAN-236')?.name, 'VLAN-236');
  assert.equal(findInterfaceByName(ifaces, 'VLAN-4000')?.name, 'VLAN-4000');
  assert.equal(findInterfaceByName(ifaces, 'vlan-236'), null); // case-sensitive: RouterOS no normaliza
  assert.equal(findInterfaceByName(ifaces, 'VLAN-23'), null);
  assert.equal(findInterfaceByName(ifaces, null), null);
  assert.equal(findInterfaceByName(ifaces, undefined), null);
});

function sampleAt(secondsAgo: number, rxBps: number, txBps: number, online = true, now = new Date()): SaturationSample {
  return { sampledAt: new Date(now.getTime() - secondsAgo * 1000), rxBps, txBps, online };
}

test('evaluateSaturation: descarga sostenida >=85% durante toda la ventana -> over', () => {
  const now = new Date();
  const capacity = 500_000_000; // 500 Mbps en bps
  const samples: SaturationSample[] = [0, 60, 120, 180, 240, 300].map((s) => sampleAt(s, 450_000_000, 10_000_000, true, now));
  const r = evaluateSaturation(samples, now, capacity, capacity);
  assert.equal(r.download, 'over');
  assert.equal(r.upload, 'under');
});

test('evaluateSaturation: un solo pico por debajo del umbral dentro de la ventana -> under (debe ser SOSTENIDO)', () => {
  const now = new Date();
  const capacity = 500_000_000;
  const samples: SaturationSample[] = [
    sampleAt(0, 460_000_000, 0, true, now),
    sampleAt(60, 460_000_000, 0, true, now),
    sampleAt(120, 100_000_000, 0, true, now), // un bajon rompe la racha sostenida
    sampleAt(180, 460_000_000, 0, true, now),
    sampleAt(240, 460_000_000, 0, true, now),
  ];
  const r = evaluateSaturation(samples, now, capacity, capacity);
  assert.equal(r.download, 'under');
});

test('evaluateSaturation: sin muestras en la ventana -> unknown (nunca "under" por defecto)', () => {
  const r = evaluateSaturation([], new Date(), 500_000_000, 500_000_000);
  assert.deepEqual(r, { download: 'unknown', upload: 'unknown' });
});

test('evaluateSaturation: mayoria offline en la ventana (perdida de monitoreo) -> unknown, no "under"', () => {
  const now = new Date();
  const capacity = 500_000_000;
  const samples: SaturationSample[] = [
    sampleAt(0, 490_000_000, 0, false, now),
    sampleAt(60, 490_000_000, 0, false, now),
    sampleAt(120, 490_000_000, 0, false, now),
    sampleAt(180, 490_000_000, 0, true, now),
  ];
  const r = evaluateSaturation(samples, now, capacity, capacity);
  assert.deepEqual(r, { download: 'unknown', upload: 'unknown' });
});

test('decideAlertTransition: "over" sin alerta activa dispara; "over" con alerta activa NO duplica', () => {
  assert.deepEqual(decideAlertTransition('over', false), { shouldFire: true, shouldResolve: false });
  assert.deepEqual(decideAlertTransition('over', true), { shouldFire: false, shouldResolve: false });
});

test('decideAlertTransition: "under" con alerta activa la resuelve; sin alerta activa no hace nada', () => {
  assert.deepEqual(decideAlertTransition('under', true), { shouldFire: false, shouldResolve: true });
  assert.deepEqual(decideAlertTransition('under', false), { shouldFire: false, shouldResolve: false });
});

test('decideAlertTransition: "unknown" nunca dispara ni resuelve (perdida de monitoreo != enlace caido o recuperado)', () => {
  assert.deepEqual(decideAlertTransition('unknown', true), { shouldFire: false, shouldResolve: false });
  assert.deepEqual(decideAlertTransition('unknown', false), { shouldFire: false, shouldResolve: false });
});
