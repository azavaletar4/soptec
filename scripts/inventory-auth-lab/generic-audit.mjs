// Solo lectura del estado final, sin repetir escenarios de autorización.
import {readFileSync,writeFileSync} from 'node:fs';
import {config,sql,runtime,root} from './common.mjs';
config();
const actual=sql(`select jsonb_build_object('products',(select jsonb_agg(to_jsonb(t) order by id) from inventory_products t),'units',(select jsonb_agg(to_jsonb(t) order by id) from inventory_units t),'movements',(select jsonb_agg(to_jsonb(t) order by id) from inventory_movements t),'events',(select jsonb_agg(to_jsonb(t) order by id) from inventory_unit_events t),'receipts',(select jsonb_agg(to_jsonb(t) order by id) from campo_inventory_operations t))`);
let clockListening=false;try{clockListening=(await fetch('http://127.0.0.1:54388/health',{signal:AbortSignal.timeout(1000)})).ok;}catch{}
const audit={at:new Date().toISOString(),environment:'LOCAL_SYNTHETIC_ONLY',inventoryUnchanged:actual===readFileSync(runtime+'generic-baseline.json','utf8').trim(),clockListening,remoteAccess:false};
writeFileSync(root+'docs/INVENTARIO-LAB-GENERICOS-AUDITORIA.json',JSON.stringify(audit,null,2)+'\n');
console.log(JSON.stringify(audit));if(!audit.inventoryUnchanged||clockListening)process.exitCode=1;
