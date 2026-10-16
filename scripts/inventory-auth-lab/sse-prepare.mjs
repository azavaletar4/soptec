// Solo fixture aditiva y funciones experimentales del laboratorio existente.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {config,sql,runtime,root} from './common.mjs';
config();
if(existsSync(runtime+'sse-fixture.json'))throw Error('Fixture SSE conservada; no recrear ni resetear');
const m=JSON.parse(readFileSync(runtime+'manifest.json','utf8'));
const f={users:m.users,jobs:m.jobs.slice(0,2).map(j=>({...j,id:randomUUID()}))};
const before=sql(`select jsonb_build_object(
 'products',(select jsonb_agg(to_jsonb(t) order by id) from inventory_products t),
 'units',(select jsonb_agg(to_jsonb(t) order by id) from inventory_units t),
 'movements',(select jsonb_agg(to_jsonb(t) order by id) from inventory_movements t),
 'events',(select jsonb_agg(to_jsonb(t) order by id) from inventory_unit_events t),
 'receipts',(select jsonb_agg(to_jsonb(t) order by id) from campo_inventory_operations t))`);
writeFileSync(runtime+'sse-baseline.json',before+'\n');
sql(readFileSync(new URL('./sse-schema.sql',import.meta.url),'utf8'));
sql(`begin;
 ${f.jobs.map(j=>`insert into ${j.type==='installation'?'installations':'tickets'}(id,status,client_id,contract_id)
 values('${j.id}','${j.type==='installation'?'scheduled':'open'}','${j.clientId}','${j.contractId}');
 insert into job_assignees(job_type,job_id,technician_id,role) values
 ('${j.type}','${j.id}','${m.users.leader}','leader'),('${j.type}','${j.id}','${m.users.support}','support'),('${j.type}','${j.id}','${m.users.removed}','support');
 insert into lab_sse.scopes(job_type,job_id) values('${j.type}','${j.id}');`).join('\n')}
 commit;`);
writeFileSync(runtime+'sse-fixture.json',JSON.stringify(f,null,2));
console.log('SSE_FIXTURE_READY: dos órdenes ficticias nuevas, cero escrituras de inventario, rol backend sin SELECT de negocio.');
