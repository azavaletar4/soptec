import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cuentaFalta, exentoDeAsistencia, AUSENCIA_LABEL, AUSENCIA_LABEL_CORTO, AUSENCIA_BADGE_CLASS, decisionMotivoEfectivo, DECISION_MOTIVO_APROBAR_DEFAULT } from '../asistenciaAusencias';
import { fechaLimaISO, formatHora, formatFechaHora, diasLaborablesEnRango } from '../asistenciaReglas';

test('SUPERADMIN exento de indicadores; ADMIN/técnico conservan obligación laboral', () => {
  assert.equal(exentoDeAsistencia('SUPERADMIN'), true);
  for (const rol of ['ADMIN', 'TECNICO_RED']) {
    assert.equal(exentoDeAsistencia(rol), false);
    assert.equal(cuentaFalta(false, undefined, '2026-10-26', '2026-10-27', true, !exentoDeAsistencia(rol)), true);
  }
  assert.equal(cuentaFalta(false, undefined, '2026-10-26', '2026-10-27', true, !exentoDeAsistencia('SUPERADMIN')), false);
});

test('pendiente y aprobada no generan falta; rechazo pasado genera una sola falta derivada', () => {
  for (const estado of ['pendiente', 'aprobada'] as const) assert.equal(cuentaFalta(false, estado, '2026-10-26', '2026-10-27', true, true), false);
  assert.equal(cuentaFalta(false, 'rechazada', '2026-10-26', '2026-10-27', true, true), true);
  assert.equal(AUSENCIA_LABEL.pendiente, 'Pendiente de justificar');
});
test('hoy, futuro, no laborables y roles no obligatorios no son faltas', () => {
  for (const dia of ['2026-10-26', '2026-10-27']) assert.equal(cuentaFalta(false, undefined, dia, '2026-10-26', true, true), false);
  assert.equal(cuentaFalta(false, undefined, '2026-10-25', '2026-10-26', false, true), false);
  assert.equal(cuentaFalta(false, undefined, '2026-10-24', '2026-10-26', true, false), false);
});
test('marcación real tiene precedencia sin borrar el estado de justificación', () => {
  for (const estado of ['pendiente', 'aprobada', 'rechazada'] as const) assert.equal(cuentaFalta(true, estado, '2026-10-26', '2026-10-27', true, true), false);
});
test('medianoche de Perú independiente del día UTC', () => {
  assert.equal(fechaLimaISO(new Date('2026-10-27T04:59:59Z')), '2026-10-26');
  assert.equal(fechaLimaISO(new Date('2026-10-27T05:00:00Z')), '2026-10-27');
  assert.match(formatHora('2026-10-27T04:30:00Z'), /11:30|23:30/);
});
test('calendario por fechas: excluye domingo/feriado y cruza mes sin desfases', () => {
  assert.deepEqual(diasLaborablesEnRango('2026-10-30', '2026-11-03', new Set(['2026-11-02'])), ['2026-10-30', '2026-10-31', '2026-11-03']);
});
test('etiquetas/colores cortos del widget movil cubren los 3 estados, sin tocar AUSENCIA_LABEL (bandeja admin)', () => {
  for (const estado of ['pendiente', 'aprobada', 'rechazada'] as const) {
    assert.ok(AUSENCIA_LABEL_CORTO[estado].length > 0);
    assert.ok(AUSENCIA_BADGE_CLASS[estado].length > 0);
  }
  assert.equal(AUSENCIA_LABEL_CORTO.pendiente, 'Pendiente');
  assert.equal(AUSENCIA_LABEL.pendiente, 'Pendiente de justificar'); // sin cambios, lo usa la bandeja SUPERADMIN
});
test('aprobar admite comentario vacío (usa un valor por defecto); rechazar SIEMPRE exige texto real', () => {
  assert.equal(decisionMotivoEfectivo('aprobada', ''), DECISION_MOTIVO_APROBAR_DEFAULT);
  assert.equal(decisionMotivoEfectivo('aprobada', '   '), DECISION_MOTIVO_APROBAR_DEFAULT);
  assert.equal(decisionMotivoEfectivo('aprobada', 'Coordinado con el equipo'), 'Coordinado con el equipo');
  assert.equal(decisionMotivoEfectivo('rechazada', ''), ''); // cadena vacía -> el boton de Rechazar debe seguir deshabilitado
  assert.equal(decisionMotivoEfectivo('rechazada', '   '), '');
  assert.equal(decisionMotivoEfectivo('rechazada', 'No hay cobertura ese día'), 'No hay cobertura ese día');
});
test('formatFechaHora: fecha y hora real del evento, siempre en horario de Perú (nunca la de renderizado)', () => {
  assert.equal(formatFechaHora(null), '—');
  assert.match(formatFechaHora('2026-10-26T20:35:00Z'), /2026/); // nunca ambiguo: ano completo visible
  assert.match(formatFechaHora('2026-10-26T20:35:00Z'), /15:35|3:35/); // 20:35 UTC = 15:35 Lima
});
