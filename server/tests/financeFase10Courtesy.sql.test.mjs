import {test} from 'node:test';import assert from 'node:assert/strict';import {createFinanceLab,read} from './financeLab.mjs';
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const auth=(sql,n=1)=>`set role authenticated;set request.jwt.claim.sub='${id(n)}';${sql}`;
test('Fase 10: cortesia (is_courtesy) nunca cuenta como deuda/mora/corte; monthly_fee=0 nunca se asume cortesia',{timeout:120000},async t=>{
 const lab=await createFinanceLab({phase5:true}),q=lab.q;let cases=0,failed=false;
 const sub=(name,fn)=>t.test(name,async()=>{try{await fn();cases++}catch(e){failed=true;throw e}});
 try{
 q(read('../../supabase/migrations/20261124210000_finance_opening_credit_phase6.sql'));
 q(read('../../supabase/migrations/20261124220000_finance_contract_search_dni_phase7b.sql'));
 q(`do $$ begin create type public.debt_hold_status as enum ('none','pending','suspended'); exception when duplicate_object then null; end $$; alter table service_contracts add column if not exists debt_hold_status public.debt_hold_status not null default 'none';`);
 q(read('../../supabase/migrations/20261125090000_finance_billing_cycle_phase7c.sql'));
 q(`alter table service_contracts add column if not exists billing_day integer not null default 1 check (billing_day between 1 and 31);`);
 q(read('../../supabase/migrations/20261126090000_finance_reuse_legacy_billing_day_phase8.sql'));
 q(read('../../supabase/migrations/20261126110000_finance_collection_summary_phase9.sql'));
 q(`alter table service_contracts add column if not exists is_courtesy boolean not null default false,add column if not exists courtesy_reason text;`);
 q(read('../../supabase/migrations/20261126130000_finance_courtesy_phase10.sql'));
 q(`insert into profiles(id,role,active,full_name) values('${id(1)}','ADMIN',true,'Administradora');insert into zones values('${id(30)}','PON sintética');insert into plans values('${id(99)}','Plan');
  insert into clients(id,first_name,last_name) values('${id(10)}','Cortesia','SinModalidad'),('${id(11)}','Cortesia','ConModalidad'),('${id(12)}','Vencido','Real'),('${id(13)}','Fee','Cero');
  insert into service_contracts(id,client_id,zone_id,contract_number,client_code,plan_id,service_type,monthly_fee,is_courtesy,courtesy_reason) values
   ('${id(20)}','${id(10)}','${id(30)}','CTR-1','CIN-1','${id(99)}','internet_combo',70,true,'Modem de oficina');
  insert into service_contracts(id,client_id,zone_id,contract_number,client_code,plan_id,service_type,monthly_fee,is_courtesy,courtesy_reason,finance_billing_modality,finance_billing_day,finance_grace_days) values
   ('${id(21)}','${id(11)}','${id(30)}','CTR-2','CIN-2','${id(99)}','internet_combo',80,true,'Familiar','adelantado',extract(day from current_date - interval '15 days')::int,7);
  insert into service_contracts(id,client_id,zone_id,contract_number,client_code,plan_id,service_type,monthly_fee,finance_billing_modality,finance_billing_day,finance_grace_days) values
   ('${id(22)}','${id(12)}','${id(30)}','CTR-3','CIN-3','${id(99)}','internet_combo',90,'adelantado',extract(day from current_date - interval '15 days')::int,7);
  insert into service_contracts(id,client_id,zone_id,contract_number,client_code,plan_id,service_type,monthly_fee) values
   ('${id(23)}','${id(13)}','${id(30)}','CTR-4','CIN-4','${id(99)}','internet_combo',0);
  update service_contracts set finance_reconciled_at=now(),finance_start_date=current_date-interval '2 months' where id in('${id(21)}','${id(22)}');
  set role authenticated;set request.jwt.claim.sub='${id(1)}';
  select finance_record_payment('${id(40)}','${id(21)}','{}'::uuid[],1,'cash',null,'ancla de ciclo');
  select finance_record_payment('${id(41)}','${id(22)}','{}'::uuid[],1,'cash',null,'ancla de ciclo');
  reset role;
  update invoice_payments set received_at=((current_date - interval '15 days') - interval '1 month')::date where id in('${id(40)}','${id(41)}');`);
 await sub('cortesia sin modalidad confirmada: bucket=cortesia, nunca sin_configurar',()=>{
  const m=JSON.parse(q(auth(`select finance_pon_matrix('${id(30)}',2026)`)));
  const row=m.rows.find(r=>r.id===id(20));
  assert.equal(row.collection.bucket,'cortesia');
  assert.equal(row.collection.eligibleForSuspension,false);
  assert.equal(row.is_courtesy,true);
  assert.equal(row.courtesy_reason,'Modem de oficina');
 });
 await sub('cortesia CON modalidad confirmada igual gana: bucket=cortesia, nunca vencido/en_prorroga',()=>{
  const m=JSON.parse(q(auth(`select finance_pon_matrix('${id(30)}',2026)`)));
  const row=m.rows.find(r=>r.id===id(21));
  assert.equal(row.collection.bucket,'cortesia');
  assert.equal(row.collection.eligibleForSuspension,false);
 });
 await sub('contrato real vencido (sin cortesia) SI es elegible, no se contagia de las cortesias',()=>{
  const m=JSON.parse(q(auth(`select finance_pon_matrix('${id(30)}',2026)`)));
  const row=m.rows.find(r=>r.id===id(22));
  assert.equal(row.collection.bucket,'vencido_sin_prorroga');
  assert.equal(row.collection.eligibleForSuspension,true);
 });
 await sub('monthly_fee=0 sin is_courtesy NUNCA se asume cortesia',()=>{
  const m=JSON.parse(q(auth(`select finance_pon_matrix('${id(30)}',2026)`)));
  const row=m.rows.find(r=>r.id===id(23));
  assert.equal(row.is_courtesy,false);
  assert.notEqual(row.collection.bucket,'cortesia');
  assert.equal(row.collection.bucket,'sin_configurar');
 });
 await sub('finance_collection_summary: cortesia aparte, nunca en dueToday/inGrace/overdueNoGrace/notConfigured',()=>{
  const s=JSON.parse(q(auth(`select finance_collection_summary('${id(30)}')`)));
  assert.equal(s.courtesy.contracts,2);
  assert.equal(Number(s.courtesy.amount),150);
  assert.equal(s.overdueNoGrace.contracts,1);
  assert.equal(Number(s.overdueNoGrace.amount),90);
  assert.equal(s.notConfigured,1);
  assert.equal(s.totalContracts,4);
 });
 await sub('finance_set_courtesy confirma/corrige auditado (responsable, motivo, fecha, valor anterior/nuevo)',()=>{
  const before=JSON.parse(q(auth(`select finance_pon_matrix('${id(30)}',2026)`))).rows.find(r=>r.id===id(23));
  assert.equal(before.is_courtesy,false);
  q(auth(`select finance_set_courtesy('${id(200)}','${id(23)}',true,'Confirmado: modem de oficina sin costo')`));
  const after=JSON.parse(q(auth(`select finance_pon_matrix('${id(30)}',2026)`))).rows.find(r=>r.id===id(23));
  assert.equal(after.is_courtesy,true);
  assert.equal(after.collection.bucket,'cortesia');
  const h=JSON.parse(q(auth(`select finance_history('${id(23)}')`)));
  const entry=h.audit.find(a=>a.accion==='courtesy_status');
  assert.ok(entry,'debe quedar en el historial auditado');
  assert.equal(entry.motivo,'Confirmado: modem de oficina sin costo');
  assert.equal(entry.nuevo.payload.isCourtesy,true);
 });
 await sub('motivo obligatorio: rechaza sin motivo o demasiado corto',()=>{
  assert.throws(()=>q(auth(`select finance_set_courtesy('${id(201)}','${id(23)}',false,'no')`)));
 });
 assert.equal(failed,false,'No publicar PASS si falló un subcaso');
 console.log(JSON.stringify({status:failed?'FAIL':'PASS',cases}));
 }finally{lab.close()}
});
