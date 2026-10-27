import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  configureTr069ManagementWanCommands,
  removeTr069ManagementWanCommands,
  type Tr069ManagementWanParams,
} from '../../ssh/zteCommands';
import {
  extractManagementIpAssignments,
  extractOnuInterfaceBlock,
  extractPonOnuMngBlock,
} from '../../ssh/zteParsers';
import { planTr069ManagementWan, TR069_MANAGEMENT_WAN_DEFAULTS, type Tr069ManagementWanPlanInput } from '../tr069ManagementWan';

const BASE_PARAMS: Tr069ManagementWanParams = {
  ref: { shelf: 1, slot: 2, port: 2 },
  onuId: 24,
  managementVlan: 200,
  managementIp: '10.15.15.200',
  managementMask: '255.255.255.0',
  gateway: '10.15.15.1',
  primaryDns: '8.8.8.8',
  secondaryDns: '8.8.4.4',
  acsUrl: 'http://192.168.55.201:7547',
  tcontProfile: 'SMARTOLT-VOIPMNG-10M',
  trafficProfile: 'SMARTOLT-VOIPMNG-10M',
  tcontId: 2,
  gemportId: 2,
  vportId: 2,
  iphostId: 2,
  veipId: 1,
  veipPort: 1232,
  priority: 2,
};

// ---- configureTr069ManagementWanCommands (constructor puro de comandos) ----

test('sin nada previo: genera la secuencia completa, interfaz + pon-onu-mng, EXACTAMENTE como las 6 Huawei reales', () => {
  const cmds = configureTr069ManagementWanCommands(BASE_PARAMS);
  assert.deepEqual(cmds, [
    'enable',
    'configure terminal',
    'interface gpon-onu_1/2/2:24',
    'tcont 2 profile SMARTOLT-VOIPMNG-10M',
    'gemport 2 tcont 2',
    'gemport 2 traffic-limit downstream SMARTOLT-VOIPMNG-10M',
    'service-port 2 vport 2 user-vlan 200 vlan 200',
    'exit',
    'pon-onu-mng gpon-onu_1/2/2:24',
    'service mgmt gemport 2 iphost 2 vlan 200',
    'switchport-bind switch_0/1 veip 1',
    'ip-host 2 ip 10.15.15.200 mask 255.255.255.0 gateway 10.15.15.1',
    'ip-host 2 primary-dns 8.8.8.8 second-dns 8.8.4.4',
    'veip 1 port udp 1232 host 2',
    'tr069-mgmt 1 state unlock',
    'tr069-mgmt 1 acs http://192.168.55.201:7547',
    'tr069-mgmt 1 tag pri 2 vlan 200',
    'exit',
  ]);
});

test('nunca toca tcont 1 / gemport 1 / service-port 1 del cliente (vlan 120) — ninguna linea los menciona', () => {
  const cmds = configureTr069ManagementWanCommands(BASE_PARAMS);
  const joined = cmds.join('\n');
  assert.doesNotMatch(joined, /\btcont 1\b/);
  assert.doesNotMatch(joined, /\bgemport 1\b/);
  assert.doesNotMatch(joined, /\bservice-port 1\b/);
  assert.doesNotMatch(joined, /vlan 120/);
});

test('con tr069-mgmt state/acs YA presentes (caso real de HWTC1D3691B7): los omite, agrega solo lo demas', () => {
  const cmds = configureTr069ManagementWanCommands(BASE_PARAMS, { tr069State: true, tr069Acs: true });
  assert.ok(!cmds.includes('tr069-mgmt 1 state unlock'));
  assert.ok(!cmds.includes('tr069-mgmt 1 acs http://192.168.55.201:7547'));
  assert.ok(cmds.includes('tr069-mgmt 1 tag pri 2 vlan 200'));
  assert.ok(cmds.includes('ip-host 2 ip 10.15.15.200 mask 255.255.255.0 gateway 10.15.15.1'));
});

