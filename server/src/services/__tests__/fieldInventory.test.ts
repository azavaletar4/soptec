import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {readFieldInventory} from '../fieldInventory';
const actor='00000000-0000-4000-8000-000000000001',job='00000000-0000-4000-8000-000000000002';
function fixture(code?:string,extra:Record<string,unknown>={}){
 const calls:{path:string;body:Record<string,unknown>}[]=[];
 const db=createClient('https://field.invalid','synthetic-public',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{
  const path=new URL(String(input)).pathname;calls.push({path,body:JSON.parse(String(init?.body))});assert.equal(path,'/rest/v1/rpc/inventory_order_read');
  return new Response(JSON.stringify(code?{code,message:'synthetic error'}:{context:{actorId:actor,jobId:job,jobType:'ticket',clientId:null,contractId:null},items:[],next:null,...extra}),{status:code?400:200,headers:{'Content-Type':'application/json'}});
 }}});return {db,calls};
}
test('RPC contextual conserva pagina y filtros',async()=>{const f=fixture();await readFieldInventory(f.db,actor,{jobType:'ticket',jobId:job,view:'available',page:'2',productId:actor});assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0]?.body,{p_job_type:'ticket',p_job_id:job,p_view:'available',p_page:2,p_product_id:actor,p_unit_id:null,p_action:null})});
for(const [code,status]of [['42501',403],['22023',400],['55P03',409],['PGRST202',500]] as const)test(code+': sin fallback a tablas generales',async()=>{const f=fixture(code);await assert.rejects(readFieldInventory(f.db,actor,{jobType:'ticket',jobId:job,view:'materials'}),(e:any)=>e.status===status);assert.equal(f.calls.length,1)});
test('entradas invalidas no realizan consultas',async()=>{const f=fixture();for(const input of [{jobType:'unknown',jobId:job,view:'products'},{jobType:'ticket',jobId:'invalid',view:'products'},{jobType:'ticket',jobId:job,view:'products',page:'-1'},{jobType:'ticket',jobId:job,view:'prices'}])await assert.rejects(readFieldInventory(f.db,actor,input),(e:any)=>e.status===400);assert.equal(f.calls.length,0)});
test('no publica otra identidad',async()=>{const f=fixture(undefined,{context:{actorId:job,jobId:job,jobType:'ticket'}});await assert.rejects(readFieldInventory(f.db,actor,{jobType:'ticket',jobId:job,view:'products'}),(e:any)=>e.status===500)});
test('rechaza paginas enormes o cursores incorrectos',async()=>{for(const extra of [{items:Array.from({length:101},()=>({}))},{next:5}]){const f=fixture(undefined,extra);await assert.rejects(readFieldInventory(f.db,actor,{jobType:'ticket',jobId:job,view:'products'}),(e:any)=>e.status===500)}});
