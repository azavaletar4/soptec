const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process');
test('Comparador ACL PostgreSQL: orden indiferente, privilegios/otorgantes/grant options exactos',async t=>{
 const name='smartrayco-olt-acl-'+process.pid+'-'+Date.now();
 const docker=(args,input)=>cp.execFileSync('docker',['--host','npipe:////./pipe/dockerDesktopLinuxEngine',...args],{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
 const sql=q=>docker(['exec','-i',name,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres'],q).trim();
 try{
  docker(['run','-d','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data:rw','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
  let ready=false;
  for(let i=0;i<60;i++){try{sql('select 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}
  assert(ready,'PostgreSQL aislado disponible');
  sql('create role anon; create role authenticated; create role service_role; create role otro_otorgante;');
  sql(fs.readFileSync(__dirname+'/../sql/olt-catalog-acl-canonical.sql','utf8'));
  // pg_temp belongs to a session: run helper and all assertions in the same psql.
  const helper=fs.readFileSync(__dirname+'/../sql/olt-catalog-acl-canonical.sql','utf8');
  const acl='{anon=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}';
  const ordered='{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}';
  const wrap=a=>`jsonb_build_object('guard',jsonb_build_object('acl','${a}','owner','postgres'),'columns',jsonb_build_array(1,2))`;
  const compare=(a,b)=>`pg_temp.olt_canonical_catalog_acl(${wrap(a)})=pg_temp.olt_canonical_catalog_acl(${wrap(b)})`;
  const cases=[
   ['ACL de ambos ordenes del incidente',compare(acl,ordered),true],
   ['Permiso ausente',compare(acl,'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'),false],
   ['Permiso PUBLIC adicional',compare(acl,'{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),false],
   ['Grant option adicional',compare(acl,'{anon=X*/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}'),false],
   ['Otorgante diferente',compare(acl,'{anon=X/otro_otorgante,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}'),false],
   ['Grantee diferente',compare(acl,'{otro_otorgante=X/postgres,authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres}'),false],
   ['NULL no equivale a ACL vacia',`pg_temp.olt_canonical_catalog_acl('{"acl":null}')=pg_temp.olt_canonical_catalog_acl('{"acl":"{}"}')`,false],
   ['Otros metadatos siguen exactos',`pg_temp.olt_canonical_catalog_acl(${wrap(acl)})=pg_temp.olt_canonical_catalog_acl(jsonb_set(${wrap(ordered)},'{guard,owner}','"otro"'))`,false],
   ['Arrays ajenos conservan orden',`pg_temp.olt_canonical_catalog_acl('{"rows":[1,2]}')=pg_temp.olt_canonical_catalog_acl('{"rows":[2,1]}')`,false],
   ['Privilegios combinados equivalentes',`pg_temp.olt_canonical_catalog_acl('{"acl":"{anon=rw/postgres}"}')=pg_temp.olt_canonical_catalog_acl('{"acl":"{anon=wr/postgres}"}')`,true],
  ];
  for(const [label,expr,expected] of cases) await t.test(label,()=>assert.equal(sql(helper+'\nselect '+expr+';'),expected?'t':'f'));
  await t.test('ACL invalida aborta, nunca se silencia',()=>assert.throws(()=>sql(helper+`\nselect pg_temp.olt_canonical_catalog_acl('{"acl":"invalido"}');`)));
 }finally{docker(['rm','-f',name]);}
});
