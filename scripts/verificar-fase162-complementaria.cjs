// Only prepares/verifies a read-only catalog query. Does not connect to Cloud.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/^\uFEFF/,'');
const runtime=path.join(root,'scripts/inventory-auth-lab/runtime');
if(process.argv.includes('--prepare')){
 const old=JSON.parse(read('docs/FASE162-PREPARACION-CLOUD.json')),helpers=JSON.parse(read('docs/FASE162-PREPARACION-HELPERS-CLOUD.json'));
 const expected={functions:[...old.functions,...helpers.functions].map(f=>({signature:f.signature,definition_md5:crypto.createHash('md5').update(f.definition.replaceAll('\r','')).digest('hex'),acl:f.acl})),tables:old.tables,policies:old.policies};
 const encoded=JSON.stringify(expected);assert(!encoded.includes('$approved$'));
 const query=`BEGIN READ ONLY; SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='2s';
WITH observed(j) AS (${read('scripts/tests/fase162-unicode-catalog.sql')}), expected(j) AS (VALUES($approved$${encoded}$approved$::jsonb))
${read('scripts/tests/fase162-complementary-read.sql')}
ROLLBACK;`;
 const target=path.join(runtime,'fase162-final-cloud-read.sql');
 const archive=path.join(runtime,'fase162-complementary-original-failed.sql');
 if(fs.existsSync(target)&&!fs.existsSync(archive))fs.copyFileSync(target,archive,fs.constants.COPYFILE_EXCL);
 fs.writeFileSync(target,query,'utf8');console.log('READ_ONLY_COMPLEMENTARY_QUERY_PREPARED');
}else if(process.argv.includes('--verify')){
 const raw=fs.readFileSync(path.join(runtime,'fase162-final-cloud-read.json'));
 const observed=JSON.parse(raw.toString('utf8'));
 const checks={readOnly:observed.read_only==='on',fase162Present:observed.fase162Present===true};
 for(const [k,v]of Object.entries(observed))if(k.startsWith('legacy'))checks[k]=v===true;
 assert.equal(Object.keys(checks).length,11,'Missing verification fields');
 const report={status:Object.values(checks).every(Boolean)?'VERIFICACION_COMPLETA':'PENDIENTE',at:observed.at,checks,receiptsCreated:observed.receiptsCreated,receiptCountIsObservationNotBusinessTest:true,rawResponseSHA256:crypto.createHash('sha256').update(raw).digest('hex'),migrationsReexecuted:false,cloudWrites:false,previous26PostchecksNotRepeated:true,historicalErrorAvailable:false,isolatedReproduction:'docs/FASE162-COMPLEMENTARIA-PRUEBAS.json'};
 fs.writeFileSync(path.join(root,'docs/FASE162-VERIFICACION-COMPLEMENTARIA.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));assert.equal(report.status,'VERIFICACION_COMPLETA');
}else throw Error('Use --prepare or --verify');