test('todo ya presente: no agrega ningun bloque (ni interface ni pon-onu-mng), solo enable/configure terminal', () => {
  const cmds = configureTr069ManagementWanCommands(BASE_PARAMS, {
    interfaceBlock: true, serviceMgmt: true, switchportBind: true, ipHostAddress: true,
    ipHostDns: true, veipPortBinding: true, tr069State: true, tr069Acs: true, tr069Tag: true,
  });
  assert.deepEqual(cmds, ['enable', 'configure terminal']);
});

test('IP de gestion invalida -> lanza, nunca manda un comando con basura al CLI real', () => {
  assert.throws(() => configureTr069ManagementWanCommands({ ...BASE_PARAMS, managementIp: '10.15.15.999' }));
  assert.throws(() => configureTr069ManagementWanCommands({ ...BASE_PARAMS, managementIp: 'no-es-una-ip' }));
});

test('vlan fuera de rango -> lanza', () => {
  assert.throws(() => configureTr069ManagementWanCommands({ ...BASE_PARAMS, managementVlan: 5000 }));
});

// ---- removeTr069ManagementWanCommands (reversion, solo lo nuevo) ----

test('reversion simetrica: deshace exactamente lo que se aplico cuando TODO era nuevo', () => {
  const cmds = removeTr069ManagementWanCommands(BASE_PARAMS, {
    interfaceBlock: true, serviceMgmt: true, switchportBind: true, ipHostAddress: true,
    ipHostDns: true, veipPortBinding: true, tr069State: true, tr069Acs: true, tr069Tag: true,
  });
  assert.deepEqual(cmds, [
    'enable',
    'configure terminal',
    'pon-onu-mng gpon-onu_1/2/2:24',
    'no tr069-mgmt 1 tag pri 2 vlan 200',
    'no tr069-mgmt 1 acs http://192.168.55.201:7547',
    'tr069-mgmt 1 state lock',
    'no veip 1 port udp 1232 host 2',
    'no ip-host 2 primary-dns 8.8.8.8 second-dns 8.8.4.4',
    'no ip-host 2 ip 10.15.15.200 mask 255.255.255.0 gateway 10.15.15.1',
    'no switchport-bind switch_0/1 veip 1',
    'no service mgmt gemport 2 iphost 2 vlan 200',
    'exit',
    'interface gpon-onu_1/2/2:24',
    'no service-port 2 vport 2 user-vlan 200 vlan 200',
    'no gemport 2 traffic-limit downstream SMARTOLT-VOIPMNG-10M',
    'no gemport 2 tcont 2',
    'no tcont 2 profile SMARTOLT-VOIPMNG-10M',
    'exit',
  ]);
});

test('reversion parcial: si tr069-mgmt state/acs YA existian antes (no los aplico esta operacion), el rollback NO los toca', () => {
  const cmds = removeTr069ManagementWanCommands(BASE_PARAMS, {
    interfaceBlock: true, serviceMgmt: true, switchportBind: true, ipHostAddress: true,
    ipHostDns: true, veipPortBinding: true, tr069State: false, tr069Acs: false, tr069Tag: true,
  });
  assert.ok(!cmds.some((c) => c.includes('tr069-mgmt 1 acs')));
  assert.ok(!cmds.some((c) => c === 'tr069-mgmt 1 state lock'));
  assert.ok(cmds.includes('no tr069-mgmt 1 tag pri 2 vlan 200'));
});

// ---- parsers (extractManagementIpAssignments / extractPonOnuMngBlock / extractOnuInterfaceBlock) ----

