import {test} from 'node:test';import assert from 'node:assert/strict';
import {validateMixedParts,operatingExpenseCents,otherCashIncomeCents,movimientoDisplayLabel,type CashMovement} from '../financeCash';
test('mixto suma centavos exactos y normaliza referencias por medio',()=>{assert.deepEqual(validateMixedParts([{method:'cash',amount:'0.10'},{method:'plin',amount:'0.20',reference:' P-26 '}]),{parts:[{method:'cash',amount:'0.10',reference:''},{method:'plin',amount:'0.20',reference:'P-26'}],totalCents:30});});
test('mixto rechaza importes no finitos, negativos y precisión adicional',()=>{for(const amount of ['NaN','Infinity','-1','1.001','0'])assert.throws(()=>validateMixedParts([{method:'cash',amount},{method:'plin',amount:'1',reference:'P'}]));});
test('gasto compensado vuelve a cero; retiro y cobranza nunca son gasto operativo',()=>{const rows:CashMovement[]=[{id:'a',tipo:'egreso',monto:'10.50',finance_kind:'manual'},{id:'b',tipo:'ingreso',monto:'10.50',finance_kind:'movement_reversal',source_movement_id:'a'},{id:'c',tipo:'egreso',monto:50,finance_kind:'owner_withdrawal'},{id:'d',tipo:'ingreso',monto:50,finance_kind:'movement_reversal',source_movement_id:'c'},{id:'e',tipo:'egreso',monto:20,finance_kind:'payment_reversal'}],map=new Map(rows.map(r=>[r.id,r]));assert.deepEqual(rows.map(r=>operatingExpenseCents(r,map)),[1050,-1050,0,0,0]);});

test('otherCashIncomeCents: solo suma ingresos manuales del día exacto, nunca cobranzas ni compensaciones',()=>{
 const movs=[
  {fecha:'2026-11-28',tipo:'ingreso',finance_kind:'manual',monto:'1000.00'},
  {fecha:'2026-11-28',tipo:'ingreso',finance_kind:'collection',monto:'480.00'},
  {fecha:'2026-11-28',tipo:'ingreso',finance_kind:'movement_reversal',monto:'50.00'},
  {fecha:'2026-11-27',tipo:'ingreso',finance_kind:'manual',monto:'200.00'},
  {fecha:'2026-11-28',tipo:'egreso',finance_kind:'manual',monto:'30.00'},
 ];
 assert.equal(otherCashIncomeCents(movs,'2026-11-28'),100000);
});
test('otherCashIncomeCents: finance_kind ausente se trata como manual (compatibilidad)',()=>{
 assert.equal(otherCashIncomeCents([{fecha:'2026-11-28',tipo:'ingreso',monto:'15.00'}],'2026-11-28'),1500);
});

test('movimientoDisplayLabel: cobranza/reversión con recibo ya asignado muestra el recibo, nunca el UUID',()=>{
 assert.equal(movimientoDisplayLabel({finance_kind:'collection',descripcion:'Cobranza 00000000-0000-0000-0000-000000000900',linked_payment:{receipt_number:'RCI-2026-00000001'}}),'Cobranza · RCI-2026-00000001');
 assert.equal(movimientoDisplayLabel({finance_kind:'payment_reversal',descripcion:'Reversión: motivo',linked_payment:{receipt_number:'RCI-2026-00000002'}}),'Reversión de cobranza · RCI-2026-00000002');
});
test('movimientoDisplayLabel: sin recibo todavía (o sin pago vinculado) conserva la descripción tal cual, nunca inventa un identificador',()=>{
 assert.equal(movimientoDisplayLabel({finance_kind:'collection',descripcion:'Cobranza 00000000-0000-0000-0000-000000000900',linked_payment:{receipt_number:null}}),'Cobranza 00000000-0000-0000-0000-000000000900');
 assert.equal(movimientoDisplayLabel({finance_kind:'manual',descripcion:'Gasolina camioneta'}),'Gasolina camioneta');
});
