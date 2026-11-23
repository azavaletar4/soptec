import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSafeFile, toSafeBlob } from '../safeBlob';

test('toSafeFile: conserva bytes, nombre, tipo y lastModified', async () => {
  const original = new File(['hola'], 'foto.jpg', { type: 'image/jpeg', lastModified: 123 });
  const safe = await toSafeFile(original);
  assert.equal(await safe.text(), 'hola');
  assert.equal(safe.name, 'foto.jpg');
  assert.equal(safe.type, 'image/jpeg');
  assert.equal(safe.lastModified, 123);
  assert.ok(safe instanceof File);
});

test('toSafeFile: devuelve una copia INDEPENDIENTE (no la misma instancia)', async () => {
  const original = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
  const safe = await toSafeFile(original);
  assert.notEqual(safe, original);
});

test('toSafeBlob: conserva bytes y tipo', async () => {
  const original = new Blob(['firma-digital'], { type: 'image/png' });
  const safe = await toSafeBlob(original);
  assert.equal(await safe.text(), 'firma-digital');
  assert.equal(safe.type, 'image/png');
});

test('toSafeFile: un origen ilegible (simula un content:// URI ya liberado por Android) rechaza, no devuelve un archivo vacio', async () => {
  const doomed = new File(['x'], 'p.jpg', { type: 'image/jpeg' });
  Object.defineProperty(doomed, 'arrayBuffer', {
    value: () => Promise.reject(new DOMException('ya no disponible', 'NotReadableError')),
  });
  await assert.rejects(() => toSafeFile(doomed), /NotReadableError|ya no disponible/);
});

test('toSafeFile: foto grande (3MB) sobrevive byte a byte', async () => {
  const bytes = new Uint8Array(3 * 1024 * 1024);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
  const original = new File([bytes], 'grande.jpg', { type: 'image/jpeg' });
  const safe = await toSafeFile(original);
  const roundTrip = new Uint8Array(await safe.arrayBuffer());
  assert.equal(roundTrip.length, bytes.length);
  assert.deepEqual(roundTrip, bytes);
});
