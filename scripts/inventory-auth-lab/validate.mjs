import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { decodeProtectedHeader,createRemoteJWKSet,jwtVerify } from 'jose';
import { config,sql,runtime,gateway,root } from './common.mjs';
const c=config(),m=JSON.parse(readFileSync(runtime+'manifest.json','utf8'));
const result=[];
const record=(test,detail)=>{result.push({test,status:'PASS',detail});console.log('PASS '+test);};
const digest=()=>sql(`select jsonb_build_object('movements',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from inventory_movements t),'events',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from inventory_unit_events t),'units',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from inventory_units t),'products',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from inventory_products t))`);
const baseline=digest(),tokens={};
const jwks=createRemoteJWKSet(new URL(gateway+'/auth/v1/.well-known/jwks.json'));
for(const a of c.accounts){
 const auth=createClient(gateway,c.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await auth.auth.signInWithPassword({email:a.email,password:a.password});
 assert(!error,error?.message);assert(data.session?.access_token);
 const token=data.session.access_token;tokens[a.role]=token;
 const verified=await jwtVerify(token,jwks,{issuer:gateway+'/auth/v1',audience:'authenticated'});
 assert.equal(verified.payload.sub,m.users[a.role]);assert.equal(verified.payload.role,'authenticated');
 assert.equal(decodeProtectedHeader(token).alg,'ES256');
 record('Auth JWT real '+a.role,'Login con contraseña ficticia; firma ES256, issuer, audience y sub verificados; sin token en informe.');
}
const get=async(token,job,view)=>{
 const response=await fetch(`${gateway}/api/campo-inventory/${job.type}/${job.id}/${view}?page=0`,{headers:token?{Authorization:'Bearer '+token}:{}});
 return {status:response.status,body:await response.json()};
};
function noAdministrative(value){if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){assert(!['price','balance_after','total_value','document_number','email'].includes(key));noAdministrative(item);}}
for(const role of ['leader','support','removed'])for(const job of m.jobs.slice(0,2))for(const view of ['materials','assigned','pending']){
 const r=await get(tokens[role],job,view);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.context.actorId,m.users[role]);assert.equal(r.body.context.jobId,job.id);assert.equal(r.body.context.contractId,job.contractId);noAdministrative(r.body);
 if(view==='assigned'){assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].id,job.unitId);assert.equal(r.body.items[0].contract_id,job.contractId);}
 if(view==='materials'){assert.equal(r.body.items.length,1);assert.equal(r.body.items[0][job.type==='installation'?'installation_id':'ticket_id'],job.id);}
 record(`${role} ${job.type} ${view}`,'200; contexto exacto, solo datos esperados y sin columnas administrativas.');
}
for(const role of ['leader','support','outsider'])for(const job of (role==='outsider'?m.jobs.slice(0,2):m.jobs.slice(2)))for(const view of ['materials','assigned','pending']){
 const r=await get(tokens[role],job,view);assert.equal(r.status,403);assert.deepEqual(Object.keys(r.body),['error']);
 record(`${role} orden ajena ${job.type} ${view}`,'403 sin items ni contexto operativo.');
}
// Solo fixture local: retirar al cuarto usuario sin alterar sus JWT ni inventario.
sql(`delete from job_assignees where technician_id='${m.users.removed}';`);
for(const job of m.jobs.slice(0,2))for(const view of ['materials','assigned','pending']){
 const r=await get(tokens.removed,job,view);assert.equal(r.status,403);assert.deepEqual(Object.keys(r.body),['error']);
 record(`retirado mismo JWT ${job.type} ${view}`,'403 inmediato, aun con perfil de middleware cacheado; sin datos.');
}
assert.equal((await get(null,m.jobs[0],'assigned')).status,401);
assert.equal((await get(tokens.leader.slice(0,-10)+'invalidJWT',m.jobs[0],'assigned')).status,401);
record('sin sesión / JWT alterado','401; no se acepta identidad inventada.');
const blocked=await fetch(gateway+'/rest/v1/rpc/campo_inventory_operation',{method:'POST',headers:{Authorization:'Bearer '+tokens.leader,apikey:c.anonKey,'Content-Type':'application/json'},body:'{}'});
assert.equal(blocked.status,405);assert.equal(digest(),baseline);
assert.equal(sql("select count(*) from campo_inventory_operations"),'0');
record('inventario invariable y RPC HTTP bloqueada','405; hashes de movimientos/eventos/unidades/productos iguales; cero recibos.');
assert.equal(sql("select (to_regprocedure('public.campo_inventory_operation(uuid,text,uuid,text,jsonb)') is not null)::int"),'1');
assert.equal(sql("select (to_regprocedure('public.routine_inventory_operation(uuid,uuid,text,jsonb)') is null)::int"),'1');
record('etapa 3 instalada solo en laboratorio / Fase 162 ausente','La RPC existe pero no se invoca; no se certifican mutaciones mediante estas lecturas.');
writeFileSync(root+'docs/INVENTARIO-LAB-AUTH-RESULTADOS.json',JSON.stringify({at:new Date().toISOString(),environment:'LOCAL_SYNTHETIC_ONLY',authentication:'REAL_GOTRUE_ES256_PASSWORD_LOGIN',results:result,productionAccess:false,inventoryMutationsDuringValidation:0},null,2)+'\n');
console.log(`LAB_AUTH_VALIDATION_OK ${result.length} comprobaciones; tokens solo en memoria.`);
