import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOVEDAD_TIPO_LABEL, novedadEximeDiaCompleto, diaAutorizado, novedadTexto, tardanzaSuprimidaPorPermiso } from '../asistenciaNovedades';

test('vacaciones/descanso/media jornada eximen el día completo; permiso por horas no', () => {
  assert.equal(novedadEximeDiaCompleto('vacaciones'), true);
  assert.equal(novedadEximeDiaCompleto('descanso_programado'), true);
  assert.equal(novedadEximeDiaCompleto('media_jornada'), true);
  assert.equal(novedadEximeDiaCompleto('permiso_horas'), false);
});

test('diaAutorizado solo mira filas de ese día con tipo que exime el día completo', () => {
  const novedades = [
    { fecha: '2026-10-26', tipo: 'permiso_horas' as const },
    { fecha: '2026-10-27', tipo: 'vacaciones' as const },
  ];
  assert.equal(diaAutorizado('2026-10-26', novedades), false); // permiso por horas no exime el día
  assert.equal(diaAutorizado('2026-10-27', novedades), true);
  assert.equal(diaAutorizado('2026-10-28', novedades), false);
});

test('novedadTexto: etiqueta corta por tipo, con turno/horas cuando aplica', () => {
  assert.equal(novedadTexto({ tipo: 'vacaciones', turno: null, hora_inicio: null, hora_fin: null }), NOVEDAD_TIPO_LABEL.vacaciones);
  assert.equal(novedadTexto({ tipo: 'media_jornada', turno: 'manana', hora_inicio: null, hora_fin: null }), 'Media jornada — mañana');
  assert.equal(novedadTexto({ tipo: 'media_jornada', turno: 'tarde', hora_inicio: null, hora_fin: null }), 'Media jornada — tarde');
  assert.equal(novedadTexto({ tipo: 'permiso_horas', turno: null, hora_inicio: '09:00:00', hora_fin: '11:00:00' }), 'Permiso por horas 09:00–11:00');
});

test('tardanzaSuprimidaPorPermiso: solo dentro de la ventana del permiso de ESE día, en hora de Perú', () => {
  const permiso = [{ fecha: '2026-10-26', tipo: 'permiso_horas' as const, hora_fin: '11:00:00' }];
  // 2026-10-26 10:30 Lima = 15:30 UTC -> dentro de la ventana (<= 11:00)
  assert.equal(tardanzaSuprimidaPorPermiso('2026-10-26T15:30:00Z', permiso), true);
  // 2026-10-26 11:30 Lima = 16:30 UTC -> fuera de la ventana
  assert.equal(tardanzaSuprimidaPorPermiso('2026-10-26T16:30:00Z', permiso), false);
  // Mismo horario pero otro día: no aplica.
  assert.equal(tardanzaSuprimidaPorPermiso('2026-10-27T15:30:00Z', permiso), false);
  // Un día exento completo (vacaciones) no es un "permiso por horas": no suprime por esta vía.
  assert.equal(tardanzaSuprimidaPorPermiso('2026-10-26T15:30:00Z', [{ fecha: '2026-10-26', tipo: 'vacaciones', hora_fin: null }]), false);
});
