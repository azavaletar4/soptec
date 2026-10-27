// Prueba de restauración en PostgreSQL LOCAL efímero, sin red; nunca conecta Cloud.
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const privateDir=path.resolve('.env.a3-recovery');
const name='a3-sql-restore-'+Date.now();let created=false;
const run=(args,input)=>cp.execFileSync('docker',args,{input,encoding:'utf8',timeout:60000,stdio:['pipe','pipe','pipe'],maxBuffer:8*1024*1024}).trim();
const sql=q=>run(['exec','-i',name,'psql','-h','127.0.0.1','-U','postgres','-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],q);
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const ident=s=>'"'+s.replaceAll('"','""')+'"';
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
(async()=>{try {
 const snapshot=JSON.parse(fs.readFileSync(path.join(privateDir,'sql-before-private.json'),'utf8'));
 const evidence=JSON.parse(fs.readFileSync('docs/ASISTENCIA-A3-SQL-BACKUP-VERIFIED.json','utf8'));
 assert.equal(hash(path.join(privateDir,'asistencia-before.dump')),evidence.dumpSha256);
 assert.equal(hash(path.join(privateDir,'functions-before.sql')),evidence.functionsSha256);
 run(['run','--rm','-d','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);created=true;
 let ready=false;for(let n=0;n<80;n++){try{run(['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(ready);
 const roles=[...new Set(['anon','authenticated','service_role',...snapshot.roles])].filter(r=>r!=='postgres');
 sql(roles.map(r=>'CREATE ROLE '+ident(r)+';').join('\n')+`
 CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 `+Object.entries(snapshot.enums).map(([type,labels])=>'CREATE TYPE public.'+ident(type)+' AS ENUM ('+labels.map(quote).join(',')+');').join('\n')+`
 CREATE TABLE public.profiles(id uuid PRIMARY KEY,role public.user_role,active boolean,full_name text,email text);
 INSERT INTO public.profiles SELECT * FROM json_populate_recordset(NULL::public.profiles,`+quote(JSON.stringify(snapshot.profiles))+');');
 run(['cp',path.join(privateDir,'asistencia-before.dump'),name+':/tmp/a3.dump']);
 run(['exec',name,'pg_restore','-h','127.0.0.1','-U','postgres','-d','postgres','--exit-on-error','--no-owner','--section=pre-data','/tmp/a3.dump']);
 sql(fs.readFileSync(path.join(privateDir,'functions-before.sql'),'utf8'));
 run(['exec',name,'pg_restore','-h','127.0.0.1','-U','postgres','-d','postgres','--exit-on-error','--no-owner','--section=data','/tmp/a3.dump']);
 run(['exec',name,'pg_restore','-h','127.0.0.1','-U','postgres','-d','postgres','--exit-on-error','--no-owner','--section=post-data','/tmp/a3.dump']);
 const after=JSON.parse(sql(fs.readFileSync('scripts/sql/asistencia-a3-backup-metadata.sql','utf8')));
 const sortRows=rows=>rows.map(r=>JSON.stringify(r)).sort();
 // La colación del servidor puede ordenar nombres con '_' de forma distinta.
 // Se comparan conjuntos completos por nombre/hash, sin omitir ninguna tabla.
 assert.deepEqual(sortRows(after.tables),sortRows(snapshot.tables),'RESTORED_TABLE_ROWS_OR_HASH_MISMATCH');
 assert.deepEqual(sortRows(after.functions.map(f=>[f.name,f.body_md5])),sortRows(snapshot.functions.map(f=>[f.name,f.body_md5])),'FUNCTION_BODY_MISMATCH');
 assert.deepEqual(sortRows(after.triggers),sortRows(snapshot.triggers),'TRIGGER_MISMATCH');
 assert.deepEqual(sortRows(after.policies),sortRows(snapshot.policies),'RLS_POLICY_MISMATCH');
 assert.equal(after.a3_absent,true);
 evidence.restorationVerified=true;
 evidence.restoreCheck={network:'none',ephemeral:true,tableHashesMatched:after.tables.length,functionBodiesMatched:after.functions.length,triggersMatched:after.triggers.length,policiesMatched:after.policies.length,a3StillAbsent:true};
 fs.writeFileSync('docs/ASISTENCIA-A3-SQL-BACKUP-VERIFIED.json',JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify(evidence));
}catch(e){console.error('LOCAL_RESTORE_FAILED '+e.message.split('\n')[0]);if(e.stderr)console.error(String(e.stderr).slice(-1200));process.exitCode=1;}
finally{if(created)run(['rm','-f',name]);}})();
