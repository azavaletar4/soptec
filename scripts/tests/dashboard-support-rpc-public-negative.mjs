// Única petición negativa con rol anon, confirm=false y SIN ID de cliente.
// Debe rechazarse por permisos antes de ejecutar la RPC; no prueba descartes.
import fs from 'node:fs';import assert from 'node:assert/strict';import {loadEnv} from 'vite';
const env=loadEnv('production',process.cwd(),'VITE_');
assert.equal(env.VITE_SUPABASE_URL,'https://mzupdnjegfwmpajywckd.supabase.co');
const response=await fetch(env.VITE_SUPABASE_URL+'/rest/v1/rpc/discard_unfulfilled_client_prospect',{
 method:'POST',headers:{apikey:env.VITE_SUPABASE_ANON_KEY,Authorization:'Bearer '+env.VITE_SUPABASE_ANON_KEY,'Content-Type':'application/json'},
 body:JSON.stringify({p_client_id:null,p_expected_updated_at:null,p_reason:'',p_confirm:false}),signal:AbortSignal.timeout(15000),
});
const data=await response.json();assert.ok([401,403].includes(response.status));assert.equal(data.code,'42501');
const result={status:'PASS',at:new Date().toISOString(),anonymousRpcStatus:response.status,sqlState:data.code,permissionDeniedBeforeExecution:true,clientId:null,confirm:false,realProspectsTouched:0};
fs.writeFileSync('deploy/dashboard-support-prospects-20261113/rpc-anonymous-denied.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
