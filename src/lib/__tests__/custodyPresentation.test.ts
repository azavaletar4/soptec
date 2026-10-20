import { test } from 'node:test';
import assert from 'node:assert/strict';
import { custodyPresentation } from '../custodyPresentation';
import type { MyInventoryCustody } from '../../types/domain';
const unit = (id: string, status: 'with_technician'|'pending_return') => ({ id, status, serial_number: id, mac_address: null, product: { id: 'ont', name: 'ONT' } });
const row = (id: string, quantity: number, measure: string) => ({ product: { id, name: id, unit: measure }, quantity });
test('custodia: cantidades por unidad, equipos en devolución separados, sin mutar la respuesta', () => {
  const data: MyInventoryCustody = { units: [unit('a','with_technician'),unit('b','with_technician'),unit('c','pending_return')], materials: [row('drop',120.5,'metros'),row('utp',30,'metros'),row('connector',4,'unidades'),row('clamps',3,'unidades'),row('other',2.25,'rollos')], pendingReturnRequests: [] };
  const original = structuredClone(data);
  assert.deepEqual(custodyPresentation(data), { availableEquipment: 2, pendingEquipment: 1, materials: [{ unit:'metros',quantity:150.5 },{ unit:'unidades',quantity:7 },{ unit:'rollos',quantity:2.25 }] });
  assert.deepEqual(data, original);
});
test('custodia: vacío real, decimales, medidas no convertidas y unidad ausente', () => {
  assert.deepEqual(custodyPresentation({ units:[],materials:[],pendingReturnRequests:[] }),{ availableEquipment:0,pendingEquipment:0,materials:[] });
  assert.deepEqual(custodyPresentation({ units:[],materials:[row('a',1.25,'metros'),row('b',2.5,'m'),row('c',0,'unidades'),row('d',2,'')],pendingReturnRequests:[] })?.materials,[{ unit:'metros',quantity:1.25 },{ unit:'m',quantity:2.5 },{ unit:'(unidad no registrada)',quantity:2 }]);
});
test('custodia: datos inválidos nunca producen un cero inventado', () => {
  for(const quantity of [NaN,Infinity,-1,null,undefined,'',false,'0'])assert.equal(custodyPresentation({ units:[],materials:[row('bad',quantity as number,'metros')],pendingReturnRequests:[] }),null);
});
