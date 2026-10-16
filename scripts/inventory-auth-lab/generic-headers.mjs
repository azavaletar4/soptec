// Comprobación nueva y acotada de metadatos: no repite escenarios de cuadrilla/UI.
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {config,gateway,root,wait} from './common.mjs';
const c=config(),opened=[];
let clock,common;
try{
 clock=fork(join(root,'scripts/inventory-auth-lab/generic-clock.mjs'),[],{cwd:root,env:{...process.env,LAB_GENERIC_CLOCK:'1'},windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
 await wait(async()=>{try{return (await fetch('http://127.0.0.1:54388/health')).ok;}catch{return false;}});
 for(const [i,a] of c.accounts.entries()){
  const auth=createClient(gateway,c.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await auth.auth.signInWithPassword({email:a.email,password:a.password});assert(!error,error?.message);
  const abort=new AbortController();opened.push(abort);
  const r=await fetch('http://127.0.0.1:54388/events',{signal:abort.signal,headers:{Authorization:'Bearer '+data.session.access_token,Cookie:`lab-client=${i}`,'Last-Event-ID':`ignored-${i}`,'X-Job-Id':`ignored-order-${i}`}});
  assert.equal(r.status,200);const headers=Object.fromEntries(r.headers);
  const allowed=['content-type','cache-control','x-accel-buffering','connection','keep-alive','transfer-encoding'];
  assert(Object.keys(headers).every(k=>allowed.includes(k)),'Cabecera inesperada');
  if(common)assert.deepEqual(headers,common);else common=headers;
 }
 writeFileSync(root+'docs/INVENTARIO-LAB-GENERICOS-CABECERAS.json',JSON.stringify({at:new Date().toISOString(),environment:'LOCAL_SYNTHETIC_ONLY',status:'PASS',realJwtSessions:4,headers:common,ignoredRequestHeaders:['Authorization','Cookie','Last-Event-ID','X-Job-Id'],operationalHeaders:0},null,2)+'\n');
 console.log('GENERIC_HEADERS_PASS: cuatro JWT reales y cabeceras de petición distintas producen cabeceras idénticas y sin metadatos operativos.');
}finally{for(const a of opened)a.abort();if(clock){clock.kill('SIGTERM');await Promise.race([new Promise(r=>clock.once('exit',r)),new Promise(r=>setTimeout(r,1000))]);}}