const SAMPLE_DUMP = `
interface gpon-olt_1/2/3
  onu 37 type GPT-2741GNAC sn HWTC365CB4B7
!
interface gpon-onu_1/2/3:37
  tcont 1 profile SMARTOLT-100M-UP
  tcont 2 profile SMARTOLT-VOIPMNG-10M
  gemport 1 tcont 1
  gemport 2 tcont 2
  gemport 2 traffic-limit downstream SMARTOLT-VOIPMNG-10M
  service-port 1 vport 1 user-vlan 120 vlan 120
  service-port 2 vport 2 user-vlan 200 vlan 200
!
pon-onu-mng gpon-onu_1/2/3:37
  service internet gemport 1 vlan 120
  service mgmt gemport 2 iphost 2 vlan 200
  switchport-bind switch_0/1 veip 1
  ip-host 2 ip 10.15.15.17 mask 255.255.255.0 gateway 10.15.15.1
  ip-host 2 primary-dns 8.8.8.8 second-dns 8.8.4.4
  veip 1 port udp 1232 host 2
  tr069-mgmt 1 state unlock
  tr069-mgmt 1 acs http://10.69.69.1:14501
  tr069-mgmt 1 tag pri 2 vlan 200
!
interface gpon-onu_1/2/2:24
  description "PRUEBA"
  tcont 1 profile SMARTOLT-100M-UP
  gemport 1 tcont 1
  service-port 1 vport 1 user-vlan 120 vlan 120
!
pon-onu-mng gpon-onu_1/2/2:24
  service 1 gemport 1 vlan 120
  tr069-mgmt 1 state unlock
  tr069-mgmt 1 acs http://192.168.55.201:7547
!
`;

test('extractManagementIpAssignments: encuentra todas las IPs de gestion ya usadas en el dump completo', () => {
  assert.deepEqual(extractManagementIpAssignments(SAMPLE_DUMP), ['10.15.15.17']);
});

test('extractPonOnuMngBlock: devuelve el bloque exacto de la posicion pedida, ninguna otra', () => {
  const block = extractPonOnuMngBlock(SAMPLE_DUMP, 1, 2, 2, 24);
  assert.ok(block?.includes('tr069-mgmt 1 acs http://192.168.55.201:7547'));
  assert.ok(!block?.includes('10.15.15.17')); // no se mezcla con el bloque de otra ONU
});

test('extractPonOnuMngBlock: posicion inexistente -> null, nunca inventa un bloque vacio', () => {
  assert.equal(extractPonOnuMngBlock(SAMPLE_DUMP, 1, 9, 9, 99), null);
});

test('extractOnuInterfaceBlock: devuelve el bloque "interface gpon-onu_..." correcto', () => {
  const block = extractOnuInterfaceBlock(SAMPLE_DUMP, 1, 2, 2, 24);
  assert.ok(block?.includes('description "PRUEBA"'));
});

// ---- planTr069ManagementWan (el planificador completo) ----

function baseInput(overrides: Partial<Tr069ManagementWanPlanInput> = {}): Tr069ManagementWanPlanInput {
  return {
    expectedSerial: 'HWTC1D3691B7',
    liveSerial: 'HWTC1D3691B7',
    candidateManagementIp: '10.15.15.200',
    takenManagementIps: ['10.15.15.161', '10.15.15.17', '10.15.15.30'],
    interfaceBlock: extractOnuInterfaceBlock(SAMPLE_DUMP, 1, 2, 2, 24),
    mngBlock: extractPonOnuMngBlock(SAMPLE_DUMP, 1, 2, 2, 24),
    acsUrl: 'http://192.168.55.201:7547',
    managementVlan: 200,
    gateway: '10.15.15.1',
    params: { ref: { shelf: 1, slot: 2, port: 2 }, onuId: 24 },
    ...overrides,
  };
}

test('caso real HWTC1D3691B7: plan OK, omite tr069-mgmt state/acs (ya estaban), agrega el resto', () => {
  const result = planTr069ManagementWan(baseInput());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.presence.tr069State, true);
  assert.equal(result.presence.tr069Acs, true);
  assert.equal(result.presence.ipHostAddress, false);
  assert.ok(result.commands.includes('ip-host 2 ip 10.15.15.200 mask 255.255.255.0 gateway 10.15.15.1'));
  assert.ok(!result.commands.includes('tr069-mgmt 1 state unlock'));
  assert.equal(result.params.tcontProfile, TR069_MANAGEMENT_WAN_DEFAULTS.tcontProfile);
});

