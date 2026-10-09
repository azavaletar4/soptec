import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCliError, redactSensitive } from '../client';

// Pruebas puras (sin sockets) de los dos helpers centrales de la Fase 1:
// deteccion de errores CLI y redaccion de credenciales en logs/mensajes.

test('detecta errores CLI confirmados contra el equipo real (ver zteCommands.ts)', () => {
  assert.equal(
    detectCliError('ZXAN(config)#onu 5 type F660 sn X\r\n%Error 20204: Ambiguous command found\r\nZXAN(config)#'),
    '%Error 20204: Ambiguous command found',
  );
  assert.equal(detectCliError('Error 20202: Invalid input detected\r\nZXAN#'), 'Error 20202: Invalid input detected');
  assert.equal(detectCliError('Incomplete command.\r\nZXAN(config)#'), 'Incomplete command.');
});

test('detecta las variantes estilo Cisco como fallback', () => {
  assert.equal(detectCliError('% Unrecognized command\r\nZXAN#'), '% Unrecognized command');
  assert.equal(detectCliError('% Ambiguous command: "sh"\r\nZXAN#'), '% Ambiguous command: "sh"');
});

test('no hay error cuando la secuencia termino sin problemas', () => {
  assert.equal(detectCliError('ZXAN(config)#exit\r\nZXAN#'), null);
});

test('no genera falso positivo con texto libre que contiene la palabra "error" en medio de la linea', () => {
  // El eco del comando enviado queda SIEMPRE despues del prompt, en la misma
  // linea (nunca al inicio de una linea nueva) — una descripcion de cliente
  // como esta no debe disparar nada.
  const output = 'ZXAN(config)#description "Error de instalacion reportado por el cliente"\r\nZXAN(config)#';
  assert.equal(detectCliError(output), null);
});

test('no confunde el estado normal de una ONU (columna admin-state "disable") con un error', () => {
  const output = '1/2/4:23    disable      disable     OffLine      1(GPON)\r\nZXAN#';
  assert.equal(detectCliError(output), null);
});

// Bug real encontrado por revision externa (ChatGPT): el regex original
// ("^%?\s*error\b") clasificaba como rechazo CUALQUIER linea de
// estadisticas/configuracion que empezara con la palabra "Error" sin serlo
// (ej. un contador en una salida de "show interface"/"show pon power"). Un
// rechazo real de este equipo SIEMPRE trae un codigo numerico pegado a
// "Error" (ej. "Error 20202:") — una palabra despues no cuenta.
test('no clasifica como error una linea de estadisticas que empieza con "Error" pero no es un codigo de rechazo', () => {
  assert.equal(detectCliError('Error packets: 0\r\nZXAN#'), null);
  assert.equal(detectCliError('Error Frames: 12\r\nZXAN#'), null);
  assert.equal(detectCliError('Error Disable Count        : 0\r\nZXAN#'), null);
});

test('no clasifica como error una linea de configuracion/contadores que menciona "error" sin ser un codigo de rechazo', () => {
  assert.equal(detectCliError('errored seconds: 0\r\nZXAN#'), null);
  assert.equal(detectCliError('CRC Errors                 : 0\r\nZXAN#'), null);
});

test('una salida larga con lineas de estadisticas "Error ..." y el prompt real sigue sin disparar nada', () => {
  const output = [
    'Rx power                  : -18.432(dbm)',
    'Error packets             : 0',
    'Error Frames              : 0',
    'ZXAN#',
  ].join('\r\n');
  assert.equal(detectCliError(output), null);
});

test('redactSensitive oculta password y username sin tocar el resto del comando', () => {
  const cmd = 'wan-ip 1 mode pppoe username cliente1 password MiClaveSuperSecreta123 vlan-profile 120 host 1';
  const redacted = redactSensitive(cmd);
  assert.ok(!redacted.includes('MiClaveSuperSecreta123'));
  assert.ok(!redacted.includes('cliente1'));
  assert.equal(redacted, 'wan-ip 1 mode pppoe username [REDACTED] password [REDACTED] vlan-profile 120 host 1');
});
