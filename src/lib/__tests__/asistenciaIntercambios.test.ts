import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diasLaborablesConIntercambios, intercambioDeDia, type IntercambioDia } from '../asistenciaIntercambios';
import { cuentaFalta } from '../asistenciaAusencias';
const rows: IntercambioDia[] = [
  { user_id:'tecnico',fecha:'2026-11-02',tipo:'descanso',fecha_vinculada:'2026-11-01',hora_ingreso:'09:00',hora_salida:'18:00' },
  { user_id:'tecnico',fecha:'2026-11-01',tipo:'trabajo',fecha_vinculada:'2026-11-02',hora_ingreso:'09:00',hora_salida:'18:00' },
];
test('reporte mensual: lunes exento, domingo obligatorio con y sin ingreso real',()=>{
 const dias=diasLaborablesConIntercambios(['2026-11-02','2026-11-03'],rows,'tecnico','2026-11-01','2026-11-30');
 assert.deepEqual(dias,['2026-11-01','2026-11-03']);
 assert.equal(dias.filter(d=>cuentaFalta(d==='2026-11-01',undefined,d,'2026-12-01',true,true)).length,1);
 assert.equal(dias.filter(d=>cuentaFalta(false,undefined,d,'2026-12-01',true,true)).length,2);
 assert.equal(cuentaFalta(false,'aprobada','2026-11-01','2026-12-01',true,true),false);
});
test('tablero distingue descanso autorizado y trabajo; no afecta otros colaboradores',()=>{
 assert.equal(intercambioDeDia(rows,'tecnico','2026-11-02')?.tipo,'descanso');
 assert.equal(intercambioDeDia(rows,'otro','2026-11-02'),undefined);
 assert.deepEqual(diasLaborablesConIntercambios(['2026-11-02'],rows,'otro','2026-11-01','2026-11-30'),['2026-11-02']);
});
test('corte mensual no exige días futuros y conserva intercambio entre meses',()=>{
 assert.deepEqual(diasLaborablesConIntercambios([],rows,'tecnico','2026-10-01','2026-10-31'),[]);
 const cruzado = [{...rows[1],fecha:'2026-11-01',fecha_vinculada:'2026-10-30'}];
 assert.deepEqual(diasLaborablesConIntercambios([],cruzado,'tecnico','2026-11-01','2026-11-30'),['2026-11-01']);
});
