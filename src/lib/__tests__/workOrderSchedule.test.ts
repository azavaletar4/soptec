import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateTimeToIso, todayStr } from '../turnos.ts';
import { scheduleLabel, scheduleValues, schedulePatch, routineSchedulePatch, routineTurno, limaDate } from '../workOrderSchedule.ts';

for (const tz of ['America/Lima', 'UTC', 'Asia/Tokyo', 'America/Los_Angeles']) {
  test(`programación Perú independiente del navegador: ${tz}`, () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = tz;
      assert.equal(dateTimeToIso('2026-11-18', '10:00'), '2026-11-18T15:00:00.000Z');
      assert.equal(todayStr(), limaDate(new Date().toISOString()));
      for (const kind of ['ticket', 'installation', 'routine'] as const) {
        for (const [start, end] of [['10:00', '12:00'], ['14:00', '16:00']]) {
          const saved = JSON.parse(JSON.stringify(schedulePatch(kind, '2026-11-18', start, end)));
          assert.equal(scheduleLabel(kind, saved), `18/11/2026 · ${start}–${end}`);
          const edited = JSON.parse(JSON.stringify(schedulePatch(kind, '2026-11-19', '16:00', '18:00')));
          assert.equal(scheduleLabel(kind, edited), '19/11/2026 · 16:00–18:00');
          assert.equal('status' in edited, false);
          assert.equal('assigned_to' in edited, false);
        }
        const historical = { created_at: '2026-11-18T15:00:00Z', scheduled_start_at: null };
        assert.equal(scheduleLabel(kind, historical), 'Sin programación');
        if (kind !== 'ticket') assert.equal(scheduleLabel(kind, { scheduled_date: '2026-11-18' }), '18/11/2026 · Sin horario programado');
      }
      const night = schedulePatch('routine', '2026-11-18', '23:30', '01:00', '2026-11-19');
      assert.equal(scheduleValues('routine', night).date, '2026-11-18');
      assert.equal(scheduleLabel('routine', night), '18/11/2026 · 23:30–19/11/2026 01:00');
      assert.equal(scheduleLabel('installation', { scheduled_date: '2026-11-18', scheduled_time: '15:45:00' }), '18/11/2026 · 15:45');
      assert.equal(schedulePatch('installation', '2026-11-18', '15:45').scheduled_end_at, null);
    } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
  });
}
test('editar una rutina conserva el rango exacto, personalizado, nocturno o incompleto', () => {
  for (const [start, end] of [['10:00', '12:00'], ['10:15', '13:45'], ['23:30', '01:00'], ['14:00', '']]) {
    const original = schedulePatch('routine', '2026-11-18', start, end, end === '01:00' ? '2026-11-19' : '2026-11-18');
    const same = routineSchedulePatch(original, '2026-11-18', routineTurno(original));
    assert.deepEqual(same, original);
    const moved = routineSchedulePatch(original, '2026-11-20', routineTurno(original));
    assert.equal(scheduleValues('routine', moved).date, '2026-11-20');
    assert.equal(scheduleValues('routine', moved).time, start);
    assert.equal(scheduleValues('routine', moved).endTime, end);
    assert.equal(scheduleValues('routine', moved).endDate, end ? end === '01:00' ? '2026-11-21' : '2026-11-20' : '');
  }
  assert.equal(routineSchedulePatch(null, '2026-11-18', '14:00-16:00').scheduled_start_at, '2026-11-18T19:00:00.000Z');
  assert.equal(routineSchedulePatch(null, '', '').scheduled_start_at, null);
});
test('timestamp del cronograma prima sobre fecha/hora legadas y reprogramación vigente sobre turno anterior', () => {
  const order = { ...schedulePatch('installation', '2026-11-19', '16:00'), scheduled_date: '2026-11-18', scheduled_time: '10:00:00' };
  assert.equal(scheduleLabel('installation', order), '19/11/2026 · 16:00');
  const ticket = { ...schedulePatch('ticket', '2026-11-18', '10:00', '12:00'), status: 'rescheduled', rescheduled_to: '2026-11-19T21:00:00Z' };
  assert.equal(scheduleLabel('ticket', ticket), '19/11/2026 · 16:00');
  assert.equal(scheduleLabel('ticket', { ...ticket, status: 'open' }), '18/11/2026 · 10:00–12:00');
  const aligned = { ...schedulePatch('ticket', '2026-11-19', '16:00', '18:00'), status: 'rescheduled', rescheduled_to: '2026-11-19T21:00:00Z' };
  assert.equal(scheduleLabel('ticket', aligned), '19/11/2026 · 16:00–18:00');
  assert.equal(scheduleLabel('ticket', { ...aligned, status: 'in_progress' }), '19/11/2026 · 16:00–18:00');
});
test('rechaza hora sin fecha y rangos inválidos antes de guardar', () => {
  assert.throws(() => schedulePatch('ticket', '', '10:00'), /fecha/);
  assert.throws(() => schedulePatch('routine', '2026-11-18', '14:00', '12:00'), /después/);
  assert.throws(() => schedulePatch('routine', '2026-11-18', '', '12:00'), /inicio/);
});
