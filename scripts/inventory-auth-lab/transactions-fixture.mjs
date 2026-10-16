import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import { randomUUID,randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { config,runtime,sql,gateway } from './common.mjs';
const c=config(),base=JSON.parse(readFileSync(runtime+'manifest.json','utf8'));
if(existsSync(runtime+'transactions.json'))throw Error('Fixture existente: se conserva; no recrear ni borrar datos.');
const f={runId:randomUUID(),material:randomUUID(),model:randomUUID(),client:randomUUID(),jobs:[],units:[]};
for(const [name,type] of [['alta','installation'],['averia','ticket'],['reasignacion','installation'],['cierre','ticket']])f.jobs.push({name,type,id:randomUUID(),contractId:randomUUID(),clientId:f.client});
for(let n=0;n<5;n++)f.units.push({id:randomUUID(),productId:f.model,label:'Equipo transaccional ficticio '+n});
const admin={email:`admin-${f.runId.slice(0,8)}@inventory-lab.example`,password:randomBytes(32).toString('hex')};
const auth=createClient(gateway,c.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
const {data,error}=await auth.auth.signUp(admin);if(error||!data.user)throw Error('No se pudo crear ADMIN ficticio');admin.id=data.user.id;
writeFileSync(runtime+'transactions-admin.json',JSON.stringify(admin));
const before=sql(`select jsonb_build_object('products',(select jsonb_agg(to_jsonb(x)) from inventory_products x),'units',(select jsonb_agg(to_jsonb(x)) from inventory_units x),'movements',(select jsonb_agg(to_jsonb(x)) from inventory_movements x),'events',(select jsonb_agg(to_jsonb(x)) from inventory_unit_events x))`);
writeFileSync(runtime+'transactions-baseline.json',before);
sql(`begin;
 insert into profiles(id,role,active) values('${admin.id}','ADMIN',true);
 insert into clients(id) values('${f.client}');
 insert into inventory_products(id,name,unit,current_stock,is_serialized) values('${f.material}','Material transaccional ficticio','metro',20,false),('${f.model}','Equipo transaccional ficticio','unidad',0,true);
 ${f.jobs.map(j=>`insert into service_contracts(id,client_id,contract_number,zone_id) values('${j.contractId}','${f.client}','TX-${j.name}','${f.client}');insert into ${j.type==='installation'?'installations':'tickets'}(id,status,client_id,contract_id) values('${j.id}','${j.type==='installation'?'scheduled':'open'}','${f.client}','${j.contractId}');insert into job_assignees(job_type,job_id,technician_id,role) values('${j.type}','${j.id}','${base.users.leader}','leader'),('${j.type}','${j.id}','${base.users.support}','support');`).join('\n')}
 ${f.units.map((u,n)=>`insert into inventory_units(id,product_id,serial_number) values('${u.id}','${f.model}','TX-${f.runId}-${n}');`).join('\n')}
 insert into inventory_unit_events(unit_id,to_status,client_id,contract_id,ticket_id) values('${f.units[2].id}','assigned','${f.client}','${f.jobs[1].contractId}','${f.jobs[1].id}');
 commit;`);
// Control concurrente exclusivo del laboratorio: usa UPDATE/RPC reales bajo JWT ADMIN.
sql(`create function public.lab_authorization_hold(p_job_id uuid,p_action text) returns jsonb language plpgsql security invoker as $$
 declare expected jsonb;
 begin
 if auth.uid() is distinct from '${admin.id}'::uuid or public.current_user_role() is distinct from 'ADMIN' then raise exception 'Solo ADMIN ficticio del laboratorio' using errcode='42501';end if;
 if p_job_id='${f.jobs[2].id}'::uuid and p_action='reassign' then
  select jsonb_agg(jsonb_build_object('technician_id',technician_id,'role',role) order by technician_id) into expected from job_assignees where job_type='installation' and job_id=p_job_id;
  perform set_current_job_crew('installation',p_job_id,expected,'[{"technician_id":"${base.users.outsider}","role":"leader"}]'::jsonb);
 elsif p_job_id='${f.jobs[3].id}'::uuid and p_action='close' then
  update tickets set status='closed' where id=p_job_id;
 else raise exception 'Orden de control no autorizada' using errcode='42501';end if;
 perform pg_sleep(1.5);return jsonb_build_object('done',true);
 end;$$;
 revoke all on function lab_authorization_hold(uuid,text) from public,anon;grant execute on function lab_authorization_hold(uuid,text) to authenticated;
 notify pgrst,'reload schema';`);
writeFileSync(runtime+'transactions.json',JSON.stringify(f,null,2));
console.log('TX_FIXTURE_READY: datos anteriores conservados; filas nuevas ficticias y control ADMIN local.');
