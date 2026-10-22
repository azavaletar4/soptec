const fs=require('fs'),assert=require('assert/strict');
const location=JSON.parse(fs.readFileSync(__dirname+'/backup-location.json'));
const snap=JSON.parse(fs.readFileSync(location.BackupDirectory+'/preflight.private.json'));
const c=snap.case,cat=snap.catalog;
assert.equal(c.read_only,'on');assert.equal(c.onts.length,2);
const mstc=c.onts.find(x=>x.id==='a1f0b671-a1e2-482c-b24e-7e584bf0e4ed');
const janet=c.onts.find(x=>x.id==='74d586e3-3a0a-40c2-aba3-46294adcf095');
assert(mstc&&janet);assert.equal(mstc.serial,'MSTC8CCE647E');assert.equal(mstc.client_id,null);assert.equal(mstc.contract_id,null);
assert.equal(janet.serial,'HWTCDEB847B6');assert.equal(janet.client_id,'a563d740-a060-417e-852a-5153edeefb18');assert.equal(janet.contract_id,'cb2ee4ae-3301-44cc-b44c-939cca819e3b');
assert.equal(mstc.olt_device_id,'700d31b5-679e-4dda-9eeb-53bf3aaf87e0');assert.equal(janet.olt_device_id,mstc.olt_device_id);
assert.deepEqual([mstc.frame,mstc.slot,mstc.port,mstc.ont_id],[1,2,8,3]);assert.deepEqual([janet.frame,janet.slot,janet.port,janet.ont_id],[1,2,8,50]);
for(const x of c.protected_clients)assert.equal(x.status,'active');
for(const [id,client] of [['cb2ee4ae-3301-44cc-b44c-939cca819e3b',janet.client_id],['91f25111-758a-4f5a-9b79-196065509cde','3f01013e-ad20-44bb-ad15-443416e14d63']]){
 const contract=c.protected_contracts.find(x=>x.id===id);assert(contract);assert.equal(contract.client_id,client);assert.equal(contract.status,'active');
}
assert.equal(c.protected_clients.length,2);assert.equal(c.protected_contracts.length,2);assert.equal(c.protected_inventory.length,1);
const u=c.protected_inventory[0];assert.equal(u.id,'f4c174ef-9136-4ee6-83e7-4082d8a47140');assert.equal(u.serial_number,'48575443E5C94DB6');assert.equal(u.status,'assigned');assert.equal(u.client_id,'3f01013e-ad20-44bb-ad15-443416e14d63');assert.equal(u.contract_id,'91f25111-758a-4f5a-9b79-196065509cde');
assert.equal(cat.preflight.duplicate_serials,null);assert.equal(cat.preflight.duplicate_positions,null);assert.deepEqual(cat.preflight.name_collisions,{guard:null,serial_index:null,position_index:null});
assert(!cat.schema.columns.some(x=>x.column_name==='retired_at'));assert(cat.schema.constraints.some(x=>x.conname==='olt_onts_olt_device_id_frame_slot_port_ont_id_key'));
for(const [name,md5] of [['assign_contract_nap_sync_ont_zone','61dc572f18d1101144b49d8bef3af38a'],['crear_descuento_compensacion_masivo','41fd2a9b59106c76898dfac0bebc7501']]){
 const fn=cat.functions.functions.find(x=>x.proname===name);assert(fn);assert.equal(fn.body_lf_md5,md5);assert.equal(fn.owner,'postgres');
}
assert(snap.ledger.some(x=>x.name.startsWith('fase166_')));assert(snap.ledger.some(x=>x.name.startsWith('fase167_')));assert(snap.ledger.some(x=>x.version==='20261021220000'));
assert(!snap.ledger.some(x=>['20261021170000','20261021171000'].includes(x.version)));
assert.equal(snap.phase_functions.find(x=>x.name==='assert_no_rejected_materials').normalized_md5,'4201e9cb13b8b93d2ae80a0cc44035c2');
assert.equal(snap.phase_functions.find(x=>x.name==='validate_installation_completion').normalized_md5,'e452ec213962f70d8db289ac17ed361f');
assert.equal(snap.phase_functions.find(x=>x.name==='retry_rejected_material_operation').body_md5,'f9b1fea0855798d6dcf7ef9392d21903');
console.log('PASS identidades/vinculos/esquema/duplicados/lectores SQL/fases 166-169; expansion y conciliacion siguen pendientes');
