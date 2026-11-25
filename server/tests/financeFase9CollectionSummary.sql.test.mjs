import {test} from 'node:test';import assert from 'node:assert/strict';import {createFinanceLab,read} from './financeLab.mjs';
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const auth=(sql,n=1)=>`set role authenticated;set request.jwt.claim.sub='${id(n)}';${sql}`;
test('Fase 9: finance_collection_summary agrupa por ciclo comercial confirmado; finance_dashboard agrega recaudado hoy/mes',{timeout:120000},async t=>{
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
 q(`insert into profiles(id,role,active,full_name) values('${id(1)}','ADMIN',true,'Administradora');insert into zones values('${id(30)}','PON sintética'),('${id(31)}','PON otra'),('${id(32)}','PON caja');insert into plans values('${id(99)}','Plan');
  insert into clients(id,first_name,last_name) values('${id(10)}','Vence','Hoy'),('${id(11)}','En','Prorroga'),('${id(12)}','Vencido','SinProrroga'),('${id(13)}','Sin','Configurar'),('${id(14)}','Otra','Zona'),('${id(15)}','Caja','Hoy'),('${id(16)}','Caja','Mes');
  insert into service_contracts(id,client_id,zone_id,contract_number,client_code,plan_id,service_type,monthly_fee,finance_billing_modality,finance_billing_day,finance_grace_days) values
   ('${id(20)}','${id(10)}','${id(30)}','CTR-1','CIN-1','${id(99)}','internet_combo',80,'adelantado',extract(day from current_date)::int,7),
   ('${id(21)}','${id(11)}','${id(30)}','CTR-2','CIN-2','${id(99)}','internet_combo',90,'adelantado',extract(day from current_date - interval '3 days')::int,7),
   ('${id(22)}','${id(12)}','${id(30)}','CTR-3','CIN-3','${id(99)}','internet_combo',70,'adelantado',extract(day from current_date - interval '15 days')::int,7);
  insert into service_contracts(id,client_id,zone_id,contract_number,client_code,plan_id,service_type,monthly_fee) values
   ('${id(23)}','${id(13)}','${id(30)}','CTR-4','CIN-4','${id(99)}','internet_combo',60);
  insert into service_contracts(id,client_id,zone_id,contract_number,client_code,plan_id,service_type,monthly_fee,finance_billing_modality,finance_billing_day) values
   ('${id(24)}','${id(14)}','${id(31)}','CTR-5','CIN-5','${id(99)}','internet_combo',50,'cumplido',extract(day from current_date)::int);
  insert into service_contracts(id,client_id,zone_id,contract_number,client_code,plan_id,service_type,monthly_fee) values
   ('${id(25)}','${id(15)}','${id(32)}','CTR-6','CIN-6','${id(99)}','internet_combo',80),
   ('${id(26)}','${id(16)}','${id(32)}','CTR-7','CIN-7','${id(99)}','internet_combo',90);
  update service_contracts set finance_reconciled_at=now(),finance_start_date=current_date-interval '2 months' where id in('${id(20)}','${id(21)}','${id(22)}','${id(25)}','${id(26)}');
  set role authenticated;set request.jwt.claim.sub='${id(1)}';
  select finance_record_payment('${id(40)}','${id(20)}','{}'::uuid[],1,'cash',null,'ancla de ciclo: vence hoy');
  select finance_record_payment('${id(41)}','${id(21)}','{}'::uuid[],1,'cash',null,'ancla de ciclo: en prorroga');
  select finance_record_payment('${id(42)}','${id(22)}','{}'::uuid[],1,'cash',null,'ancla de ciclo: vencido sin prorroga');
  select finance_record_payment('${id(50)}','${id(25)}','{}'::uuid[],80,'cash',null,'pago recibido hoy');
  select finance_record_payment('${id(51)}','${id(26)}','{}'::uuid[],90,'cash',null,'pago recibido este mes (no hoy)');
  reset role;
  -- Las fechas reales deben quedar ancladas al pasado (ciclo) o al mes en
  -- curso (caja), no al instante de creacion sintetica de la prueba.
  update invoice_payments set received_at=(current_date - interval '1 month')::date where id='${id(40)}';
  update invoice_payments set received_at=((current_date - interval '3 days') - interval '1 month')::date where id='${id(41)}';
  update invoice_payments set received_at=((current_date - interval '15 days') - interval '1 month')::date where id='${id(42)}';
  update invoice_payments set received_at=date_trunc('month',now())+interval '12 hours' where id='${id(51)}';`);
 await sub('vence_hoy: contrato adelantado cuyo ciclo vence exactamente hoy',()=>{
  const s=JSON.parse(q(auth(`select finance_collection_summary('${id(30)}')`)));
  const bucket=s.buckets.find(b=>b.bucket==='vence_hoy');
  assert.equal(Number(bucket.contracts),1);
  assert.equal(s.dueToday.contracts,1);
  assert.equal(Number(s.dueToday.amount),80);
 });
 await sub('en_prorroga: contrato adelantado vencido hace 3 dias con 7 de prorroga sigue en prorroga',()=>{
  const s=JSON.parse(q(auth(`select finance_collection_summary('${id(30)}')`)));
  assert.equal(s.inGrace.contracts,1);
  assert.equal(Number(s.inGrace.amount),90);
 });
 await sub('vencido_sin_prorroga: contrato adelantado vencido hace 15 dias (fuera de prorroga de 7) es elegible',()=>{
  const s=JSON.parse(q(auth(`select finance_collection_summary('${id(30)}')`)));
  assert.equal(s.overdueNoGrace.contracts,1);
  assert.equal(Number(s.overdueNoGrace.amount),70);
 });
 await sub('sin_configurar: contrato sin modalidad/dia confirmado NUNCA cuenta como al dia ni vencido',()=>{
  const s=JSON.parse(q(auth(`select finance_collection_summary('${id(30)}')`)));
  assert.equal(s.notConfigured,1);
  assert.ok(!s.buckets.some(b=>b.bucket==='vence_hoy'&&Number(b.contracts)>1));
 });
 await sub('filtro por zona excluye contratos de otra PON',()=>{
  const s=JSON.parse(q(auth(`select finance_collection_summary('${id(30)}')`)));
  assert.equal(s.totalContracts,4);
  const s2=JSON.parse(q(auth(`select finance_collection_summary('${id(31)}')`)));
  assert.equal(s2.totalContracts,1);
 });
 await sub('finance_dashboard agrega receivedToday/receivedMonth/asOf sin romper las claves existentes',()=>{
  const from=q(`select to_char(date_trunc('month',now()),'YYYY-MM-DD')`),to=q(`select to_char(now(),'YYYY-MM-DD')`);
  const d=JSON.parse(q(auth(`select finance_dashboard('${from}'::date,'${to}'::date,'${id(32)}')`)));
  assert.equal(Number(d.receivedToday),80);
  assert.equal(Number(d.receivedMonth),170);
  assert.ok(typeof d.asOf==='string');
  assert.ok('billed' in d && 'received' in d && 'pending' in d);
 });
 assert.equal(failed,false,'No publicar PASS si falló un subcaso');
 console.log(JSON.stringify({status:failed?'FAIL':'PASS',cases}));
 }finally{lab.close()}
});
