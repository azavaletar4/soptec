import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeRoutineInventory, pendingRoutineInventory } from '../routineInventoryRequest';

test('55P03 conserva el UUID de un recibo confirmado y permite reintento seguro',async()=>{
 const data=new Map<string,string>();const storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}};
 const ids:string[]=[];let commits=0;const receipts=new Map<string,object>();
 const commit=async(r:{p_operation_id:string})=>{ids.push(r.p_operation_id);if(!receipts.has(r.p_operation_id)){commits++;receipts.set(r.p_operation_id,{operation_id:r.p_operation_id});}return {data:receipts.get(r.p_operation_id),error:null};};
 await assert.rejects(executeRoutineInventory(storage,'actor','routine','consume',{quantity:2},async r=>{await commit(r);throw Error('Respuesta perdida');},()=> 'op-confirmada'));
 await assert.rejects(executeRoutineInventory(storage,'actor','routine','consume',{quantity:2},async r=>{ids.push(r.p_operation_id);return {data:null,error:{code:'55P03',message:'could not obtain lock'}};}),/otra operación en curso.*Reintenta/);
 assert.equal(pendingRoutineInventory(storage,'actor','routine')?.p_operation_id,'op-confirmada');
 await assert.rejects(executeRoutineInventory(storage,'actor','routine','consume',{quantity:2},async r=>{ids.push(r.p_operation_id);return {data:null,error:{code:'P0001',message:'No pertenece a la cuadrilla'}};}),/cuadrilla/);
 assert.equal(pendingRoutineInventory(storage,'actor','routine')?.p_operation_id,'op-confirmada');
 await executeRoutineInventory(storage,'actor','routine','consume',{quantity:2},commit,()=> 'NO-generar-otro-UUID');
 assert.deepEqual(ids,['op-confirmada','op-confirmada','op-confirmada','op-confirmada']);assert.equal(commits,1);assert.equal(data.size,0);
});

test('lost response survives reload; exact UUID is reused and payload cannot change', async () => {
 const data=new Map<string,string>();const storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}};
 const requests:string[]=[];
 await assert.rejects(executeRoutineInventory(storage,'actor','routine','consume',{quantity:2},async r=>{requests.push(r.p_operation_id);throw Error('connection lost after commit');},()=> 'operation-1'));
 assert.equal(pendingRoutineInventory(storage,'actor','routine')?.p_operation_id,'operation-1');
 await assert.rejects(executeRoutineInventory(storage,'actor','routine','consume',{quantity:3},async()=>({data:null,error:null})),/pendiente/);
 await executeRoutineInventory(storage,'actor','routine','consume',{quantity:2},async r=>{requests.push(r.p_operation_id);return {data:{ok:true},error:null};});
 assert.deepEqual(requests,['operation-1','operation-1']);assert.equal(data.size,0);
});

test('database rejection clears pending request; failed storage never sends',async()=>{
 const data=new Map<string,string>();const storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}};
 await assert.rejects(executeRoutineInventory(storage,'actor','routine','consume',{},async()=>({data:null,error:{code:'P0001',message:'stock insuficiente'}}),()=> 'op'));
 assert.equal(data.size,0);let sent=false;
 await assert.rejects(executeRoutineInventory({...storage,setItem:()=>{throw Error('quota');}},'actor','routine','consume',{},async()=>{sent=true;return {data:null,error:null};},()=> 'op'));
 assert.equal(sent,false);
});
