import { test } from 'node:test';
import assert from 'node:assert/strict';
import { custodyEquipmentModels, custodyEquipmentUnits, custodyMaterialChoices, custodyUnitLabel } from '../fieldCustodyChoices';
import type { MyInventoryCustody } from '../../types/domain';

const units: MyInventoryCustody['units'] = [
  { id:'own',status:'with_technician',serial_number:'SERIE-PROPIA',mac_address:'AA:BB:CC:DD:EE:01',product:{id:'model-not-in-catalog',name:'Modelo custodiado'} },
  { id:'return',status:'pending_return',serial_number:'DEVOLUCION',mac_address:null,product:{id:'return-model',name:'En devolución'} },
  { id:'warehouse',status:'in_stock',serial_number:'BODEGA',mac_address:null,product:{id:'warehouse-model',name:'Almacén'} },
  { id:'used',status:'assigned',serial_number:'ASIGNADO',mac_address:null,product:{id:'used-model',name:'Ya instalado'} },
];
const materials: MyInventoryCustody['materials'] = [
  {product:{id:'connector',name:'Conector',unit:'unidad'},quantity:1},
  {product:{id:'zero',name:'Agotado',unit:'unidad'},quantity:0},
];
for (const job of ['ticket','routine']) {
  test(`${job}: custodia disponible sin filtros de catálogo/modelo`, () => {
    assert.deepEqual(custodyEquipmentModels(units,'ready').map(p=>p.id),['model-not-in-catalog']);
    assert.deepEqual(custodyEquipmentUnits(units,'model-not-in-catalog','ready').map(u=>u.id),['own']);
    assert.deepEqual(custodyMaterialChoices(materials,'ready').map(p=>p.id),['connector']);
    assert.equal(custodyUnitLabel(units[0]!), 'Modelo custodiado — SERIE-PROPIA — AA:BB:CC:DD:EE:01');
  });
  test(`${job}: técnico sin custodia y producto agotado`, () => {
    assert.deepEqual(custodyEquipmentModels([],'ready'),[]);
    assert.deepEqual(custodyMaterialChoices([],'ready'),[]);
    assert.deepEqual(custodyMaterialChoices([materials[1]!],'ready'),[]);
  });
  test(`${job}: no sustituir una consulta fallida por el inventario general`, () => {
    for(const state of ['loading','error','unavailable'] as const){
      assert.deepEqual(custodyEquipmentModels(units,state),[]);
      assert.deepEqual(custodyEquipmentUnits(units,'model-not-in-catalog',state),[]);
      assert.deepEqual(custodyMaterialChoices(materials,state),[]);
    }
  });
  test(`${job}: cuadrilla, cada respuesta de sesión conserva solo sus equipos`, () => {
    const other=[{...units[0]!,id:'other',serial_number:'OTRA-SERIE'}];
    assert.deepEqual(custodyEquipmentUnits(units,'model-not-in-catalog','ready').map(u=>u.id),['own']);
    assert.deepEqual(custodyEquipmentUnits(other,'model-not-in-catalog','ready').map(u=>u.id),['other']);
    assert(!custodyEquipmentUnits(other,'model-not-in-catalog','ready').some(u=>u.id==='own'));
    assert.deepEqual(custodyEquipmentUnits([{...units[0]!,status:'pending_approval'}],'model-not-in-catalog','ready'),[]);
  });
}
