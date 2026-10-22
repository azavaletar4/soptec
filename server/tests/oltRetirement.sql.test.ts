import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createClient } from '@supabase/supabase-js';
import { classifyImportCandidates } from '../src/services/oltImportDescriptionGuard';
import { OntTelemetryEvidence, evaluateOntEvidence, type TelemetryScan, type OntEvidence } from '../src/services/oltTelemetry';
import { enforceOntEvidence } from '../../src/lib/ontTelemetryEvidence';
import { createSupabaseProvisioningStore, type NewOntInput } from '../src/services/oltProvisioningStore';
import { persistOntMeasurement } from '../src/services/oltTelemetryPersistence';
import { readVerifiedOntSignal } from '../src/services/oltVerifiedRead';

const file=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const originalFunction=(p:string,name:string)=>file(p).match(new RegExp('create or replace function public\\.'+name+'\\([\\s\\S]*?\\$\\$;'))![0];
const expand=file('../../supabase/migrations/20261021170000_olt_retirement_expand.sql');
const contract=file('../../supabase/migrations/20261021171000_olt_retirement_active_positions.sql');
const downContract=file('../../scripts/sql/olt-retirement-contract-down.sql');
const downExpand=file('../../scripts/sql/olt-retirement-expand-down.sql');
const reconcile=file('../../scripts/sql/olt-janet-estiven-reconcile-candidate.sql');
const rollback=file('../../scripts/sql/olt-janet-estiven-reconcile-rollback.sql');
const device='700d31b5-679e-4dda-9eeb-53bf3aaf87e0',old='a1f0b671-a1e2-482c-b24e-7e584bf0e4ed',janet='74d586e3-3a0a-40c2-aba3-46294adcf095',replacement='76701eb5-405e-462f-862d-384a469cadac';
const jc='a563d740-a060-417e-852a-5153edeefb18',ec='3f01013e-ad20-44bb-ad15-443416e14d63',jcontract='cb2ee4ae-3301-44cc-b44c-939cca819e3b',econtract='91f25111-758a-4f5a-9b79-196065509cde',unit='f4c174ef-9136-4ee6-83e7-4082d8a47140';
const candidate={frame:1,slot:2,port:8,ontId:3,serial:'HWTCE5C94DB6'};
const input:NewOntInput={olt_device_id:device,frame:1,slot:2,port:8,ont_id:3,serial:'HWTCE5C94DB6',client_id:ec,contract_id:econtract,description:'Synthetic replacement',onu_type:'GPT',vlan:200,tcont_profile:'UP',traffic_profile:'DOWN'};

