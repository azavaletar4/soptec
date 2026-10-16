import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {root,runtime,project,gateway,config,docker,wait} from './common.mjs';
import {searchInventory} from '../../src/lib/inventorySearch.ts';
const lab=JSON.parse(readFileSync(runtime+'security-prepared.json','utf8'));
if(lab.database!=='inventory_security_lab'||lab.url!=='http://127.0.0.1:54390')throw Error('Destino no local');
const f=JSON.parse(readFileSync(runtime+'security-fixture.json','utf8')),c=config();
const local=s=>docker(['exec','-i',project+'-db','psql','-U','postgres','-d',lab.database,'-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],s).trim();
const file=runtime+'security-validation.json';
const report=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{at:new Date().toISOString(),status:'IN_PROGRESS',results:[]};
const save=()=>writeFileSync(file,JSON.stringify(report,null,2));
const test=async(name,run)=>{if(report.results.some(r=>r.name===name)){console.log('REUSED '+name);return}await run();report.results.push({name,status:'PASS'});save();console.log('PASS '+name)};
const tokens={},clients={};
// GoTrue en este laboratorio se expone sin el prefijo /auth/v1 (Caddy no lo
// reescribe); supabase-js siempre antepone /auth/v1 y por eso signInWithPassword
// fallaba. Se pide el JWT real por la ruta real del propio GoTrue (/token),
// igual de real que antes — solo cambia cómo se obtiene, no su autenticidad.
for(const account of JSON.parse(readFileSync(runtime+'security-accounts.json','utf8'))){
 const tokenResponse=await fetch(gateway+'/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json','apikey':c.anonKey},body:JSON.stringify({email:account.email,password:account.password})});
 const body=await tokenResponse.json();
 if(!tokenResponse.ok||!body.access_token)throw Error('JWT real no disponible '+account.role+': '+JSON.stringify(body));
 const jwt=body.access_token,claims=JSON.parse(Buffer.from(jwt.split('.')[1],'base64url').toString());
 assert.equal(claims.role,'authenticated');assert.equal(claims.sub,account.id);
 tokens[account.role]=jwt;
 clients[account.role]=createClient(lab.url,c.anonKey,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:'Bearer '+jwt},fetch:(input,init)=>{const url=new URL(String(input));assert.equal(url.origin,lab.url);url.pathname=url.pathname.replace(/^\/rest\/v1/,'');return fetch(url,init)}}});
}
const rpc=async(role,name,payload)=>{const response=await fetch(lab.url+'/rpc/'+name,{method:'POST',headers:{Authorization:'Bearer '+tokens[role],'Content-Type':'application/json'},body:JSON.stringify(payload)});return {status:response.status,data:await response.json()}};
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data};
const deny=r=>{assert(r.status>=400,JSON.stringify(r));assert(!r.data.context&&!r.data.items&&!r.data.operationId)};
const read=(role,jobType,jobId,view,extra={})=>rpc(role,'inventory_order_read',{p_job_type:jobType,p_job_id:jobId,p_view:view,...extra});
const id=n=>`96600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const consume=(op,quantity)=>({p_operation_id:id(op),p_job_type:'ticket',p_job_id:f.ticket,p_action:'consume',p_payload:{productId:f.material,quantity}});
const stock=()=>Number(local(`select current_stock from inventory_products where id='${f.material}'`));
try{
 await test('Fixture faithful search relationships and bounded volume',()=>{
  local(`do $$ begin
    if not exists(select 1 from pg_constraint where conname='inventory_units_contract_id_fkey') then
     alter table inventory_units add constraint inventory_units_contract_id_fkey foreign key(contract_id) references service_contracts(id);
    end if;
   end $$;
   alter table inventory_units add column if not exists notes text;
   insert into inventory_products(id,name,category_id,category,price,unit)
   select ('96600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'PAG-SEC Modelo '||n,'${f.category}','Marca SAFE',987.65,'metro' from generate_series(1000,1104)n
   on conflict (id) do nothing;`);
 });
 local("notify pgrst,'reload schema'");
 await wait(async()=>{
  const response=await clients.ADMIN.from('inventory_units').select('id,contract:service_contracts!inventory_units_contract_id_fkey(id)').limit(0);
  return !response.error;
 });
 for(const role of ['ADMIN','SUPERADMIN']){
  await test(role+' direct administrative tables and albums',async()=>{
   for(const table of ['inventory_products','inventory_categories','inventory_units','inventory_movements','inventory_unit_events']){
    const r=await clients[role].from(table).select('id').limit(1);assert.ifError(r.error);assert(r.data.length>0,table);
   }
   const albums=ok(await rpc(role,'inventory_get_albums',{}));assert(albums.some(a=>a.album_slug==='security-lab'));
  });
  await test(role+' real search name/model serial MAC and album pagination',async()=>{
   for(const q of ['MODELO-SAFE','LAB-SEC-STOCK','SEC-ST','aabbcc112233','AA:BB:CC:11:22:33']){
    const r=await searchInventory(clients[role],q,0,{categoryId:f.category});assert(r.products.length||r.units.length,q);
    if(q!=='MODELO-SAFE')assert(r.units.some(u=>u.id===f.stock),q);
   }
   const a=await searchInventory(clients[role],'PAG-SEC',0,{}),b=await searchInventory(clients[role],'PAG-SEC',1,{categoryId:f.category});
   assert.equal(a.products.length,25);assert.equal(b.products.length,25);assert(a.more&&b.more);assert(!a.products.some(p=>b.products.some(q=>p.id===q.id)));
  });
 }
 for(const role of ['leader','support','outsider','removed','SOPORTE','FACTURACION'])await test(role+' cannot read or search administrative inventory directly',async()=>{
  for(const table of ['inventory_products','inventory_categories','inventory_units','inventory_movements','inventory_unit_events']){
   const r=await clients[role].from(table).select('*',{count:'exact'}).limit(1);assert.ifError(r.error);assert.deepEqual(r.data,[]);assert.equal(r.count,0,table);
  }
  const s=await searchInventory(clients[role],'LAB-SEC',0,{});assert.deepEqual(s.products,[]);assert.deepEqual(s.units,[]);
  deny(await rpc(role,'inventory_get_albums',{}));
 });
 for(const role of ['leader','support','removed'])await test(role+' contextual reads across Altas Averias Rutinas',async()=>{
  for(const [type,job]of [['installation',f.installation],['ticket',f.ticket],['routine',f.routine]]){
   const page=ok(await read(role,type,job,'products'));assert.equal(page.context.actorId,f.users[role]);assert.equal(page.items.length,100);assert.equal(page.next,1);
   const next=ok(await read(role,type,job,'products',{p_page:1}));assert(next.items.length>0);assert(!page.items.some(p=>next.items.some(q=>p.id===q.id)));
   const units=ok(await read(role,type,job,'assigned')).items;assert(!units.some(u=>u.id===f.thirdParty));
   assert(!/"(?:price|balance_after|total_value|notes|document_number)"/.test(JSON.stringify({page,next,units})));
  }
  const available=ok(await read(role,'ticket',f.ticket,'available',{p_product_id:f.model}));assert(available.items.some(u=>u.id===f.stock));assert(!available.items.some(u=>u.id===f.thirdParty));
 });
 await test('Outsider and billing denied contextual RPC',async()=>{
  for(const role of ['outsider','FACTURACION'])for(const [type,job]of [['installation',f.installation],['ticket',f.ticket],['routine',f.routine]])deny(await read(role,type,job,'products'));
 });
 await test('Support office reads only order data, not stock catalog',async()=>{
  ok(await read('SOPORTE','ticket',f.ticket,'materials'));assert(ok(await read('SOPORTE','ticket',f.ticket,'pending')).items.some(u=>u.id===f.pending));
  deny(await read('SOPORTE','ticket',f.ticket,'products'));deny(await read('SOPORTE','installation',f.installation,'materials'));
 });
 await test('Removed technician retains JWT but loses all contextual access',async()=>{
  local(`begin;set local request.jwt.claim.sub='${f.users.ADMIN}';delete from job_assignees where technician_id='${f.users.removed}';commit;`);
  for(const [type,job]of [['installation',f.installation],['ticket',f.ticket],['routine',f.routine]])deny(await read('removed',type,job,'materials'));
 });
 await test('Unauthorized direct event insert rolls back without inventory changes',async()=>{
  const before=local(`select md5(to_jsonb(u)::text) from inventory_units u where id='${f.stock}'`);
  const r=await clients.leader.from('inventory_unit_events').insert({unit_id:f.stock,to_status:'assigned',client_id:f.client,contract_id:f.contract,installation_id:f.installation}).select();assert(r.error);
  assert.equal(local(`select md5(to_jsonb(u)::text) from inventory_units u where id='${f.stock}'`),before);
 });
 await test('Office contextual approval and response-loss retry create one event',async()=>{
  const payload={p_operation_id:id(500),p_job_type:'ticket',p_job_id:f.ticket,p_action:'approve',p_payload:{unitId:f.pending}};
  const a=ok(await rpc('SOPORTE','inventory_ticket_review',payload));const b=ok(await rpc('SOPORTE','inventory_ticket_review',payload));assert.deepEqual(a,b);
  assert.equal(local(`select status from inventory_units where id='${f.pending}'`),'assigned');assert.equal(local(`select count(*) from campo_inventory_operations where id='${id(500)}'`),'1');
  deny(await rpc('outsider','inventory_ticket_review',payload));deny(await rpc('FACTURACION','inventory_ticket_review',payload));
  deny(await rpc('SOPORTE','inventory_ticket_review',{...payload,p_operation_id:id(501),p_payload:{unitId:f.thirdParty}}));
 });
 await test('Campo transactions concurrent authorized technicians under closed RLS',async()=>{
  local(`begin;set local request.jwt.claim.sub='${f.users.ADMIN}';update tickets set status='in_progress' where id='${f.ticket}';commit;`);
  const before=stock();const [a,b]=await Promise.all([rpc('leader','campo_inventory_operation',consume(510,2)),rpc('support','campo_inventory_operation',consume(511,3))]);ok(a);ok(b);assert.equal(stock(),before-5);
  assert.deepEqual(ok(await rpc('leader','campo_inventory_operation',consume(510,2))),a.data);assert.equal(stock(),before-5);
  deny(await rpc('removed','campo_inventory_operation',consume(512,1)));deny(await rpc('outsider','campo_inventory_operation',consume(513,1)));assert.equal(stock(),before-5);
 });
 await test('Correction and reversal retain stock and movements under closed RLS',async()=>{
  const movement=ok(await rpc('leader','campo_inventory_operation',consume(510,2))).ids[0];
  const correction=ok(await rpc('leader','campo_inventory_operation',{...consume(514,1),p_action:'correct',p_payload:{movementId:movement,quantity:1}}));assert.equal(stock(),96);
  const latest=correction.ids.at(-1);ok(await rpc('leader','campo_inventory_operation',{...consume(515,1),p_action:'reverse',p_payload:{movementId:latest}}));assert.equal(stock(),97);
  const materials=ok(await read('leader','ticket',f.ticket,'materials'));assert(materials.items.length>=5);assert(!/balance_after|price/.test(JSON.stringify(materials)));
 });

 await test('Private receipts stay unavailable with real authenticated JWT',async()=>{
  local('revoke all on campo_inventory_operations from public,anon,authenticated,service_role');
  for(const role of ['ADMIN','leader','SOPORTE'])for(const table of ['campo_inventory_operations','routine_inventory_operations']){
   const r=await clients[role].from(table).select('*').limit(1);assert(r.error||r.data.length===0);
  }
 });
 await test('Other contract equipment never appears in the order DTO',async()=>{
  local(`begin;set local request.jwt.claim.sub='${f.users.ADMIN}';insert into inventory_units(id,product_id,serial_number) values('${id(34)}','${f.model}','LAB-OTHER-CONTRACT');insert into inventory_unit_events(unit_id,to_status,client_id,contract_id) values('${id(34)}','assigned','${f.client}','${f.otherContract}');commit;`);
  for(const [type,job]of [['installation',f.installation],['ticket',f.ticket],['routine',f.routine]]){
   const units=ok(await read('leader',type,job,'assigned')).items;assert(!units.some(u=>u.id===id(34)||u.id===f.thirdParty));
  }
  deny(await read('leader','installation',f.installation,'unit-context',{p_unit_id:f.thirdParty,p_action:'unassign'}));
 });
 await test('Inactive administrator loses table, album and contextual access',async()=>{
  local(`update profiles set active=false where id='${f.users.SUPERADMIN}'`);
  try {assert.deepEqual((await clients.SUPERADMIN.from('inventory_products').select('*').limit(1)).data,[]);deny(await rpc('SUPERADMIN','inventory_get_albums',{}));deny(await read('SUPERADMIN','ticket',f.ticket,'products'));}
  finally{local(`update profiles set active=true where id='${f.users.SUPERADMIN}'`)}
 });
 await test('Routine transactional RPC and retry remain compatible with closed inventory RLS',async()=>{
  const before=stock();
  local(`begin;set local request.jwt.claim.sub='${f.users.ADMIN}';delete from job_assignees where job_type='routine' and job_id='${f.routine}';insert into job_assignees(job_type,job_id,technician_id,role) values('routine','${f.routine}','${f.users.outsider}','leader');update routines set status='in_progress' where id='${f.routine}';commit;`);
  const payload={p_routine_id:f.routine,p_operation_id:id(520),p_action:'consume',p_payload:{product_id:f.material,quantity:2}};
  const a=ok(await rpc('outsider','routine_inventory_operation',payload));assert.deepEqual(ok(await rpc('outsider','routine_inventory_operation',payload)),a);assert.equal(stock(),before-2);
  const m=ok(await read('outsider','routine',f.routine,'materials'));assert(m.items.some(x=>x.product_id===f.material));
  deny(await rpc('removed','routine_inventory_operation',{...payload,p_operation_id:id(521)}));
  assert.equal(stock(),before-2);
 });
 report.status='PASS';report.database=lab.database;report.jwtReal=true;report.cloudAccess=false;report.fase162RpcUnchanged=JSON.parse(readFileSync(runtime+'security-applied.json','utf8')).routineRpcUnchanged;save();writeFileSync(root+'docs/INVENTARIO-CIERRE-RLS-LAB.json',JSON.stringify(report,null,2)+'\n');console.log('SECURITY_LAB_PASS '+report.results.length);
}catch(e){report.status='FAILED';report.failure=e.message;save();console.error(e.message);process.exitCode=1}
