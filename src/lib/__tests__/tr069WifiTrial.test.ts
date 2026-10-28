import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plainWifiTrialMessage } from '../tr069WifiTrial';

test('traduce un mensaje técnico conocido a lenguaje sencillo', () => {
  assert.equal(
    plainWifiTrialMessage('La identidad, instancia o SSID actual cambió; vuelve a consultar'),
    'El nombre WiFi cambió desde la última consulta. Cierra y vuelve a abrir esta ventana para intentarlo de nuevo.',
  );
});

test('traduce el mensaje de contraseña inválida sin nunca mostrar la contraseña enviada', () => {
  assert.equal(
    plainWifiTrialMessage('Contraseña inválida: 8 a 63 caracteres imprimibles en inglés, sin tildes ni emoji'),
    'La contraseña debe tener entre 8 y 63 caracteres: solo letras, números y símbolos del teclado en inglés (sin tildes, eñes ni emoji).',
  );
});

test('traduce el bloqueo temporal de cambio de contraseña (incidente real 28/10/2026)', () => {
  assert.equal(
    plainWifiTrialMessage('Cambio de contraseña bloqueado temporalmente: este equipo no confirma de forma confiable que la contraseña se aplicó. Por ahora solo se puede cambiar el nombre.'),
    'Cambio de contraseña no disponible por ahora: este equipo no confirma de forma confiable que la contraseña nueva se aplique. Por ahora solo se puede cambiar el nombre.',
  );
});

test('un mensaje desconocido se muestra sin cambios (nunca se oculta información)', () => {
  assert.equal(plainWifiTrialMessage('Mensaje no mapeado aún'), 'Mensaje no mapeado aún');
});

test('null/undefined se devuelven tal cual', () => {
  assert.equal(plainWifiTrialMessage(null), null);
  assert.equal(plainWifiTrialMessage(undefined), null);
});
