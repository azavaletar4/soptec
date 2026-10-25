import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointsAreEditable, requireWorkOrderPoints, pointReportInstant } from '../workOrderPoints.ts';
test('puntos: vacíos, cero y valores no finitos se rechazan',()=>{
  for(const v of [undefined,null,'',0,-1,NaN,Infinity,'5']) assert.throws(()=>requireWorkOrderPoints(v));
  assert.equal(requireWorkOrderPoints(5,true),5);
  assert.equal(requireWorkOrderPoints(2.5),2.5);
  assert.throws(()=>requireWorkOrderPoints(2.5,true));
});
test('solo estados anteriores al cierre permiten ajuste',()=>{
  for(const s of ['open','pending','scheduled','in_progress','rescheduled']) assert.equal(pointsAreEditable(s),true);
  for(const s of ['resolved','closed','completed','cancelled','unknown']) assert.equal(pointsAreEditable(s),false);
});
test('reporte oficial usa Lima; conserva instantes explícitos y el histórico',()=>{
  assert.equal(pointReportInstant('2026-10-01T00:00:00'),'2026-10-01T00:00:00');
  assert.equal(pointReportInstant('2026-11-01T00:00:00'),'2026-11-01T00:00:00-05:00');
  assert.equal(pointReportInstant('2026-11-30T23:59:59'),'2026-11-30T23:59:59-05:00');
  assert.equal(pointReportInstant('2026-11-01T00:00:00Z'),'2026-11-01T00:00:00Z');
});