test('OLT retirement: real PostgreSQL 17, isolated data and actual application readers/writers', {timeout:180000}, async t=>{
 const container='smartrayco-olt-retirement-'+process.pid+'-'+Date.now();
 const docker=(args:string[],input?:string)=>execFileSync('docker',['--host','npipe:////./pipe/dockerDesktopLinuxEngine',...args],{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
 const sql=(s:string)=>docker(['exec','-i',container,'psql','-h','127.0.0.1','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres'],s).trim();
 const row=(id:string)=>JSON.parse(sql(`select row_to_json(o) from olt_onts o where id='${id}';`));
 const beforeProtected=()=>sql(`select json_build_object('clients',(select json_agg(c order by id) from clients c),'contracts',(select json_agg(c order by id) from service_contracts c),'inventory',(select json_agg(c order by id) from inventory_units c),'alerts',(select json_agg(c order by id) from olt_alert_log c),'operations',(select json_agg(c order by id) from olt_provisioning_operations c),'janet',(select row_to_json(o) from olt_onts o where id='${janet}'),'clientUpdates',(select count(*) from client_update_audit));`);
 const apply=()=>sql(`set smartrayco.approve_ont_reconciliation='janet-estiven-v1';\n${reconcile}`);
 const undo=()=>sql(`set smartrayco.approve_ont_reconciliation='rollback-janet-estiven-v1';\n${rollback}`);
 const reset=()=>sql(`truncate olt_alert_log,olt_provisioning_operations,olt_onts,client_update_audit;
  insert into olt_onts(id,olt_device_id,serial,frame,slot,port,ont_id,description,status,rx_power,client_id,contract_id)
  values('${old}','${device}','MSTC8CCE647E',1,2,8,3,'Historical fixture','online',-19.71,null,null),
  ('${janet}','${device}','HWTCDEB847B6',1,2,8,50,'Janet fixture','online',-23.98,'${jc}','${jcontract}');
  insert into olt_alert_log values('00000000-0000-4000-8000-000000000001','${old}','offline');
  insert into olt_provisioning_operations values('00000000-0000-4000-8000-000000000002','${old}','completed');`);
 const q=(v:unknown)=>v===null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
 const restCalls:{method:string;url:string}[]=[];
 const rest:typeof fetch=async(resource,init)=>{
  const request=new Request(resource,init),u=new URL(request.url);assert.equal(u.hostname,'127.0.0.1');
  const table=u.pathname.split('/').at(-1)!;restCalls.push({method:request.method,url:request.url});
  if(table==='profiles')return Response.json([{role:'ADMIN',active:true}]);
  assert(['olt_onts','olt_devices'].includes(table),'Unmocked database table '+table);
  const clauses:string[]=[];
  for(const [key,value] of u.searchParams){
   if(['select','order','limit','offset','on_conflict'].includes(key))continue;
   assert(/^[a-z_]+$/.test(key));
   if(value==='is.null')clauses.push(`${key} is null`);
   else if(value==='not.is.null')clauses.push(`${key} is not null`);
   else if(value.startsWith('eq.'))clauses.push(`${key}=${q(value.slice(3))}`);
   else if(value.startsWith('ilike.'))clauses.push(`${key} ilike ${q(value.slice(6))}`);
   else if(value.startsWith('in.('))clauses.push(`${key} in (${value.slice(4,-1).split(',').map(q).join(',')})`);
   else throw Error('Unmocked predicate '+value);
  }
  const where=clauses.length?' where '+clauses.join(' and '):'';
  try{
   let query=`select * from ${table}${where}`;
   if(request.method==='POST'||request.method==='PATCH'){
    const payload=await request.json() as Record<string,unknown>;const keys=Object.keys(payload);assert(keys.every(k=>/^[a-z_]+$/.test(k)));
    query=request.method==='POST'?`insert into ${table}(${keys.join(',')}) values(${keys.map(k=>q(payload[k])).join(',')}) returning *`:
     `update ${table} set ${keys.map(k=>k+'='+q(payload[k])).join(',')}${where} returning *`;
    assert(!u.searchParams.has('on_conflict'),'Partial index must never use legacy upsert');
   } else assert.equal(request.method,'GET','Unexpected mutation');
   const result=JSON.parse(sql(`with result as (${query}) select coalesce(json_agg(result),'[]'::json) from result;`));
   if(request.headers.get('accept')?.includes('application/vnd.pgrst.object+json')) {
    if(result.length!==1)return Response.json({code:'PGRST116',message:'Expected one row'},{status:406});
    return Response.json(result[0]);
   }
   return Response.json(result,{status:request.method==='POST'?201:200});
  }catch(e){return Response.json({code:'23505',message:'Fixture SQL refused the write',details:String(e)},{status:409});}
 };
 const db=createClient('http://127.0.0.1:1','synthetic-no-production-key',{global:{fetch:rest},auth:{persistSession:false,autoRefreshToken:false}});
 try{
  docker(['run','--rm','-d','--name',container,'--network','none','--read-only','--tmpfs','/var/lib/postgresql/data','--tmpfs','/var/run/postgresql','--tmpfs','/tmp','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
  let ready=false;
  for(let n=0;n<60;n++){try{sql('select 1;');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
  assert(ready,'PostgreSQL final TCP listener must be ready, not the temporary init socket');
  sql(`create role anon;create role authenticated;create role service_role;
   create table clients(id uuid primary key,status text not null,zone_id uuid);
   create table zones(id uuid primary key);
   create table plans(id uuid primary key);
   create function public.set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;
   create function public.current_user_role() returns text language sql as $$select 'ADMIN'::text$$;
   create function public.assign_provisioning_nap(uuid,uuid,uuid) returns uuid language sql as $$select $1$$;
   create table service_contracts(id uuid primary key,client_id uuid references clients,status text,zone_id uuid,monthly_fee numeric,created_at timestamptz default now());
   create table inventory_units(id uuid primary key,serial_number text,status text,client_id uuid references clients,contract_id uuid references service_contracts);`);
  sql(`create table fo_nap_puertos(client_id uuid,infra_elemento_id uuid);
   create table descuentos_compensacion_lotes(id uuid primary key default gen_random_uuid(),criterio text,criterio_id uuid,motivo text,monto numeric,porcentaje numeric,clientes_afectados int);
   create table descuentos_compensacion(id uuid primary key default gen_random_uuid(),client_id uuid,contract_id uuid,monto numeric,motivo text,lote_id uuid);`);
  sql(file('../../supabase/migrations/20260910140000_fase4_olt.sql'));
  sql(`alter table olt_onts add contract_id uuid references service_contracts,add admin_state text default 'enable',add tcont_profile text,add traffic_profile text,add zone_id uuid references zones;
   create table olt_alert_log(id uuid primary key,olt_ont_id uuid references olt_onts on delete set null,kind text);
   create table olt_provisioning_operations(id uuid primary key,ont_db_id uuid references olt_onts on delete set null,status text);
   create table client_update_audit(id bigserial);
   create function fixture_client_audit() returns trigger language plpgsql as $$begin insert into client_update_audit default values;return new;end$$;
   create trigger fixture_client_audit after update on clients for each row execute function fixture_client_audit();
   insert into clients values('${jc}','active',null),('${ec}','active',null);
   insert into service_contracts(id,client_id,status) values('${jcontract}','${jc}','active'),('${econtract}','${ec}','active');
   insert into inventory_units values('${unit}','48575443E5C94DB6','assigned','${ec}','${econtract}');
   insert into olt_devices(id,name,host,username,password) values('${device}','Synthetic OLT','127.0.0.1','none','none');`);
  sql(file('../../supabase/migrations/20261002020000_fase68_activa_cliente_al_vincular_ont.sql'));
  sql(originalFunction('../../supabase/migrations/20260930040000_fase37_servicios_independientes.sql','crear_descuento_compensacion_masivo'));
  sql(originalFunction('../../supabase/migrations/20261013160000_fase158_assign_contract_nap_sync_ont_zone.sql','assign_contract_nap_sync_ont_zone'));
  sql('revoke all on function assign_contract_nap_sync_ont_zone(uuid,uuid,uuid) from public;grant execute on function assign_contract_nap_sync_ont_zone(uuid,uuid,uuid) to authenticated,service_role;');
  const readerGrants=()=>sql("select json_agg(r order by proname) from (select proname,proacl::text,prosecdef,proconfig,proowner from pg_proc where proname in ('crear_descuento_compensacion_masivo','assign_contract_nap_sync_ont_zone'))r;");
  const grantsBefore=readerGrants();
  // Expansion keeps the old position constraint while the application is upgraded.
  sql(expand);reset();
  await t.test('SQL reader replacement preserves grants, owner, security definer and search path',()=>assert.equal(readerGrants(),grantsBefore));
  await t.test('expand is additive and old active position remains unique',()=>{
   assert.equal(row(old).retired_at,null);sql(`update olt_onts set retired_at=now() where id='${old}'`);
   assert.throws(()=>sql(`insert into olt_onts(olt_device_id,serial,slot,port,ont_id) values('${device}','OTHER',2,8,3)`));
  });
  reset();assert.throws(()=>sql(contract));sql("set smartrayco.olt_retirement_application_ready='v1';\n"+contract);
  await t.test('retirement/reuse creates a separate UUID; Janet, relations, alerts, operations and clients stay byte-identical',()=>{
   const before=beforeProtected(),historical=row(old);apply();
   assert(row(old).retired_at);assert.equal(row(replacement).serial,'HWTCE5C94DB6');
   const after=row(old);delete after.retired_at;delete after.updated_at;delete historical.retired_at;delete historical.updated_at;assert.deepEqual(after,historical);
   assert.equal(beforeProtected(),before);assert.equal(row(replacement).client_id,ec);assert.equal(row(replacement).rx_power,null);
   assert.equal(sql(`select count(*) from olt_onts where retired_at is null and ont_id=3`),'1');
  });
  await t.test('same position and normalized serial duplicates are rejected',()=>{
   assert.throws(()=>sql(`insert into olt_onts(olt_device_id,serial,slot,port,ont_id) values('${device}','OTHER',2,8,3)`));
   assert.throws(()=>sql(`insert into olt_onts(olt_device_id,serial,slot,port,ont_id) values('${device}',' hwtce5c94db6 ',2,8,4)`));
   assert.throws(apply);assert.equal(sql(`select count(*) from olt_onts`),'3');
  });
  await t.test('history rejects metadata/telemetry rewrites, deletion, cascade and unsafe restoration',()=>{
   for(const change of ["serial='STOLEN'","rx_power=-10","description='Changed'"]){assert.throws(()=>sql(`update olt_onts set ${change} where id='${old}'`));}
   assert.throws(()=>sql(`delete from olt_onts where id='${old}'`));
   assert.throws(()=>sql(`delete from olt_devices where id='${device}'`));
   assert.throws(()=>sql(`update olt_onts set retired_at=null where id='${old}'`));
  });
  await t.test('real import classifier skips historical rows and retains the replacement',async()=>{
   const all=JSON.parse(sql('select json_agg(o) from olt_onts o'));
   const positions=all.map((r:any)=>({frame:r.frame,slot:r.slot,port:r.port,ontId:r.ont_id,serial:r.serial,clientId:r.client_id,retiredAt:r.retired_at}));
   const result=classifyImportCandidates([candidate],positions);assert.equal(result.conflicts.length,0);assert.equal(result.keepDescription.length,1);
   const withoutReplacement=positions.filter((p:any)=>p.serial!=='HWTCE5C94DB6');assert.equal(classifyImportCandidates([candidate],withoutReplacement).fullRefresh.length,1);
   const patch=await db.from('olt_onts').update({vlan:200}).eq('id',old).is('retired_at',null).select();assert(!patch.error);assert.deepEqual(patch.data,[]);
  });
  await t.test('actual provisioning store updates active identity, rejects conflict and never updates retired UUID',async()=>{
   const store=createSupabaseProvisioningStore(db);const saved=await store.upsertOnt(input);assert.equal(saved.error,null);assert.equal(saved.data?.id,replacement);
   const wrong=await store.upsertOnt({...input,serial:'WRONG'});assert(wrong.error);assert.equal((await store.getOntById(old)).data,null);
   assert.equal(row(old).serial,'MSTC8CCE647E');
  });
  await t.test('stale telemetry write is rejected atomically after retirement',async()=>{
   const before=row(old);await assert.rejects(persistOntMeasurement(before,{status:'offline',last_synced_at:new Date().toISOString()},db));assert.deepEqual(row(old),before);
  });
  await t.test('cached live signal cannot leak onto retired history in backend or frontend',()=>{
   const retired=row(old),active={...retired,retired_at:null};const at=Date.now();
   const evidence:OntEvidence={oltDeviceId:device,serial:active.serial,position:'1/2/8:3',outcome:'valid',status:'online',checkedAt:new Date(at).toISOString(),stateReadAt:new Date(at).toISOString(),validUntil:new Date(at+60000).toISOString(),signalReadAt:new Date(at).toISOString(),observedSerial:active.serial,rxPower:-20,txPower:2,signalOutcome:'valid'};
   const cache=new OntTelemetryEvidence();cache.remember(active,evidence);cache.rememberSignal(active,evidence);
   assert.equal(cache.project(retired).status,'unknown');assert.equal(cache.project(retired).rx_power,null);assert.equal(cache.project(retired).telemetry.outcome,'retired');assert.equal(cache.signalReference(retired),null);
   const frontend=enforceOntEvidence({...retired,status:'online' as const,rx_power:-20,tx_power:2,telemetry:evidence as any});assert.equal(frontend.status,'unknown');assert.equal(frontend.rx_power,null);
   const scan:TelemetryScan={before:new Map(),after:new Map(),states:[],rx:new Map(),tx:new Map(),failedPorts:[],signalRequested:false,checkedAt:new Date(at).toISOString(),stateReadAt:null,signalReadAt:new Map()};assert.equal(evaluateOntEvidence(retired,scan).outcome,'retired');
  });
  await t.test('retired linked history does not count as an active NAP/zone binding or outage compensation recipient',()=>{
   // The application must keep these ONT references as history without changing the client/contract rows.
   sql(`insert into olt_onts(olt_device_id,serial,slot,port,ont_id,client_id,contract_id,retired_at)
    values('${device}','HISTORY-LINKED',2,8,99,'${ec}','${econtract}',now());`);
   const before=row(replacement);
   const nap=JSON.parse(sql(`select row_to_json(r) from assign_contract_nap_sync_ont_zone('00000000-0000-4000-8000-000000000008','${econtract}','${ec}') r`));
   assert.equal(nap.ont_zone_synced,true);assert.equal(nap.ont_zone_skip_reason,null);assert.deepEqual(row(replacement),before);
   const result=JSON.parse(sql(`select row_to_json(r) from crear_descuento_compensacion_masivo('olt','${device}','synthetic test',1,null) r`));
   assert.equal(result.clientes_afectados,2);assert.equal(sql(`select count(*) from descuentos_compensacion where contract_id='${econtract}'`),'1');
   // Restore the two-row target fixture for HTTP/lifecycle tests without deleting historical rows through app code.
   reset();apply();
  });
  await t.test('retired identity is refused before direct optical transport',async()=>{
   await assert.rejects(readVerifiedOntSignal({id:device} as any,row(old)),/retirada/);
  });
  await t.test('real HTTP routes expose history separately and reject retired actions before transport',async()=>{
   const {publicKey,privateKey}=await generateKeyPair('ES256');const jwk=await exportJWK(publicKey);jwk.kid='fixture';
   const authServer=createServer((req,res)=>{assert.equal(req.url,'/auth/v1/.well-known/jwks.json');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({keys:[{...jwk,alg:'ES256',use:'sig'}]}));});
   await new Promise<void>(resolve=>authServer.listen(0,'127.0.0.1',resolve));
   const port=(authServer.address() as {port:number}).port;const url=`http://127.0.0.1:${port}`;
   const realFetch=globalThis.fetch,priorUrl=process.env.VITE_SUPABASE_URL,priorKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
   process.env.VITE_SUPABASE_URL=url;process.env.SUPABASE_SERVICE_ROLE_KEY='fixture';globalThis.fetch=rest;
   try{
    const token=await new SignJWT({role:'authenticated'}).setProtectedHeader({alg:'ES256',kid:'fixture'}).setSubject('00000000-0000-4000-8000-000000000099').setIssuer(url+'/auth/v1').setAudience('authenticated').setExpirationTime('5m').sign(privateKey);
    const {oltRoutes}=await import('../src/routes/olt');
    const request=(path:string,method='GET')=>oltRoutes.request(path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(method==='POST'||method==='PUT'?{body:'{}'}:{})});
    const history=await request(`/${device}/onts/retired`);assert.equal(history.status,200);const h=await history.json() as any[];assert.equal(h.length,1);assert.equal(h[0].id,old);assert.equal(h[0].status,'unknown');
    const list=await request(`/${device}/onts`);assert.equal(list.status,200);assert(!(await list.json() as any[]).some(o=>o.id===old));
    const search=await request('/onts/search?serial=MSTC');assert.deepEqual(await search.json(),[]);
    for(const [suffix,method] of [['activate','POST'],['deactivate','POST'],['plan','PUT'],['wan-pppoe','POST'],['meta','PUT'],['signal','GET'],['running-config','GET'],['tr069','POST'],['tr069','DELETE'],['','DELETE']]){
     const response=await request(`/${device}/onts/${old}${suffix?'/'+suffix:''}`,method);assert.equal(response.status,404,method+' '+suffix);
    }
   }finally{globalThis.fetch=realFetch;process.env.VITE_SUPABASE_URL=priorUrl;process.env.SUPABASE_SERVICE_ROLE_KEY=priorKey;await new Promise<void>(resolve=>authServer.close(()=>resolve()));}
  });
  await t.test('data rollback preserves both UUIDs/history and all protected rows, no unlink/delete',()=>{
   const before=beforeProtected();undo();assert(row(replacement).retired_at);assert.equal(row(replacement).client_id,ec);assert(row(old).retired_at);assert.equal(beforeProtected(),before);
   assert.equal(sql(`select count(*) from olt_onts`),'3');
  });
  await t.test('rollback refuses changed replacement links atomically',()=>{
   reset();apply();sql(`update olt_onts set contract_id=null where id='${replacement}'`);
   const snapshot=sql('select json_agg(o order by id) from olt_onts o');assert.throws(undo);assert.equal(sql('select json_agg(o order by id) from olt_onts o'),snapshot);
   reset();apply();undo();
  });
  await t.test('schema downgrade refuses retained history without changing schema or rows',()=>{
   const before=sql('select json_agg(o order by id) from olt_onts o');assert.throws(()=>sql(downContract));assert.throws(()=>sql(downExpand));assert.equal(sql('select json_agg(o order by id) from olt_onts o'),before);
  });
  await t.test('reconciliation fails atomically on changed Janet, prospect client, wrong inventory or missing approval',()=>{
   for(const change of [`update olt_onts set ont_id=51 where id='${janet}'`,`update clients set status='prospect' where id='${ec}'`,`update inventory_units set serial_number='WRONG' where id='${unit}'`]){
    reset();sql(change);const before=beforeProtected();assert.throws(apply);assert.equal(row(old).retired_at,null);assert.equal(beforeProtected(),before);
    sql(`update clients set status='active' where id='${ec}'; update inventory_units set serial_number='48575443E5C94DB6' where id='${unit}'`);
   }
   reset();assert.throws(()=>sql(reconcile));assert.equal(row(old).retired_at,null);
  });
  await t.test('plain insert can reuse retired position; duplicate insert races fail rather than taking an upsert update',async()=>{
   reset();sql(`update olt_onts set retired_at=now() where id='${old}'`);const store=createSupabaseProvisioningStore(db);
   const first=await store.upsertOnt(input);assert.equal(first.error,null);assert.notEqual(first.data?.id,old);
   const duplicate=await db.from('olt_onts').insert({...input,status:'unknown'}).select();assert(duplicate.error);assert.equal(row(old).serial,'MSTC8CCE647E');
  });
  await t.test('failure after retirement but before replacement INSERT rolls back the entire candidate transaction',()=>{
   reset();
   sql(`create function fixture_reject_replacement() returns trigger language plpgsql as $$begin if new.serial='HWTCE5C94DB6' then raise exception 'Synthetic insert failure';end if;return new;end$$;
    create trigger fixture_reject_replacement before insert on olt_onts for each row execute function fixture_reject_replacement();`);
   const before=beforeProtected();assert.throws(apply);assert.equal(row(old).retired_at,null);assert.equal(beforeProtected(),before);assert.equal(sql('select count(*) from olt_onts'),'2');
   sql('drop trigger fixture_reject_replacement on olt_onts;drop function fixture_reject_replacement();');
  });
  await t.test('expansion + contract are fully reversible before data retirement/reuse; original constraint restored',()=>{
   reset();sql(downContract);sql(downExpand);assert.equal(sql(`select count(*) from information_schema.columns where table_name='olt_onts' and column_name='retired_at'`),'0');
   assert.equal(sql(`select count(*) from pg_constraint where conname='olt_onts_olt_device_id_frame_slot_port_ont_id_key'`),'1');
  });
  await t.test('preexisting normalized serial duplicates block contract migration without dropping original uniqueness or repairing data',()=>{
   sql(`insert into olt_onts(olt_device_id,serial,slot,port,ont_id) values('${device}',' hwtcdeb847b6 ',2,8,4)`);sql(expand);
   assert.throws(()=>sql("set smartrayco.olt_retirement_application_ready='v1';\n"+contract));
   assert.equal(sql(`select count(*) from pg_constraint where conname='olt_onts_olt_device_id_frame_slot_port_ont_id_key'`),'1');
   assert.equal(sql('select count(*) from olt_onts'),'3');assert.equal(sql("select to_regclass('public.olt_onts_active_position_key') is null"),'t');
  });
 }finally{docker(['stop','--time','2',container]);}
});
