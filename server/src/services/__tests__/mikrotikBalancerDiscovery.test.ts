import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyConnectionStatus,
  diffDiscoveredConnections,
  isBalancerDataStale,
  resolveConnectionTopology,
  type MacvlanRaw,
  type PppoeClientRaw,
} from '../../mikrotik/balancerDiscovery';

// Fase 174 — datos reales (anonimizados de nombre, mismos valores) leidos
// por solo lectura contra el balanceador real antes de implementar nada.
const REAL_MACVLANS: MacvlanRaw[] = [
  { name: 'MAC-PPPoE_031', interface: 'sfp-sfpplus2', disabled: 'false', running: 'true' },
  { name: 'MAC-PPPoE_037', interface: 'sfp-sfpplus3', disabled: 'false', running: 'true' },
  { name: 'MAC-PPPoE_043', interface: 'sfp-sfpplus6', disabled: 'false', running: 'true' },
  { name: 'MAC-PPPoE_049', interface: 'sfp-sfpplus7', disabled: 'false', running: 'true' },
  { name: 'MAC-PPPoE_055', interface: 'sfp-sfpplus1', disabled: 'true', running: 'false' },
];
const REAL_PPPOE_CLIENTS: PppoeClientRaw[] = [
  { name: 'PPPoE-WAN031', interface: 'MAC-PPPoE_031', user: 'speedy', disabled: 'false', running: 'true' },
  { name: 'PPPoE-WAN037', interface: 'MAC-PPPoE_037', user: 'speedy', disabled: 'false', running: 'true' },
  { name: 'PPPoE-WAN043', interface: 'MAC-PPPoE_043', user: 'speedy', disabled: 'false', running: 'true' },
  { name: 'PPPoE-WAN049', interface: 'MAC-PPPoE_049', user: 'speedy', disabled: 'false', running: 'true' },
  { name: 'PPPoE-WAN055', interface: 'MAC-PPPoE_055', user: 'speedy', disabled: 'true', running: 'false' },
];

test('resolveConnectionTopology: arma la cadena real fisico<-macvlan<-pppoe siguiendo el campo "interface", nunca el nombre', () => {
  const result = resolveConnectionTopology(REAL_MACVLANS, REAL_PPPOE_CLIENTS);
  assert.equal(result.length, 5);
  assert.deepEqual(result[0], {
    pppoeInterfaceName: 'PPPoE-WAN031',
    macvlanInterfaceName: 'MAC-PPPoE_031',
    physicalInterfaceName: 'sfp-sfpplus2',
    pppoeUser: 'speedy',
    disabled: false,
    running: true,
  });
  // sfp-sfpplus6/7 -- distinto puerto fisico, resuelto por el campo real, no por "parecer" el mismo rango de numeros.
  assert.equal(result.find((r) => r.pppoeInterfaceName === 'PPPoE-WAN043')?.physicalInterfaceName, 'sfp-sfpplus6');
  assert.equal(result.find((r) => r.pppoeInterfaceName === 'PPPoE-WAN049')?.physicalInterfaceName, 'sfp-sfpplus7');
});

test('resolveConnectionTopology: puerto deshabilitado/preparado (sfp-sfpplus1) se resuelve igual, sin tratarlo distinto', () => {
  const result = resolveConnectionTopology(REAL_MACVLANS, REAL_PPPOE_CLIENTS);
  const wan055 = result.find((r) => r.pppoeInterfaceName === 'PPPoE-WAN055');
  assert.equal(wan055?.physicalInterfaceName, 'sfp-sfpplus1');
  assert.equal(wan055?.disabled, true);
  assert.equal(wan055?.running, false);
});

test('resolveConnectionTopology: una sesion PPPoE cuya macvlan ya no existe queda en null, nunca se inventa', () => {
  const result = resolveConnectionTopology([], [{ name: 'PPPoE-WAN999', interface: 'MAC-PPPoE_999', user: 'speedy', disabled: 'false', running: 'true' }]);
  assert.equal(result[0].macvlanInterfaceName, 'MAC-PPPoE_999'); // el nombre que el PPPoE dice usar, tal cual
  assert.equal(result[0].physicalInterfaceName, null); // pero no se pudo verificar el puerto fisico real -> null, no adivinado
});

test('classifyConnectionStatus: deshabilitado nunca es averia; solo habilitado+caido es un problema real', () => {
  assert.equal(classifyConnectionStatus(true, false), 'disabled');
  assert.equal(classifyConnectionStatus(true, true), 'disabled'); // deshabilitado manda, aunque running viniera true de un estado viejo
  assert.equal(classifyConnectionStatus(false, true), 'up');
  assert.equal(classifyConnectionStatus(false, false), 'down');
});

test('diffDiscoveredConnections: detecta altas y retiros sin asumir ninguna cantidad fija', () => {
  const previo = ['PPPoE-WAN031', 'PPPoE-WAN037', 'PPPoE-WAN043'];
  const actual = ['PPPoE-WAN031', 'PPPoE-WAN043', 'PPPoE-WAN999'];
  const diff = diffDiscoveredConnections(previo, actual);
  assert.deepEqual(diff.newNames, ['PPPoE-WAN999']);
  assert.deepEqual(diff.stillPresentNames, ['PPPoE-WAN031', 'PPPoE-WAN043']);
  assert.deepEqual(diff.removedNames, ['PPPoE-WAN037']);
});

test('diffDiscoveredConnections: primera corrida (BD vacia) -- todo es alta nueva, nada removido', () => {
  const diff = diffDiscoveredConnections([], ['PPPoE-WAN031', 'PPPoE-WAN037']);
  assert.deepEqual(diff.newNames, ['PPPoE-WAN031', 'PPPoE-WAN037']);
  assert.deepEqual(diff.removedNames, []);
});

test('diffDiscoveredConnections: el router no responde este ciclo (lista vacia) -- NUNCA debe interpretarse como "se retiraron todas"', () => {
  // Esta funcion es pura y no decide esto por si sola -- queda documentado
  // aqui que el llamador (servicio con I/O) NUNCA debe invocarla con una
  // lista vacia proveniente de un fallo de red, solo con una lista vacia
  // real confirmada por una lectura exitosa del router.
  const diff = diffDiscoveredConnections(['PPPoE-WAN031'], []);
  assert.deepEqual(diff.removedNames, ['PPPoE-WAN031']);
});

test('isBalancerDataStale: nunca descubrio nada todavia (null) -- obsoleto por definicion', () => {
  assert.equal(isBalancerDataStale(null, Date.now()), true);
});

test('isBalancerDataStale: dentro del umbral -- datos confiables', () => {
  const now = Date.parse('2026-10-24T20:10:00.000Z');
  const lastSeen = '2026-10-24T20:08:00.000Z'; // hace 120s, bajo el umbral de 180s
  assert.equal(isBalancerDataStale(lastSeen, now), false);
});

test('isBalancerDataStale: un solo ciclo perdido (60s) todavia no es obsoleto', () => {
  const now = Date.parse('2026-10-24T20:10:00.000Z');
  const lastSeen = '2026-10-24T20:09:00.000Z'; // hace 60s
  assert.equal(isBalancerDataStale(lastSeen, now), false);
});

test('isBalancerDataStale: mas de 2 ciclos perdidos (>180s) -- obsoleto', () => {
  const now = Date.parse('2026-10-24T20:10:00.000Z');
  const lastSeen = '2026-10-24T20:06:00.000Z'; // hace 240s
  assert.equal(isBalancerDataStale(lastSeen, now), true);
});
