import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertClientCanReactivate } from '../src/services/clientReactivationGuard';

test('guard: contrato cancelado/ficha retirada/ficha desconocida no reactivan; suspensión sigue permitida',()=>{
 for(const [status,parent] of [['cancelled','active'],['active','retired'],['suspended','retired'],['active',null]])assert.throws(()=>assertClientCanReactivate(status!,parent),/no autoriza|no se reactivará/);
 for(const parent of ['active','suspended','prospect'])assert.doesNotThrow(()=>assertClientCanReactivate('suspended',parent));
});
test('función compartida real bloquea antes de consultar equipos o ejecutar comandos',async()=>{
 const previousFetch=globalThis.fetch;
 const previousUrl=process.env.VITE_SUPABASE_URL,previousKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.VITE_SUPABASE_URL='https://retirement.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';
 let contractStatus='cancelled',clientStatus:string|null='active';const calls:{table:string;method:string}[]=[];
 globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.toString():input.url);
  assert.equal(url.origin,'https://retirement.invalid');
  const table=url.pathname.split('/').at(-1)!;calls.push({table,method:init?.method??'GET'});
  assert.equal(table,'service_contracts','No se debe consultar equipos ni dispositivos');assert.equal(init?.method??'GET','GET');
  return new Response(JSON.stringify({id:'synthetic',client_id:'synthetic-client',status:contractStatus,clients:clientStatus?{status:clientStatus}:null,
   debt_hold_status:'pending',mikrotik_device_id:null,pppoe_username:null,plans:{olt_tcont_profile:null,olt_traffic_profile:null}}),{status:200,headers:{'Content-Type':'application/json'}});
 };
 try{
  const { reactivateContract }=await import('../src/services/debtHoldService');
  for(const [status,parent] of [['cancelled','active'],['active','retired'],['active',null]]){
   contractStatus=status!;clientStatus=parent;const count=calls.length;
   await assert.rejects(reactivateContract('synthetic'),/no autoriza|no se reactivará/);assert.equal(calls.length,count+1);
  }
  contractStatus='suspended';clientStatus='active';await assert.rejects(reactivateContract('synthetic'),/no tiene perfiles OLT/);
 }finally{globalThis.fetch=previousFetch;if(previousUrl===undefined)delete process.env.VITE_SUPABASE_URL;else process.env.VITE_SUPABASE_URL=previousUrl;if(previousKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=previousKey;}
});
