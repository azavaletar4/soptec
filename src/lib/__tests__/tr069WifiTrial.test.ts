import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plainWifiTrialMessage } from '../tr069WifiTrial';

test('traduce un mensaje técnico conocido a lenguaje sencillo', () => {
  assert.equal(
    plainWifiTrialMessage('La identidad, instancia o SSID actual cambió; vuelve a consultar'),
    'El nombre WiFi cambió desde la última consulta. Cierra y vuelve a abrir esta ventana para intentarlo de nuevo.',
  );
});

test('un mensaje desconocido se muestra sin cambios (nunca se oculta información)', () => {
  assert.equal(plainWifiTrialMessage('Mensaje no mapeado aún'), 'Mensaje no mapeado aún');
});

test('null/undefined se devuelven tal cual', () => {
  assert.equal(plainWifiTrialMessage(null), null);
  assert.equal(plainWifiTrialMessage(undefined), null);
});
