// Auditoría final local; no realiza escrituras en PostgreSQL.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {runtime,root,sql} from './common.mjs';
const f=JSON.parse(readFileSync(runtime+'transactions.json','utf8')),baseline=JSON.parse(readFileSync(runtime+'transactions-baseline.json','utf8'));
for(const [key,table] of Object.entries({products:'inventory_products',units:'inventory_units',movements:'inventory_movements',events:'inventory_unit_events'})){
 const old=baseline[key]??[],current=JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from ${table} t where id in (${old.map(x=>`'${x.id}'`).join(',')||'null'})`));
 assert.deepEqual(current,old.sort((a,b)=>a.id.localeCompare(b.id)),'Se alteró una fila previa: detener');
}
const totals=JSON.parse(sql(`select jsonb_build_object('stock',(select current_stock from inventory_products where id='${f.material}'),'stock_from_kardex',20+coalesce(sum(case when movement_type='ingreso' then quantity else -quantity end),0),'movements',count(*),'duplicate_reversals',(select count(*) from(select reverses_movement_id from inventory_movements where product_id='${f.material}' and reverses_movement_id is not null group by reverses_movement_id having count(*)>1)x),'active_egresos',(select count(*) from inventory_movements m where product_id='${f.material}' and movement_type='egreso' and not exists(select 1 from inventory_movements r where r.reverses_movement_id=m.id))) from inventory_movements where product_id='${f.material}'`));
assert.equal(totals.stock,20);assert.equal(totals.stock_from_kardex,20);assert.equal(totals.duplicate_reversals,0);assert.equal(totals.active_egresos,0);
const states=JSON.parse(sql(`select jsonb_agg(jsonb_build_object('status',status,'links_cleared',client_id is null and contract_id is null and installation_id is null and ticket_id is null) order by id) from inventory_units where id in (${f.units.map(u=>`'${u.id}'`).join(',')})`));
assert.equal(states.filter(u=>u.status==='in_stock').length,4);assert.equal(states.filter(u=>u.status==='damaged').length,1);assert(states.every(u=>u.links_cleared));
const receipts=JSON.parse(sql(`select jsonb_build_object('total',count(*),'incomplete',count(*) filter(where result is null)) from campo_inventory_operations where job_id in (${f.jobs.map(j=>`'${j.id}'`).join(',')})`));assert.equal(receipts.incomplete,0);
writeFileSync(root+'docs/INVENTARIO-LAB-TRANSACCIONES-AUDITORIA.json',JSON.stringify({at:new Date().toISOString(),status:'PASS',previousLabRowsUnchanged:true,totals,receipts,units:{in_stock:4,damaged:1,allLinksCleared:true},productionAccess:false},null,2)+'\n');
console.log('TX_AUDIT_PASS: '+totals.movements+' movimientos; stock=20 y Kardex=20; cero duplicados; filas previas intactas.');
