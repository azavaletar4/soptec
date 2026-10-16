// Validación nueva de integración; PostgreSQL sin red ni datos operativos.
const {execFileSync,execFile}=require('node:child_process');
const {readFileSync,writeFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const read=p=>readFileSync(p,'utf8');
const capture=JSON.parse(read('docs/FASE162-PREPARACION-CLOUD.json'));
const helpers=JSON.parse(read('docs/FASE162-PREPARACION-HELPERS-CLOUD.json'));
assert.equal(capture.read_only,'on');assert(capture.preflight.every(c=>c.resultado==='OK'||c.resultado==='COMPATIBILIDAD ESTRUCTURAL OK'));
const migrations=['supabase/migrations/20261015180000_fase162_inventario_rutinas.sql','supabase/migrations/20261016020000_fase162_autorizacion_recibos.sql'];
const strip=s=>s.replace(/^begin;\r?\n/m,'').replace(/^commit;\s*$/m,'');
const bundle="BEGIN;\nSET LOCAL lock_timeout='2s';\nSET LOCAL statement_timeout='60s';\n"+migrations.map(p=>strip(read(p))).join('\n')+'\nCOMMIT;\n';
writeFileSync('scripts/inventory-auth-lab/runtime/fase162-installation-bundle.sql',bundle);
const normalized=s=>s.replaceAll('\r','').replace(/--[^\n]*/g,'').replace(/\s/g,'');
const patch=read(migrations[1]);const body=patch.match(/create or replace function public\.routine_inventory_operation[\s\S]*?as \$\$([\s\S]*?)\$\$;/)[1];
const hash=createHash('md5').update(normalized(body)).digest('hex');
const post=read('scripts/tests/fase162-cloud-postcheck.sql').replace('e453cb545001f13fb373d2a1569725c7',hash);
writeFileSync('scripts/tests/fase162-installation-postcheck.sql',post);
const report={at:new Date().toISOString(),environment:'ISOLATED_PG_NO_NETWORK_SYNTHETIC',cloudCaptureAt:capture.at,status:'IN_PROGRESS',results:[],artifacts:migrations.map(p=>({path:p,sha256:createHash('sha256').update(readFileSync(p)).digest('hex')})),bundleSha256:createHash('sha256').update(bundle).digest('hex'),correctedRpcHash:hash};
const bundleOnly=process.argv.includes('--bundle-only');
const save=()=>writeFileSync(bundleOnly?'docs/FASE162-DEADLOCK-INSTALACION-ENSAYO.json':'docs/FASE162-DEADLOCK-CORRECCION-ENSAYO.json',JSON.stringify(report,null,2)+'\n');
const pass=(test,detail)=>{report.results.push({test,status:'PASS',detail});console.log('PASS '+test);save();};
const name='smartrayco-fase162-installation-'+process.pid+'-'+Date.now();
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
const args=['exec','-i',name,'psql','-h','127.0.0.1','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','postgres'];
const sql=s=>docker(args,s).trim();
const asyncSql=s=>new Promise(resolve=>{const start=Date.now();const p=execFile('docker',args,{encoding:'utf8',windowsHide:true},(error,out,err)=>resolve({code:error?.code??0,out,err,sqlstate:err.match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1]??null,ms:Date.now()-start}));p.stdin.end(s);});
const tech='00000000-0000-0000-0000-000000000003',admin='00000000-0000-0000-0000-000000000002';
const routine='16200000-0000-4000-8000-000000000001',op='16200000-0000-4000-8000-000000000002';
const material='50000000-0000-0000-0000-000000000002';
const call=`SELECT routine_inventory_operation('${routine}','${op}','consume','{"product_id":"${material}","quantity":1}'::jsonb);`;
const actor=(who,s)=>`SET ROLE authenticated; SET request.jwt.claim.sub='${who}'; ${s}`;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{try{
 docker(['run','--rm','-d','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
 for(let n=0;n<80;n++){try{sql('select 1');break;}catch{if(n===79)throw Error('PostgreSQL local no disponible');await wait(100);}}
 sql(read('server/tests/closedOrdersSchema.sql'));
 // Completa columnas usadas por las definiciones reales. No es un dump Cloud.
 for(const type of capture.types){if(sql(`select to_regtype('public.${type.name}') is null`)==='t')sql(`create type public.${type.name} as enum (${type.values.map(v=>"'"+v.replaceAll("'","''")+"'").join(',')})`);}
 for(const table of capture.tables){
  sql(`create table if not exists public.${table.name}();`+table.columns.map(col=>`alter table public.${table.name} add column if not exists "${col.name}" ${col.type};`).join('\n'));
 }
 const allFunctions=[...capture.functions,...helpers.functions];
 for(const f of allFunctions)sql(f.definition);
 sql(`grant usage on schema auth to authenticated,anon,service_role;grant all on all tables in schema public to authenticated,anon,service_role;`);
 for(const t of capture.tables){
  if(t.rls)sql(`alter table public.${t.name} enable row level security`);
  if(t.force)sql(`alter table public.${t.name} force row level security`);
 }
 for(const p of capture.policies)sql(`create policy "${p.policyname}" on public.${p.tablename} as ${p.permissive} for ${p.cmd} to ${p.roles.map(r=>'"'+r+'"').join(',')}${p.qual?' using ('+p.qual+')':''}${p.with_check?' with check ('+p.with_check+')':''}`);
 // Datos ficticios anteriores a Fase 162; ocho casos ambiguos no modificables.
 sql(`update inventory_products set current_stock=100;
 insert into routines(id,status,routine_number,assigned_to) values('${routine}','in_progress','LAB-162','${tech}');
 insert into job_assignees(job_type,job_id,technician_id,role) values('routine','${routine}','${tech}','leader');
 insert into service_contracts(id,client_id) values('16200000-0000-4000-8000-000000000010','30000000-0000-0000-0000-000000000001');
 insert into installations(id,status) values('16200000-0000-4000-8000-000000000011','completed');
 insert into inventory_units(id,product_id,serial_number,status,client_id,installation_id)
 select ('16200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'50000000-0000-0000-0000-000000000001','HISTORICO-FICTICIO-'||n,'assigned','30000000-0000-0000-0000-000000000001',case when n<23 then '16200000-0000-4000-8000-000000000011'::uuid else null end from generate_series(21,28)n;`);
 for(const t of capture.tables)for(const tr of t.triggers??[]){sql(tr.definition);if(tr.enabled!=='O')sql(`alter table public.${t.name} ${tr.enabled==='D'?'disable':tr.enabled==='A'?'enable always':'enable replica'} trigger "${tr.name}"`);}
 const protectedTables=['profiles','routines','job_assignees','clients','service_contracts','installations','inventory_products','inventory_units','inventory_movements','inventory_unit_events'];
 const snapshot=()=>sql(`select jsonb_object_agg(name,rows) from (${protectedTables.map(t=>`select '${t}' name,coalesce(jsonb_agg(to_jsonb(x)-'routine_id'-'operation_id' order by id),'[]'::jsonb) rows from public.${t} x`).map(s=>s.includes('public.job_assignees')?s.replace('order by id','order by job_id,technician_id'):s).join(' union all ')})z`);
 const policySnapshot=()=>sql("select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public'");
 const policies=policySnapshot();
 if(bundleOnly){
  const before=snapshot();sql(bundle);assert.equal(snapshot(),before);assert.equal(policySnapshot(),policies);assert.equal(sql('select count(*) from routine_inventory_operations'),'0');
  const checks=sql('BEGIN READ ONLY;'+post+'ROLLBACK;');assert(!checks.includes('|BLOQUEADO|'),checks);
  pass('Instalación conjunta actualizada','Dos migraciones en una transacción: integridad de diez tablas y ocho históricos ficticios, políticas intactas y cero recibos.');
  pass('Postchecks de instalación','Huella NOWAIT, ACL, helpers, dispatcher, índices y FK aprobados.');report.status='PASS';save();return;
 }
 const previousPatch=execFileSync('git',['show','7e6abd5:'+migrations[1]],{encoding:'utf8',windowsHide:true});
 const before=snapshot();
 sql('BEGIN;'+strip(read(migrations[0]))+strip(previousPatch)+'COMMIT;');
 assert.equal(snapshot(),before);assert.equal(policySnapshot(),policies);
 const originalReceipt=sql(actor(tech,call));
 const state=()=>sql(`select jsonb_build_object('stock',(select current_stock from inventory_products where id='${material}'),'movements',(select count(*) from inventory_movements),'receipts',(select count(*) from routine_inventory_operations),'events',(select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from inventory_unit_events x),'units',(select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from inventory_units x),'receipt_rows',(select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from routine_inventory_operations x))`);
 const restore=()=>sql(`insert into job_assignees(job_type,job_id,technician_id,role) values('routine','${routine}','${tech}','leader') on conflict do nothing;`);
 const removal=`delete from job_assignees where job_type='routine' and job_id='${routine}' and technician_id='${tech}';`;
 const bounded=s=>`SET deadlock_timeout='100ms';SET statement_timeout='6s';${s}`;
 async function until(expression){for(let n=0;n<60;n++){if(sql(expression)==='1')return;await wait(20);}throw Error('No se observó barrera de concurrencia');}
 async function race(statement,label){
  const a=asyncSql(bounded(`SET application_name='fase162-a';BEGIN;${actor(tech,`select id from routines where id='${routine}' for update;select pg_sleep(1.5);${statement}`)}COMMIT;`));
  await until("select count(*) from pg_stat_activity where application_name='fase162-a' and wait_event='PgSleep'");
  const b=asyncSql(bounded(`SET application_name='fase162-b';BEGIN;${actor(admin,removal)}COMMIT;`));
  await until("select count(*) from pg_stat_activity where application_name='fase162-b' and wait_event_type='Lock'");
  const results=await Promise.all([a,b]);
  report.concurrency??=[];report.concurrency.push({case:label,sessions:results.map(r=>({exit:r.code,sqlstate:r.sqlstate,ms:r.ms}))});save();return results;
 }
 const baseline=state();
 const old=await race(call,'baseline 7e6abd5');assert(old.some(r=>r.sqlstate==='40P01'),'No se reprodujo deadlock previo');assert.equal(state(),baseline);
 pass('Deadlock anterior reproducido','7e6abd5 frente al DELETE y trigger real: SQLSTATE 40P01; inventario intacto.');
 restore();
 // La guarda de la segunda migración exige la RPC original, igual que instalar
 // desde cero en Cloud. Restaurar solo la RPC base en este contenedor ficticio.
 sql(read(migrations[0]).match(/create function public\.routine_inventory_operation[\s\S]*?end \$\$;/)[0].replace('create function','create or replace function'));
 const candidateBefore=snapshot(),inventoryBefore=state();
 const functions=()=>sql("select jsonb_agg(jsonb_build_object('name',oid::regprocedure::text,'body',prosrc,'acl',proacl,'settings',proconfig) order by oid) from pg_proc where pronamespace='public'::regnamespace and proname<>'routine_inventory_operation'");
 const otherFunctions=functions();sql(read(migrations[1]));
 assert.equal(snapshot(),candidateBefore);assert.equal(state(),inventoryBefore);assert.equal(functions(),otherFunctions);assert.equal(policySnapshot(),policies);
 const checks=sql('BEGIN READ ONLY;'+post+'ROLLBACK;');assert(!checks.includes('|BLOQUEADO|'),checks);
 pass('Parche y postcheck conjunto','Solo RPC; diez tablas y ocho históricos ficticios intactos; políticas y otras funciones/ACL sin cambios; postchecks aprobados.');
 const fixed=await race(call,'recibo con NOWAIT');assert.equal(fixed[0].sqlstate,'55P03');assert.equal(fixed[1].code,0);assert.equal(state(),inventoryBefore);
 pass('Carrera de recibo corregida','55P03 acotado revierte A sin recibos ni movimientos nuevos; retirada B confirma sin deadlock.');
 async function denied(statement){const prior=state(),r=await asyncSql(bounded(actor(tech,statement)));assert.equal(r.sqlstate,'P0001',r.err);assert(!r.out.includes('movement_or_event_id'));assert.equal(state(),prior);}
 const fresh=call.replaceAll(op,'16200000-0000-4000-8000-000000000003');
 await denied(call);await denied(fresh);
 pass('Tras retirada confirmada','Antiguo recibo y movimiento nuevo denegados, sin datos protegidos ni variación de stock.');
 restore();const freshRace=await race(fresh,'movimiento nuevo con NOWAIT');assert.equal(freshRace[0].sqlstate,'55P03');assert.equal(freshRace[1].code,0);assert.equal(state(),inventoryBefore);await denied(fresh);
 pass('Movimiento en carrera no se confirma','55P03 sin crear recibo; reintento tras revocación denegado, stock intacto.');
 restore();
 const leaderNew=fresh.replaceAll('000000000003','000000000004');
 const concurrent=await Promise.all([asyncSql(bounded(actor(tech,leaderNew))),asyncSql(bounded(actor(tech,leaderNew)))]);
 assert(concurrent.every(r=>r.code===0),JSON.stringify(concurrent));assert.equal(concurrent[0].out,concurrent[1].out);assert.equal(sql(actor(tech,leaderNew)),concurrent[0].out.trim());
 let s=JSON.parse(state());assert.equal(s.stock,98);assert.equal(s.movements,2);assert.equal(s.receipts,2);assert.equal(sql(actor(tech,call)),originalReceipt);
 pass('Reintento legítimo y concurrencia','Dos envíos reales del mismo UUID y repetición tras respuesta descartada: un movimiento adicional, stock 98.');
 // La asignación autorizada permanece protegida hasta COMMIT por FOR SHARE.
 const held=asyncSql(bounded(`SET application_name='fase162-held';BEGIN;${actor(tech,leaderNew)}select pg_sleep(1.5);COMMIT;`));
 await until("select count(*) from pg_stat_activity where application_name='fase162-held' and wait_event='PgSleep'");
 const waiting=asyncSql(bounded(`SET application_name='fase162-delete';BEGIN;${actor(admin,removal)}COMMIT;`));
 await until("select count(*) from pg_stat_activity where application_name='fase162-delete' and wait_event_type='Lock'");
 const heldResults=await Promise.all([held,waiting]);assert(heldResults.every(r=>r.code===0),JSON.stringify(heldResults));assert.equal(JSON.parse(state()).stock,98);await denied(leaderNew);
 pass('Autorización anterior a retirada','DELETE espera COMMIT autorizado; después confirma y el recibo ya se deniega, sin cambio de saldo.');
 restore();const deletion=asyncSql(bounded(`SET application_name='fase162-delete-first';BEGIN;${actor(admin,removal)}select pg_sleep(1.5);COMMIT;`));
 await until("select count(*) from pg_stat_activity where application_name='fase162-delete-first' and wait_event='PgSleep'");
 const afterDelete=asyncSql(bounded(actor(tech,fresh)));const ordered=await Promise.all([deletion,afterDelete]);assert.equal(ordered[0].code,0);assert.equal(ordered[1].sqlstate,'P0001');assert.equal(JSON.parse(state()).stock,98);
 pass('Retirada anterior a inventario','La RPC espera al padre y después deniega asignación ausente, sin movimiento posterior.');
 const support='00000000-0000-0000-0000-000000000005';
 sql(`insert into profiles(id,role,active) values('${support}','TECNICO_RED',true);insert into job_assignees(job_type,job_id,technician_id,role) values('routine','${routine}','${support}','support');`);
 const supportCall=fresh.replaceAll('000000000003','000000000005');const supportResult=sql(actor(support,supportCall));assert.equal(sql(actor(support,supportCall)),supportResult);
 s=JSON.parse(state());assert.equal(s.stock,97);assert.equal(s.movements,3);assert.equal(s.receipts,3);
 assert.equal(Number(sql(`select 100-coalesce(sum(case when movement_type='egreso' then quantity else -quantity end),0) from inventory_movements where product_id='${material}'`)),s.stock);
 assert.equal(s.units,JSON.parse(inventoryBefore).units);assert.equal(s.events,JSON.parse(inventoryBefore).events);assert.equal(functions(),otherFunctions);assert.equal(policySnapshot(),policies);
 report.final={stock:97,kardex:97,movements:3,receipts:3,unitsAndEventsUnchanged:true,otherFunctionsAndPoliciesUnchanged:true};
 pass('Apoyo e integridad final','Apoyo autorizado y recibo estable; tres consumos/recibos, stock=Kardex=97, unidades/eventos intactos.');
 report.status='PASS';save();
}catch(error){report.status='BLOCKED';report.error=error.message;save();console.error('BLOQUEADO '+error.message);process.exitCode=1;}
finally{try{docker(['stop',name]);}catch{}}})();
