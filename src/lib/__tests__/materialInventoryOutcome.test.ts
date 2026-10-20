import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeFieldInventory, pendingFieldInventory } from '../fieldInventoryOperation';
import { executeRoutineInventory, pendingRoutineInventory } from '../routineInventoryRequest';
import { checkMaterialClosure, checkMaterialInventoryOutcome } from '../materialInventoryOutcome';

for (const kind of ['installation','ticket','routine'] as const) test(`${kind}: rechazo conserva UUID, reintento confirma una vez y anulacion explicita limpia pendiente`, async () => {
  const entries=new Map<string,string>();
  const storage={getItem:(k:string)=>entries.get(k)??null,setItem:(k:string,v:string)=>{entries.set(k,v);},removeItem:(k:string)=>{entries.delete(k);}};
  const context={jobType:kind,jobId:'job',actorId:'tech',clientId:null,contractId:null};
  let mode='rejected',calls=0;const ids:string[]=[];
  const invoke=async (r:{p_operation_id:string})=>{
    ids.push(r.p_operation_id);calls++;
    if(mode==='rejected')return {data:{materialRejected:true,operationId:r.p_operation_id,message:'No se registró material. Pide entrega antes de cerrar.'},error:null};
    if(mode==='cancelled')return {data:{materialCancelled:true,operationId:r.p_operation_id,message:'Intento anulado por administración'},error:null};
    return {data:{operationId:r.p_operation_id,jobType:kind,jobId:'job',action:'consume',ids:['movement'],at:'2026-10-19T10:00:00Z'},error:null};
  };
  const run=()=>kind==='routine'
    ?executeRoutineInventory(storage,'tech','job','consume',{quantity:5},invoke,()=> 'op')
    :executeFieldInventory(storage,context,'consume',{quantity:5},invoke,()=> 'op');
  const pending=()=>kind==='routine'?pendingRoutineInventory(storage,'tech','job'):pendingFieldInventory(storage,context);
  await assert.rejects(run(),/No se registró/);
  assert.equal(pending()?.p_operation_id,'op');
  mode='ok';await run();assert.equal(pending(),null);assert.deepEqual(ids,['op','op']);
  mode='rejected';await assert.rejects(run());mode='cancelled';await assert.rejects(run(),/anulado/);assert.equal(pending(),null);
  assert.equal(calls,4);
});

test('prevalidacion de cierre informa rechazo antes de efectos y permite servidor anterior sin RPC', async()=>{
  await assert.rejects(checkMaterialClosure(async()=>({error:{code:'P1651',message:'No se puede cerrar: material pendiente'}})),/No se puede cerrar/);
  await checkMaterialClosure(async()=>({error:null}));
  await checkMaterialClosure(async()=>({error:{code:'PGRST202',message:'funcion aun no desplegada'}}));
  await assert.rejects(checkMaterialClosure(async()=>({error:{code:'42501',message:'Acceso denegado'}})),/Acceso/);
  await assert.rejects(checkMaterialClosure(async()=>{throw Error('sin conexion');}),/sin conexion/);
});

test('una respuesta de anulacion de otro UUID nunca descarta el intento pendiente',()=>{
  let cleared=false;
  assert.throws(()=>checkMaterialInventoryOutcome({materialCancelled:true,operationId:'otra'},()=>{cleared=true;},'propia'),/Conserva la operación pendiente/);
  assert.equal(cleared,false);
});
