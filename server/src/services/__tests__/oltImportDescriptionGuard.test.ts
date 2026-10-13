import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positionKey, classifyImportCandidates, type LinkedPosition } from '../oltImportDescriptionGuard';

const linked = (over: Partial<LinkedPosition> = {}): LinkedPosition => ({
  frame: 1, slot: 2, port: 4, ontId: 26, serial: 'HWTCABD21CB4', clientId: 'client-violeta', ...over,
});

test('positionKey: formato estable frame/slot/port:ontId', () => {
  assert.equal(positionKey(1, 2, 4, 26), '1/2/4:26');
});

test('ONT sin vincular -> fullRefresh (sigue tomando el nombre de la OLT, Situacion A)', () => {
  const candidates = [{ frame: 1, slot: 2, port: 4, ontId: 26, serial: 'HWTCABD21CB4' }];
  const r = classifyImportCandidates(candidates, []);
  assert.deepEqual(r.fullRefresh, candidates);
  assert.deepEqual(r.keepDescription, []);
  assert.deepEqual(r.conflicts, []);
});

test('ONT vinculada con el MISMO serial -> keepDescription (misma identidad, no se pisa el nombre)', () => {
  const candidates = [{ frame: 1, slot: 2, port: 4, ontId: 26, serial: 'HWTCABD21CB4' }];
  const r = classifyImportCandidates(candidates, [linked()]);
  assert.deepEqual(r.keepDescription, candidates);
  assert.deepEqual(r.fullRefresh, []);
  assert.deepEqual(r.conflicts, []);
});

test('comparacion de serial case-insensitive (mismo criterio que upsertOnt)', () => {
  const candidates = [{ frame: 1, slot: 2, port: 4, ontId: 26, serial: 'hwtcabd21cb4' }];
  const r = classifyImportCandidates(candidates, [linked({ serial: 'HWTCABD21CB4' })]);
  assert.deepEqual(r.keepDescription, candidates);
  assert.deepEqual(r.conflicts, []);
});

// ---- Riesgo reportado por el usuario: ONT REEMPLAZADA en una posicion ya vinculada ----

test('REEMPLAZO: misma posicion, serial distinto -> conflicto, NO se toca nada (ni description ni tecnico)', () => {
  const candidates = [{ frame: 1, slot: 2, port: 4, ontId: 26, serial: 'ZTENUEVOSERIAL01' }];
  const r = classifyImportCandidates(candidates, [linked({ serial: 'HWTCABD21CB4', clientId: 'client-violeta' })]);
  assert.deepEqual(r.fullRefresh, []);
  assert.deepEqual(r.keepDescription, []);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].position, '1/2/4:26');
  assert.equal(r.conflicts[0].previousSerial, 'HWTCABD21CB4');
  assert.equal(r.conflicts[0].previousClientId, 'client-violeta');
  assert.equal(r.conflicts[0].scannedSerial, 'ZTENUEVOSERIAL01');
  assert.match(r.conflicts[0].reason, /reemplazada o trasladada/);
});

test('TRASLADO: la ONT vinculada desaparece de su posicion vieja (no esta en el escaneo) y aparece en una NUEVA posicion sin vincular todavia', () => {
  // La posicion vieja simplemente no aparece entre los candidatos (la OLT ya no la reporta ahi) —
  // esa fila vieja no se toca por este import en absoluto (el loop del caller nunca la visita).
  // La posicion nueva es Situacion A pura: sin vinculo, se refresca normal.
  const candidates = [{ frame: 1, slot: 2, port: 9, ontId: 4, serial: 'HWTCABD21CB4' }]; // nueva posicion, mismo serial que antes
  const r = classifyImportCandidates(candidates, [linked({ frame: 1, slot: 2, port: 4, ontId: 26 })]); // vinculo viejo sigue en OTRA posicion
  assert.deepEqual(r.fullRefresh, candidates); // la posicion nueva no esta vinculada -> refresco normal
  assert.deepEqual(r.conflicts, []); // no hay conflicto: son posiciones distintas, no compiten
});

