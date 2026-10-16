// Solo lectura: estado final y privilegios del prototipo, sin repetir escenarios.
import {readFileSync,writeFileSync} from 'node:fs';
import {config,sql,runtime,root} from './common.mjs';
config();
const actual=sql(`select jsonb_build_object(
 'products',(select jsonb_agg(to_jsonb(t) order by id) from inventory_products t),
 'units',(select jsonb_agg(to_jsonb(t) order by id) from inventory_units t),
 'movements',(select jsonb_agg(to_jsonb(t) order by id) from inventory_movements t),
 'events',(select jsonb_agg(to_jsonb(t) order by id) from inventory_unit_events t),
 'receipts',(select jsonb_agg(to_jsonb(t) order by id) from campo_inventory_operations t))`);
const permissions=JSON.parse(sql(`select jsonb_build_object(
 'canSelectInventory',has_table_privilege('lab_sse_backend','inventory_units','select') or has_table_privilege('lab_sse_backend','inventory_movements','select') or has_table_privilege('lab_sse_backend','inventory_products','select'),
 'isSuperuser',(select rolsuper from pg_roles where rolname='lab_sse_backend'),
 'unfinishedTransactions',(select count(*) from pg_stat_activity where usename='lab_sse_backend' and xact_start is not null))`));
let listening=false;try{listening=(await fetch('http://127.0.0.1:54387/health',{signal:AbortSignal.timeout(1000)})).ok;}catch{}
const audit={at:new Date().toISOString(),environment:'LOCAL_SYNTHETIC_ONLY',inventoryUnchanged:actual===readFileSync(runtime+'sse-baseline.json','utf8').trim(),permissions,sseServerListening:listening};
writeFileSync(root+'docs/INVENTARIO-LAB-SSE-AUDITORIA.json',JSON.stringify(audit,null,2)+'\n');
console.log(JSON.stringify(audit));
if(!audit.inventoryUnchanged||permissions.canSelectInventory||permissions.isSuperuser||Number(permissions.unfinishedTransactions)!==0||listening)process.exitCode=1;
