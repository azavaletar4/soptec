import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MIKROTIK_DEVICE_ROLE,
  MIKROTIK_DEVICE_ROLES,
  isPppoeAdminRole,
  isValidMikrotikDeviceRole,
} from '../../mikrotik/deviceRole';

test('MikroTik device role: solo pppoe_admin cuenta como administrador PPPoE', () => {
  assert.equal(isPppoeAdminRole('pppoe_admin'), true);
  assert.equal(isPppoeAdminRole('borde_dedicado'), false);
  assert.equal(isPppoeAdminRole('borde_balanceador'), false);
  assert.equal(isPppoeAdminRole(null), false);
  assert.equal(isPppoeAdminRole(undefined), false);
  assert.equal(isPppoeAdminRole('otro'), false);
});

test('MikroTik device role: el default preserva el comportamiento de un router ya registrado', () => {
  assert.equal(DEFAULT_MIKROTIK_DEVICE_ROLE, 'pppoe_admin');
  assert.equal(isPppoeAdminRole(DEFAULT_MIKROTIK_DEVICE_ROLE), true);
});

test('MikroTik device role: valida solo los 3 roles operativos (admin/borde dedicado/borde balanceador)', () => {
  for (const role of MIKROTIK_DEVICE_ROLES) assert.equal(isValidMikrotikDeviceRole(role), true);
  assert.equal(isValidMikrotikDeviceRole('admin'), false);
  assert.equal(isValidMikrotikDeviceRole(''), false);
  assert.equal(isValidMikrotikDeviceRole(123), false);
  assert.equal(isValidMikrotikDeviceRole(null), false);
});
