import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClientRetirementRoutes } from '../src/routes/clientRetirement';
import type { AuthUser } from '../src/middleware/auth';
const id='10000000-0000-0000-0000-000000000001';
const token='a'.repeat(32);
function setup(role:AuthUser['role']|null,error:null|{code:string}=null){
 const calls:{name:string;args:Record<string,unknown>;authorization:string}[]=[];
 const app=createClientRetirementRoutes(async(c,next)=>{if(role)c.set('user',{id:'session-user',role});await next();},authorization=>({rpc:async(name,args)=>{
  calls.push({name,args,authorization});return {data:{clientId:id,status:'retired'},error};
 }}));
 const send=(body:unknown)=>app.request(`/${id}/retirement`,{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify(body)});
 return {app,calls,send};
}
const valid={previewToken:token,affectedContractIds:[id],confirmAllContracts:true};
test('HTTP: ADMIN/SUPERADMIN consultan y confirman; JWT reenviado sin service_role',async()=>{
 for(const role of ['ADMIN','SUPERADMIN'] as const){const {app,calls,send}=setup(role);assert.equal((await app.request(`/${id}/retirement`,{headers:{Authorization:'Bearer synthetic'}})).status,200);assert.equal((await send(valid)).status,200);assert.equal(calls[0]!.name,'client_retirement_preview');assert.deepEqual(calls[1],{name:'client_retire_atomic',authorization:'Bearer synthetic',args:{p_client_id:id,p_preview_token:token,p_contract_ids:[id],p_confirm_all:true}});}
});
test('HTTP: otros roles y anónimo bloqueados antes de llamar RPC',async()=>{
 for(const role of [null,'SOPORTE','FACTURACION','TECNICO_RED','CLIENTE'] as const){const {app,calls,send}=setup(role);assert.equal((await app.request(`/${id}/retirement`)).status,role?403:401);assert.equal((await send(valid)).status,role?403:401);assert.equal(calls.length,0);}
});
test('HTTP: confirmación explícita, IDs y token requeridos; cancelar no ejecuta RPC',async()=>{
 const {send,calls,app}=setup('ADMIN');
 for(const body of [null,{},[],{...valid,confirmAllContracts:false},{...valid,previewToken:'old'},{...valid,affectedContractIds:['bad']},{...valid,affectedContractIds:[id,id]}])assert.equal((await send(body)).status,400);
 assert.equal((await app.request('/bad/retirement')).status,400);assert.equal(calls.length,0);
});
test('HTTP: permisos SQL, alta abierta, fallo transaccional y SQL ausente fallan cerrados',async()=>{
 for(const [code,status]of [['42501',403],['PBR02',409],['PBR03',409],['40P01',409],['55P03',409],['PBR04',404],['PGRST202',503],['42883',503],['XX000',500]] as const){const {send,calls}=setup('ADMIN',{code});const response=await send(valid);assert.equal(response.status,status,code);assert.equal(calls.length,1);assert.ok((await response.json() as {error:string}).error);}
});
