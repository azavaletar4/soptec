const fs=require('fs'),crypto=require('crypto'),assert=require('assert/strict');const rt=__dirname,cfg=JSON.parse(fs.readFileSync(process.argv[2] || (()=>{throw Error('Indicar configuracion nueva revisada; no usar la ubicacion productiva anterior')})(),'utf8').replace(/^\uFEFF/,'')),lab=cfg.dir+'/'+fs.readdirSync(cfg.dir).filter(n=>n.startsWith('lab-')).sort().at(-1);const read=p=>JSON.parse(fs.readFileSync(p));
const before=read(lab+'/onts-before.private.json'),after=read(lab+'/onts-after.private.json');assert.deepEqual(before,after);assert.deepEqual(read(lab+'/protected-before.json'),read(lab+'/protected-after.json'));const post=read(lab+'/catalog-transaction-after.json'),extra=read(lab+'/extra-transaction-after.json');assert.equal(extra.guard.owner,'postgres');assert.equal(extra.guard.securityDefiner,false);assert(post.schema.columns.some(c=>c.column_name==='retired_at'&&c.is_nullable==='YES'&&c.column_default===null));assert(post.schema.constraints.some(c=>c.conname==='olt_onts_olt_device_id_frame_slot_port_ont_id_key'));assert.equal(post.preflight.name_collisions.serial_index,null);assert.equal(post.preflight.name_collisions.position_index,null);
const ledger=read(lab+'/ledger-transaction-after.json');assert.deepEqual(ledger.candidates.map(r=>r.version),['20261021170000']);
const qjson=o=>{const j=JSON.stringify(o),tag='$post_'+crypto.randomBytes(6).toString('hex')+'$';assert(!j.includes(tag));return tag+j+tag+'::jsonb';};
const norm=fs.readFileSync(cfg.workspace+'/normalized-catalog.sql','utf8').trim().replace(/;$/,'');const eq=fs.readFileSync(cfg.workspace+'/extra-catalog.sql','utf8').trim().replace(/;$/,'');delete extra.rowCount;
const assertion=`select 1/(case when (${norm})=${qjson(post)} then 1 else 0 end) as exact_expected_post_catalog;\nselect 1/(case when pg_temp.olt_canonical_catalog_acl((select s::jsonb-'rowCount' from (${eq}) q(s)))=pg_temp.olt_canonical_catalog_acl(${qjson(extra)}) then 1 else 0 end) as exact_expected_permissions;\nselect 1/(case when (select encode(sha256(convert_to(statements[1],'UTF8')),'hex') from supabase_migrations.schema_migrations where version='20261021170000')='${cfg.sha256}' then 1 else 0 end) as exact_ledger_source_hash;\n`;
let sql=fs.readFileSync(cfg.workspace+'/execution-template.sql','utf8').replace('set transaction isolation level repeatable read;','set transaction isolation level repeatable read read write;').replace('-- EXPECTED_POST_ASSERTION',()=>assertion).replace('set transaction isolation level repeatable read read write;',()=> 'set transaction isolation level repeatable read read write;\n'+fs.readFileSync(__dirname+'/../sql/olt-catalog-acl-canonical.sql','utf8'));
const bodyMatch=sql.match(/ARRAY\[\$expected_[a-f0-9]+\$([\s\S]*?)\$expected_[a-f0-9]+\$::jsonb#>>/);assert(bodyMatch);assert.equal(crypto.createHash('sha256').update(Buffer.from(JSON.parse(bodyMatch[1]))).digest('hex'),cfg.sha256);
fs.writeFileSync(cfg.workspace+'/apply-guarded.sql',sql,{flag:'wx'});fs.mkdirSync(cfg.dir+'/production-apply');
let sh=fs.readFileSync(cfg.workspace+'/read-preflight.sh','utf8');sh=sh.slice(0,sh.indexOf('psql -X'))+String.raw`
psql -X -q -At --no-password -v ON_ERROR_STOP=1 -f /scripts/apply-guarded.sql
psql -X -q -At --no-password -v ON_ERROR_STOP=1 <<'SQL'
BEGIN READ ONLY;
\o /out/catalog-readback.private.json
\i /scripts/catalog.sql
\o /out/extra-readback.private.json
\i /scripts/extra-catalog.sql
\o /out/ledger-readback.json
\i /scripts/ledger-read.sql
\o /out/commit-confirmed.json
select json_build_object('status','COMMITTED_EXPANSION_ONLY','version','20261021170000','readOnlyVerification',current_setting('transaction_read_only'),'at',clock_timestamp());
ROLLBACK;
SQL
`;
fs.writeFileSync(cfg.workspace+'/apply-cloud.sh',sh,{flag:'wx'});let ps=fs.readFileSync(cfg.workspace+'/read-preflight.ps1','utf8').replace('D:/SmartRayco/scripts/inventory-auth-lab/runtime/olt-stage2-location.json',require('path').resolve(process.argv[2]).replaceAll('\\','/')).replace('read-preflight.sh','apply-cloud.sh').replace("source='+$cfg.dir+',target=/out", "source='+(Join-Path $cfg.dir 'production-apply')+',target=/out").replace("'read-preflight-errors.private.txt'","'apply-errors.private.txt'").replace('STAGE2_PREFLIGHT_READONLY_CAPTURED','STAGE2_EXPANSION_COMMITTED_AND_READBACK_COMPLETE');fs.writeFileSync(cfg.workspace+'/apply-cloud.ps1',ps,{flag:'wx'});
fs.writeFileSync(cfg.dir+'/local-compatibility-PASS.json',JSON.stringify({status:'PASS',lab,exactMigrationHash:cfg.sha256,existingOntRowsIdentical:true,protectedRowsIdentical:true,originalUniqueRetained:true,activeIndexesAbsent:true,expectedPermissionsValidated:true,onlyLedgerVersion:'20261021170000',wrapperSha256:crypto.createHash('sha256').update(sql).digest('hex'),productionNotYetApplied:true},null,2),{flag:'wx'});console.log('PASS isolated expansion; guarded production transaction ready');
