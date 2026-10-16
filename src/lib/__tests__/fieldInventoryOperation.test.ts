import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeFieldInventory, pendingFieldInventory, type FieldInventoryRequest } from '../fieldInventoryOperation.ts';
const context={actorId:'actor',jobId:'job',jobType:'installation' as const,clientId:'client',contractId:'contract'};
function storage(){const map=new Map<string,string>();return {getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>{map.delete(k);}};}
const success=(r:FieldInventoryRequest)=>({data:{operationId:r.p_operation_id,jobType:r.p_job_type,jobId:r.p_job_id,action:r.p_action,ids:['event'],at:'2026-10-15'},error:null});
test('pérdida de respuesta: persiste antes de enviar y reusa UUID tras recargar',async()=>{const s=storage(),p={productId:'cable',quantity:1};let first='';await assert.rejects(executeFieldInventory(s,context,'consume',p,async r=>{first=r.p_operation_id;assert(pendingFieldInventory(s,context));throw Error('respuesta perdida');},()=> 'stable'));assert.equal(first,'stable');const receipt=await executeFieldInventory(s,context,'consume',p,async r=>{assert.equal(r.p_operation_id,first);return success(r);},()=> 'different');assert.equal(receipt.operationId,first);assert.equal(pendingFieldInventory(s,context),null);});
test('operación incierta bloquea carga diferente sin invocación',async()=>{const s=storage();await assert.rejects(executeFieldInventory(s,context,'consume',{quantity:1},async()=>{throw Error('offline');}));let called=false;await assert.rejects(executeFieldInventory(s,context,'consume',{quantity:2},async r=>{called=true;return success(r);}));assert.equal(called,false);});
test('recibo con orden/acción/clave incorrectas no borra intención',async()=>{for(const change of [{jobId:'other'},{operationId:'other'},{action:'return'}]){const s=storage();await assert.rejects(executeFieldInventory(s,context,'consume',{},async r=>{const out=success(r);Object.assign(out.data,change);return out;}));assert(pendingFieldInventory(s,context));}});
test('SQLSTATE en primer intento confirma rollback y permite corregir formulario',async()=>{const s=storage();await assert.rejects(executeFieldInventory(s,context,'consume',{},async()=>({data:null,error:{code:'P0001',message:'Stock insuficiente'}})));assert.equal(pendingFieldInventory(s,context),null);});
test('denegación posterior a una respuesta perdida no descarta la operación anterior',async()=>{const s=storage();await assert.rejects(executeFieldInventory(s,context,'consume',{},async()=>{throw Error('offline');}));await assert.rejects(executeFieldInventory(s,context,'consume',{},async()=>({data:null,error:{code:'42501',message:'Sin acceso'}})));assert(pendingFieldInventory(s,context));});
test('almacenamiento fallido impide enviar y otra identidad no hereda intención',async()=>{const s=storage();let called=false;await assert.rejects(executeFieldInventory({...s,setItem(){throw Error('quota');}},context,'consume',{},async r=>{called=true;return success(r);}));assert.equal(called,false);await assert.rejects(executeFieldInventory(s,context,'consume',{},async()=>{throw Error('offline');}));assert.equal(pendingFieldInventory(s,{...context,actorId:'other'}),null);});
test('55P03 inicial muestra mensaje español sin detalles SQL y confirma rollback',async()=>{
  const s=storage();
  await assert.rejects(executeFieldInventory(s,context,'consume',{},async()=>({data:null,error:{code:'55P03',message:'could not obtain lock on row in relation job_assignees'}})),error=>{
    assert(error instanceof Error);
    assert.match(error.message,/Hay otra operación en curso/);
    assert.match(error.message,/reintentarlo de forma segura/);
    assert.doesNotMatch(error.message,/job_assignees|could not obtain lock/);
    return true;
  });
  assert.equal(pendingFieldInventory(s,context),null);
});
test('55P03 tras respuesta perdida conserva intención y reintenta con la misma UUID',async()=>{
  const s=storage();
  await assert.rejects(executeFieldInventory(s,context,'consume',{},async()=>{throw Error('respuesta perdida');},()=> 'stable-operation'));
  await assert.rejects(executeFieldInventory(s,context,'consume',{},async r=>{
    assert.equal(r.p_operation_id,'stable-operation');
    return {data:null,error:{code:'55P03',message:'lock not available'}};
  }),/Confirmar operación de inventario pendiente/);
  assert.equal(pendingFieldInventory(s,context)?.p_operation_id,'stable-operation');
  await executeFieldInventory(s,context,'consume',{},async r=>{
    assert.equal(r.p_operation_id,'stable-operation');return success(r);
  },()=> 'must-not-use-new-id');
  assert.equal(pendingFieldInventory(s,context),null);
});
