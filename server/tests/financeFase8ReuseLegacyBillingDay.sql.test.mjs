import {test} from 'node:test';import assert from 'node:assert/strict';import {createFinanceLab,read} from './financeLab.mjs';
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const auth=(sql,n=1)=>`set role authenticated;set request.jwt.claim.sub='${id(n)}';${sql}`;
test('Fase 8: finance_pon_matrix sugiere billing_day legacy sin confirmarlo ni afectar la cobranza',{timeout:120000},async t=>{
 // Misma cadena cronologica real que financeBillingCycle.sql.test.mjs
 // (fase2-5 via financeLab, 6/7b/7c manuales en orden) + la migracion nueva
 // de fase 8 sobre esa base - nunca sobre la version original de fase 3/7c.
 const lab=await createFinanceLab({phase5:true}),q=lab.q;let cases=0,failed=false;
 const sub=(name,fn)=>t.test(name,async()=>{try{await fn();cases++}catch(e){failed=true;throw e}});
 try{
 q(read('../../supabase/migrations/20261124210000_finance_opening_credit_phase6.sql'));
 q(read('../../supabase/migrations/20261124220000_finance_contract_search_dni_phase7b.sql'));
 q(`do $$ begin create type public.debt_hold_status as enum ('none','pending','suspended'); exception when duplicate_object then null; end $$; alter table service_contracts add column if not exists debt_hold_status public.debt_hold_status not null default 'none';`);
 q(read('../../supabase/migrations/20261125090000_finance_billing_cycle_phase7c.sql'));
 // billing_day (fase 2/119) no forma parte del catalogo sintetico de
 // financeLab.mjs (es anterior y ajena a Facturacion) - se agrega aqui tal
 // cual existe en produccion (default 1, 1-31) para poder probar el
 // escenario real sin depender de ese catalogo.
 q(`alter table service_contracts add column if not exists billing_day integer not null default 1 check (billing_day between 1 and 31);`);
 q(read('../../supabase/migrations/20261126090000_finance_reuse_legacy_billing_day_phase8.sql'));
 q(`insert into profiles(id,role,active,full_name) values('${id(1)}','ADMIN',true,'Administradora');insert into zones values('${id(30)}','PON sintética');insert into plans values('${id(99)}','Plan');insert into clients(id,first_name,last_name) values('${id(10)}','Cliente','Sintético'),('${id(11)}','Otro','Cliente');
  insert into service_contracts(id,client_id,zone_id,contract_number,client_code,plan_id,service_type,billing_day) values
   ('${id(20)}','${id(10)}','${id(30)}','CTR-1','CIN-1','${id(99)}','internet_combo',7),
   ('${id(21)}','${id(11)}','${id(30)}','CTR-2','CIN-2','${id(99)}','internet_combo',1);`);
 await sub('contrato con día de emisión real (distinto del default 1) aparece como legacy_billing_day, sin confirmar modalidad/día de cobranza',()=>{
  const m=JSON.parse(q(auth(`select finance_pon_matrix('${id(30)}',2026)`)));
  const row=m.rows.find(r=>r.id===id(20));
  assert.equal(row.legacy_billing_day,7);
  assert.equal(row.billing_day,null);
  assert.equal(row.billing_modality,null);
  assert.equal(row.collection.bucket,'sin_configurar');
 });
 await sub('contrato en el default 1 también se expone tal cual (nunca se interpreta como "sin configurar" en el campo legacy)',()=>{
  const m=JSON.parse(q(auth(`select finance_pon_matrix('${id(30)}',2026)`)));
  const row=m.rows.find(r=>r.id===id(21));
  assert.equal(row.legacy_billing_day,1);
 });
 await sub('confirmar condiciones comerciales no altera ni depende del valor legacy',()=>{
  q(auth(`select finance_set_billing_terms('${id(200)}','${id(20)}','adelantado',7,7,'Confirmación con el mismo día ya existente')`));
  const m=JSON.parse(q(auth(`select finance_pon_matrix('${id(30)}',2026)`)));
  const row=m.rows.find(r=>r.id===id(20));
  assert.equal(row.legacy_billing_day,7);
  assert.equal(row.billing_day,7);
  assert.equal(row.billing_modality,'adelantado');
 });
 assert.equal(failed,false,'No publicar PASS si falló un subcaso');
 console.log(JSON.stringify({status:failed?'FAIL':'PASS',cases}));
 }finally{lab.close()}
});
