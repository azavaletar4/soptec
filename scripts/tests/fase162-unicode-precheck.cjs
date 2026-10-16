// Prepare and verify only the UTF-8/catalog roundtrip. Never executes SQL.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {TextDecoder} = require('node:util');
const root = path.resolve(__dirname, '../..');
const runtime = path.join(root, 'scripts/inventory-auth-lab/runtime');
const read = p => new TextDecoder('utf-8', {fatal:true}).decode(fs.readFileSync(path.join(root, p)));
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const original = JSON.parse(read('docs/FASE162-PREPARACION-CLOUD.json'));
const helpers = JSON.parse(read('docs/FASE162-PREPARACION-HELPERS-CLOUD.json'));
const expected = {
  functions: [...original.functions, ...helpers.functions].map(f => ({signature:f.signature,definition_md5:crypto.createHash('md5').update(f.definition.replaceAll('\r',''),'utf8').digest('hex'),acl:f.acl})),
  tables:original.tables, policies:original.policies, types:original.types
};
const approved = [
 ['supabase/migrations/20261015180000_fase162_inventario_rutinas.sql','16a7d9a05dfb6b02ddce08051f7293a93bb246429ca8237229c81ac46748b225'],
 ['supabase/migrations/20261016020000_fase162_autorizacion_recibos.sql','17f0c543b0742fb40d2992ea36238f807fe5b4fa13dbdb3e05a837a0b9d34f72'],
 ['scripts/inventory-auth-lab/runtime/fase162-installation-bundle.sql','898c34ab4d0c9f44960af346e380ba4bef5a7f9c6d6b49cf58c08b24f7dc9d1b']
].map(([file,sha256]) => {
 const bytes=fs.readFileSync(path.join(root,file));
 assert.equal(hash(bytes),sha256,`Approved artifact changed: ${file}`);
 assert.deepEqual(Buffer.from(read(file),'utf8'),bytes,`Not lossless UTF8: ${file}`);
 return {file,sha256,unchanged:true};
});
const icon = original.tables.find(t=>t.name==='inventory_categories').columns.find(c=>c.name==='icon').default;
const probe = "📦 🚀 Español áéíóú 漢字 العربية é|e\u0301\r\n' $ \\";
const literal = s => "'"+s.replaceAll("'","''")+"'";
const canon = x => Array.isArray(x)?x.map(canon).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canon(x[k])])):x;
if(process.argv.includes('--prepare')) {
 const core=read('scripts/tests/fase162-unicode-catalog.sql').trim();
 const json=JSON.stringify(expected); assert(!json.includes('$approved$'));
 const comparisons=Object.keys(expected).flatMap(k=>[literal(k),`(SELECT jsonb_agg(v ORDER BY v::text) FROM jsonb_array_elements(o.j->'${k}') v)=(SELECT jsonb_agg(v ORDER BY v::text) FROM jsonb_array_elements(e.j->'${k}') v)`]);
 const sql=`BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
WITH observed(j) AS (${core}), expected(j) AS (VALUES ($approved$${json}$approved$::jsonb))
SELECT o.j || jsonb_build_object(
 'server_comparisons',jsonb_build_object(${comparisons.join(',')}),
 'client_encoding',current_setting('client_encoding'),
 'probe',${literal(probe)},
 'probe_hex',encode(convert_to(${literal(probe)},'UTF8'),'hex'),
 'probe_sha256',encode(sha256(convert_to(${literal(probe)},'UTF8')),'hex'),
 'icon_hex',(SELECT encode(convert_to(pg_get_expr(d.adbin,d.adrelid),'UTF8'),'hex') FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.inventory_categories'::regclass AND a.attname='icon'),
 'icon_sha256',(SELECT encode(sha256(convert_to(pg_get_expr(d.adbin,d.adrelid),'UTF8')),'hex') FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.inventory_categories'::regclass AND a.attname='icon')
) FROM observed o CROSS JOIN expected e;
ROLLBACK;
`;
 fs.mkdirSync(runtime,{recursive:true});
 fs.writeFileSync(path.join(runtime,'fase162-unicode-precheck.sql'),sql,'utf8');
 console.log('READ_ONLY_PRECHECK_PREPARED; approved artifacts intact');
} else if(process.argv.includes('--verify')) {
 const raw=fs.readFileSync(path.join(runtime,'fase162-unicode-cloud-raw.json'));
 const live=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 const checks={readOnly:live.read_only==='on',correctOrigin:live.origin===true,clientUtf8:live.client_encoding==='UTF8',fase162StillAbsent:live.fase162_absent===true,probeExact:live.probe===probe,probeBytes:live.probe_hex===Buffer.from(probe,'utf8').toString('hex'),probeSHA256:live.probe_sha256===hash(Buffer.from(probe,'utf8')),iconBytes:live.icon_hex===Buffer.from(icon,'utf8').toString('hex'),iconSHA256:live.icon_sha256===hash(Buffer.from(icon,'utf8'))};
 for(const k of Object.keys(expected)) {
   checks[k+'LocalExact']=JSON.stringify(canon(live[k]))===JSON.stringify(canon(expected[k]));
   checks[k+'ServerExact']=live.server_comparisons[k]===true;
 }
 const report={at:live.at,status:Object.values(checks).every(Boolean)?'PASS':'BLOCKED',checks,counts:{functions:expected.functions.length,tables:expected.tables.length,policies:expected.policies.length},icon:{utf8Hex:live.icon_hex,sha256:live.icon_sha256},probe:{utf8Hex:live.probe_hex,sha256:live.probe_sha256},rawResponseSHA256:hash(raw),approvedArtifacts:approved,readOnly:true,migrationsExecuted:false};
 fs.writeFileSync(path.join(root,'docs/FASE162-UNICODE-CLOUD-VALIDACION.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
 assert.equal(report.status,'PASS','UTF8/catalog check failed; no installation authorized');
} else throw Error('Use --prepare or --verify; this tool never connects to Cloud');