test('serial en vivo distinto al esperado -> POSITION_MISMATCH, nunca genera comandos', () => {
  const result = planTr069ManagementWan(baseInput({ liveSerial: 'ZTEGDC5C5DF2' }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.rejection, 'POSITION_MISMATCH');
});

test('sin lectura en vivo (liveSerial null) -> POSITION_MISMATCH, nunca asume', () => {
  const result = planTr069ManagementWan(baseInput({ liveSerial: null }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.rejection, 'POSITION_MISMATCH');
});

test('IP candidata ya usada por OTRA ONT (no la de esta posicion) -> IP_ALREADY_USED', () => {
  const result = planTr069ManagementWan(baseInput({ candidateManagementIp: '10.15.15.17' }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.rejection, 'IP_ALREADY_USED');
});

test('re-pedir la IP que esta MISMA ONU ya tiene asignada no es un duplicado (no dispara IP_ALREADY_USED)', () => {
  const result = planTr069ManagementWan(baseInput({
    expectedSerial: 'HWTC365CB4B7',
    liveSerial: 'HWTC365CB4B7',
    mngBlock: extractPonOnuMngBlock(SAMPLE_DUMP, 1, 2, 3, 37),
    interfaceBlock: extractOnuInterfaceBlock(SAMPLE_DUMP, 1, 2, 3, 37),
    candidateManagementIp: '10.15.15.17', // su propia IP ya asignada
    acsUrl: 'http://10.69.69.1:14501',
    params: { ref: { shelf: 1, slot: 2, port: 3 }, onuId: 37 },
  }));
  // Ya tiene TODO configurado (incluida esa misma IP) -> ALREADY_FULLY_CONFIGURED, no IP_ALREADY_USED.
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.rejection, 'ALREADY_FULLY_CONFIGURED');
});

test('ACS ya configurado pero DISTINTO al pedido -> ACS_CONFLICT, nunca lo sobrescribe en silencio', () => {
  const result = planTr069ManagementWan(baseInput({ acsUrl: 'http://otro-acs:7547' }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.rejection, 'ACS_CONFLICT');
});

test('ONU que ya tiene TODO configurado -> ALREADY_FULLY_CONFIGURED', () => {
  const fullyConfigured = extractPonOnuMngBlock(SAMPLE_DUMP, 1, 2, 3, 37)!;
  const result = planTr069ManagementWan(baseInput({
    expectedSerial: 'HWTC365CB4B7',
    liveSerial: 'HWTC365CB4B7',
    mngBlock: fullyConfigured,
    interfaceBlock: extractOnuInterfaceBlock(SAMPLE_DUMP, 1, 2, 3, 37),
    candidateManagementIp: '10.15.15.17', // la IP que esta ONU YA tiene asignada
    acsUrl: 'http://10.69.69.1:14501', // el mismo ACS que ya tiene, para no disparar ACS_CONFLICT
    params: { ref: { shelf: 1, slot: 2, port: 3 }, onuId: 37 },
  }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.rejection, 'ALREADY_FULLY_CONFIGURED');
});

test('plan ok: el rollback que trae es exactamente la reversion de lo que trae "commands" (simetria)', () => {
  const result = planTr069ManagementWan(baseInput());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // lo que se omitio en "commands" (porque ya existia) tampoco debe aparecer en el rollback
  assert.ok(!result.rollbackCommands.some((c) => c.includes('tr069-mgmt 1 acs')));
  assert.ok(result.rollbackCommands.includes('no ip-host 2 ip 10.15.15.200 mask 255.255.255.0 gateway 10.15.15.1'));
});
