import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIA_SEMANA_LABEL, horarioPersonalTexto, horarioPersonalDeDia } from '../asistenciaHorariosPersonales';
import type { HorarioPersonal } from '../../types/domain';

function horario(partial: Partial<HorarioPersonal>): HorarioPersonal {
  return {
    id: '1', user_id: 'u1', dia_semana: 6, turno: 'tarde', hora_ingreso: '14:00:00', hora_salida: '18:00:00',
    created_by: 'super', created_at: '2026-10-26T00:00:00Z', updated_at: '2026-10-26T00:00:00Z', ...partial,
  };
}

test('horarioPersonalTexto: día + rango horario real + turno, nunca una hora inventada', () => {
  assert.equal(horarioPersonalTexto(horario({})), 'Sábado 14:00–18:00 (tarde)');
  assert.equal(horarioPersonalTexto(horario({ dia_semana: 1, turno: 'manana', hora_ingreso: '08:00:00', hora_salida: '13:00:00' })), 'Lunes 08:00–13:00 (mañana)');
  assert.equal(DIA_SEMANA_LABEL[6], 'Sábado');
});

test('horarioPersonalDeDia: encuentra el horario de ESE día de la semana, nada si no hay uno configurado', () => {
  const horarios = [horario({ dia_semana: 6 })];
  assert.equal(horarioPersonalDeDia(horarios, 6)?.hora_ingreso, '14:00:00');
  assert.equal(horarioPersonalDeDia(horarios, 1), undefined); // sin horario ese día -> sigue el horario global, no se inventa uno
});