test('fila heredada sin vinculo en la MISMA posicion que una ONT que SI cambio de serial: cada posicion se evalua independiente', () => {
  // olt_onts.client_id es el unico criterio de "vinculada" — una fila sin client_id nunca genera conflicto,
  // pase lo que pase con su serial.
  const candidates = [{ frame: 1, slot: 3, port: 1, ontId: 7, serial: 'CUALQUIERA' }];
  const r = classifyImportCandidates(candidates, []); // nada vinculado en esa posicion
  assert.deepEqual(r.fullRefresh, candidates);
  assert.deepEqual(r.conflicts, []);
});

// ---- Reimportacion idempotente ----

test('REIMPORTACION: correr 2 veces seguidas con los mismos datos da exactamente el mismo resultado (sin vinculo)', () => {
  const candidates = [{ frame: 1, slot: 2, port: 9, ontId: 4, serial: 'ABC123' }];
  const first = classifyImportCandidates(candidates, []);
  const second = classifyImportCandidates(candidates, []);
  assert.deepEqual(first, second);
});

test('REIMPORTACION: correr 2 veces seguidas con los mismos datos da exactamente el mismo resultado (vinculada, mismo serial)', () => {
  const candidates = [{ frame: 1, slot: 2, port: 4, ontId: 26, serial: 'HWTCABD21CB4' }];
  const state = [linked()];
  const first = classifyImportCandidates(candidates, state);
  const second = classifyImportCandidates(candidates, state);
  assert.deepEqual(first, second);
  assert.deepEqual(first.keepDescription, candidates);
});

test('REIMPORTACION: un conflicto ya reportado sigue reportandose igual en la siguiente corrida mientras nadie lo resuelva (nunca se auto-resuelve)', () => {
  const candidates = [{ frame: 1, slot: 2, port: 4, ontId: 26, serial: 'ZTENUEVOSERIAL01' }];
  const state = [linked({ serial: 'HWTCABD21CB4' })]; // nadie corrigio la fila vieja entre corridas
  const first = classifyImportCandidates(candidates, state);
  const second = classifyImportCandidates(candidates, state);
  assert.equal(first.conflicts.length, 1);
  assert.deepEqual(first.conflicts, second.conflicts);
});

test('caso real mixto: Violeta/Clara/Mayco vinculadas (mismo serial) + 1 sin vincular + 1 reemplazo simulado', () => {
  const candidates = [
    { frame: 1, slot: 2, port: 4, ontId: 26, serial: 'HWTCABD21CB4' }, // Violeta, igual
    { frame: 1, slot: 2, port: 13, ontId: 33, serial: 'ASKY008E388B' }, // Clara, igual
    { frame: 1, slot: 2, port: 4, ontId: 19, serial: 'ZTEGDC5C139E' }, // Mayco, igual
    { frame: 1, slot: 2, port: 9, ontId: 4, serial: 'HWTCABD21CB4OLD' }, // sin vincular, Situacion A
    { frame: 1, slot: 3, port: 1, ontId: 7, serial: 'OTRODISTINTO' }, // reemplazo simulado
  ];
  const state: LinkedPosition[] = [
    linked({ frame: 1, slot: 2, port: 4, ontId: 26, serial: 'HWTCABD21CB4', clientId: 'violeta' }),
    linked({ frame: 1, slot: 2, port: 13, ontId: 33, serial: 'ASKY008E388B', clientId: 'clara' }),
    linked({ frame: 1, slot: 2, port: 4, ontId: 19, serial: 'ZTEGDC5C139E', clientId: 'mayco' }),
    linked({ frame: 1, slot: 3, port: 1, ontId: 7, serial: 'SERIALVIEJO', clientId: 'alguien-mas' }),
  ];
  const r = classifyImportCandidates(candidates, state);
  assert.equal(r.keepDescription.length, 3);
  assert.equal(r.fullRefresh.length, 1);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].previousClientId, 'alguien-mas');
});

test('lista vacia no rompe', () => {
  assert.deepEqual(classifyImportCandidates([], []), { fullRefresh: [], keepDescription: [], conflicts: [] });
});
