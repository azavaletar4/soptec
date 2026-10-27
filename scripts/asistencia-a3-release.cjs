// Activación selectiva autorizada; ninguna operación sobre backend/OLT/MikroTik.
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const mode=process.argv[2],dir=path.resolve('.env.a3-recovery'),recordPath='docs/ASISTENCIA-A3-RELEASE.json';
const base=JSON.parse(fs.readFileSync('docs/ASISTENCIA-A3-PREFLIGHT-VM.json','utf8'));
const imageBackup=JSON.parse(fs.readFileSync('docs/ASISTENCIA-A3-IMAGE-BACKUP-VERIFIED.json','utf8'));
const sqlBackup=JSON.parse(fs.readFileSync('docs/ASISTENCIA-A3-SQL-BACKUP-VERIFIED.json','utf8'));
const before=JSON.parse(fs.readFileSync(path.join(dir,'sql-before-private.json'),'utf8'));
const front=base.containers.find(c=>c.name.includes('frontend')),back=base.containers.find(c=>c.name.includes('backend'));
const stage=imageBackup.stage;
const record=fs.existsSync(recordPath)?JSON.parse(fs.readFileSync(recordPath,'utf8')):{commit:'71944f5',verifierCommit:'6af43cd',stage,imageTag:'smartrayco-asistencia-a3:71944f5-'+new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z')};
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const sorted=rows=>rows.map(r=>JSON.stringify(r)).sort();
const git=(...args)=>cp.execFileSync('git',args,{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const sshArgs=['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy')];
const ssh=code=>cp.execFileSync('ssh',[...sshArgs,'root@192.168.55.201','python3 -'],{input:code,encoding:'utf8',timeout:300000,stdio:['pipe','pipe','pipe'],maxBuffer:8*1024*1024});
const scp=(a,b)=>cp.execFileSync('scp',[...sshArgs,a,b],{timeout:120000,stdio:['ignore','pipe','pipe']});
const remote=`import json,subprocess,hashlib,os,tarfile,datetime,urllib.request\nstage=${JSON.stringify(stage)}\nfront=json.loads(${JSON.stringify(JSON.stringify(front))})\nback=json.loads(${JSON.stringify(JSON.stringify(back))})\nimage_tag=${JSON.stringify(record.imageTag)}\ndef inspect(n):return json.loads(subprocess.check_output(['docker','inspect',n]))[0]\ndef check_back():\n c=inspect('smartrayco-backend-1')\n assert c['Id']==back['id'] and c['Image']==back['image'] and c['State']['StartedAt']==back['startedAt'] and c['State']['Running'],'BACKEND_DRIFT'\n for p,h in front['composeHashes'].items():assert hashlib.sha256(open(p,'rb').read()).hexdigest()==h,'OVERRIDE_DRIFT'\n return c\ndef check_front():\n c=inspect('smartrayco-frontend-1')\n assert c['Id']==front['id'] and c['Image']==front['image'] and c['State']['StartedAt']==front['startedAt'],'FRONTEND_DRIFT'\n return c\ncheck_back()\n`;
function save(){fs.writeFileSync(recordPath,JSON.stringify(record,null,2)+'\n');}
try {
 if(mode==='pre') {
  assert.ok(git('show','6af43cd:scripts/asistencia-a3-activate.cjs').includes("verifier_ns['verify_archive']"));
  assert.equal(git('diff','--name-only','71944f5','HEAD','--','src','supabase/migrations/20261029000000_asistencia_a3_intercambios.sql'),'');
  const files=git('diff','--name-only','7ed8dcd','71944f5','--','src').split('\n');assert.equal(files.length,5);
  assert.equal(sha(path.join(dir,'frontend.tar')),imageBackup.verification.archiveSha256);
  assert.equal(sha(path.join(dir,'asistencia-before.dump')),sqlBackup.dumpSha256);
  assert.equal(sha(path.join(dir,'functions-before.sql')),sqlBackup.functionsSha256);
  assert.equal(sqlBackup.restorationVerified,true);
  const current=JSON.parse(fs.readFileSync(path.join(dir,'sql-pre-private.json'),'utf8'));
  assert.equal(current.a3_absent,true);
  assert.deepEqual(sorted(current.tables),sorted(before.tables),'BACKUP_DATA_STALE');
  assert.deepEqual(sorted(current.functions.map(f=>[f.name,f.body_md5,f.acl])),sorted(before.functions.map(f=>[f.name,f.body_md5,f.acl])),'BACKUP_SCHEMA_STALE');
  const remoteResult=JSON.parse(ssh(remote+`check_front()\nfiles=json.loads(${JSON.stringify(JSON.stringify(sqlBackup.remoteCopy.remoteFiles))})\n`+String.raw`
for f in files:assert hashlib.sha256(open(stage+'/recovery/'+f['name'],'rb').read()).hexdigest()==f['sha256'],'REMOTE_SQL_BACKUP_CORRUPTED'
sys_path=stage+'/recovery'
import sys
sys.path.insert(0,sys_path)
from asistencia_a3_archive_verify import verify_archive
i=json.loads(subprocess.check_output(['docker','image','inspect',front['image']]))[0]
verified=verify_archive(stage+'/recovery/frontend.tar',front['image'],i['Config'],i['RootFS']['Layers'])
print(json.dumps(dict(verifiedArchive=verified,remoteSqlHashesVerified=True,backendUnchanged=True,overridesUnchanged=True)))
`));
  // Guards dentro de la misma transacción de la migración original.
  const guard=before.tables.map(t=>`IF (SELECT md5(coalesce(string_agg(to_jsonb(r)::text,chr(10) order by to_jsonb(r)::text),'')) FROM public.${t.name} r) <> '${t.md5}' THEN RAISE EXCEPTION 'BACKUP_DATA_STALE_${t.name}'; END IF;`).join('\n');
  const fnGuard=before.functions.map(f=>`IF (SELECT md5(regexp_replace(prosrc,'[[:space:]]','','g')) FROM pg_proc WHERE oid='${f.name}'::regprocedure) IS DISTINCT FROM '${f.body_md5}' THEN RAISE EXCEPTION 'FUNCTION_DRIFT'; END IF;`).join('\n');
  const migration=fs.readFileSync('supabase/migrations/20261029000000_asistencia_a3_intercambios.sql','utf8');
  const guarded=migration.replace('begin;',`begin;\nSET LOCAL timezone='UTC';\nSET LOCAL lock_timeout='2s';\nSET LOCAL statement_timeout='30s';\nLOCK TABLE ${before.tables.map(t=>'public.'+t.name).join(',')} IN SHARE MODE;\nDO $guard$ BEGIN\nIF to_regclass('public.asistencia_intercambios') IS NOT NULL THEN RAISE EXCEPTION 'A3_ALREADY_PRESENT'; END IF;\n${guard}\n${fnGuard}\nEND $guard$;`);
  fs.writeFileSync(path.join(dir,'apply-a3-guarded.sql'),guarded);
  record.preflight={checkedAt:new Date().toISOString(),sourceFiles:files,backupStillCurrent:true,...remoteResult,migrationSha256:sha('supabase/migrations/20261029000000_asistencia_a3_intercambios.sql'),guardedSqlSha256:sha(path.join(dir,'apply-a3-guarded.sql'))};save();
  console.log(JSON.stringify(record.preflight));
 } else if(mode==='apply') {
  assert.equal(record.preflight?.backupStillCurrent,true);
  assert.equal(record.sql?.applied,undefined,'ALREADY_APPLIED');
  assert.equal(sha(path.join(dir,'apply-a3-guarded.sql')),record.preflight.guardedSqlSha256);
  assert.equal(sha('supabase/migrations/20261029000000_asistencia_a3_intercambios.sql'),record.preflight.migrationSha256);
  const out=cp.execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/asistencia-a3-sql-stage.ps1','-Mode','apply'],{encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']});
  assert.ok(out.includes('A3_MIGRATION_COMMITTED'));
  record.sql={applied:true,verified:false,appliedAt:new Date().toISOString()};save();console.log(out.trim());
 } else if(mode==='sql-verify') {
  assert.ok(record.preflight?.backupStillCurrent);
  const after=JSON.parse(fs.readFileSync(path.join(dir,'sql-post-private.json'),'utf8'));
  assert.equal(after.a3_absent,false);assert.deepEqual(sorted(after.tables),sorted(before.tables),'POST_MIGRATION_DATA_CHANGED');
  const source=fs.readFileSync('supabase/migrations/20261029000000_asistencia_a3_intercambios.sql','utf8');
  const expected=new Map([...source.matchAll(/create (?:or replace )?function public\.([a-z0-9_]+)\([^]*?\bas\s+\$\$([^]*?)\$\$;/gi)].map(m=>[m[1],crypto.createHash('md5').update(m[2].replace(/\s/g,'')).digest('hex')]));
  assert.equal(expected.size,7);
  for(const [name,hash] of expected){const f=after.functions.find(f=>f.name.startsWith(name+'('));assert.ok(f,'MISSING_A3_FUNCTION_'+name);assert.equal(f.body_md5,hash,'A3_FUNCTION_MISMATCH_'+name);}
  for(const f of before.functions.filter(f=>!f.name.startsWith('mark_attendance_ingreso(')))assert.equal(after.functions.find(a=>a.name===f.name)?.body_md5,f.body_md5,'PREVIOUS_FUNCTION_CHANGED');
  record.sql={...record.sql,applied:true,verified:true,checkedAt:new Date().toISOString(),functionBodiesMatched:expected.size,previousFunctionsPreserved:before.functions.length-1,dataTablesUnchanged:after.tables.length};
  record.status='PAUSED_AFTER_VERIFIER_FAILURE';record.verifierFailure={cause:'Parser excluded digits in a3 function names',corrected:true,deploymentNotResumed:true};save();console.log(JSON.stringify(record.sql));
 } else if(mode==='prepare-build') {
  assert.equal(record.sql?.verified,true);
  const source=path.join(dir,'source-71944f5');assert.equal(fs.existsSync(source),false,'SOURCE_ALREADY_EXISTS');fs.mkdirSync(source);
  const archive=path.join(dir,'source-71944f5.tar');git('archive','--format=tar','--output='+archive,'71944f5');
  cp.execFileSync('tar.exe',['-xf',archive,'-C',source],{stdio:['ignore','pipe','pipe']});
  const rootEnv=require('dotenv').parse(fs.readFileSync('D:/SmartRayco/.env'));
  const dirs=fs.readdirSync(dir).filter(d=>d.startsWith('restored-assets-')).sort();assert.ok(dirs.length);
  let activeJs='';const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(e.name.endsWith('.js'))activeJs+=fs.readFileSync(p,'utf8');}};walk(path.join(dir,dirs.at(-1)));
  for(const key of ['VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY'])assert.ok(rootEnv[key] && activeJs.includes(rootEnv[key]),'BUILD_ENV_MISMATCH_'+key);
  const custody=[...activeJs.matchAll(/VITE_MATERIAL_CUSTODY_LIVE_SINCE\s*:\s*("(?:\\.|[^"\\])*")/g)].map(m=>JSON.parse(m[1]));
  assert.ok(new Set(custody).size<=1,'CUSTODY_ENV_CONFLICT');
  const env={VITE_SUPABASE_URL:rootEnv.VITE_SUPABASE_URL,VITE_SUPABASE_ANON_KEY:rootEnv.VITE_SUPABASE_ANON_KEY,VITE_MATERIAL_CUSTODY_LIVE_SINCE:custody[0]??''};
  fs.writeFileSync(path.join(source,'.env.production'),Object.entries(env).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n')+'\n');
  record.build={source,sourceArchiveSha256:sha(archive),environmentMatchesActive:true,custodySettingPreserved:true};save();console.log(JSON.stringify(record.build));
 } else if(mode==='build') {
  assert.equal(record.sql?.verified,true);assert.equal(record.build?.environmentMatchesActive,true);
  const vite=path.join(path.dirname(require.resolve('vite/package.json')),'bin/vite.js');
  const out=cp.execFileSync(process.execPath,[vite,'build'],{cwd:record.build.source,encoding:'utf8',timeout:180000,stdio:['ignore','pipe','pipe'],maxBuffer:4*1024*1024});
  fs.writeFileSync(path.join(dir,'production-build.log'),out);
  const dist=path.join(record.build.source,'dist');let js='';const hashes={};const walk=(d,rel='')=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const r=rel?rel+'/'+e.name:e.name,p=path.join(d,e.name);if(e.isDirectory())walk(p,r);else{hashes[r]=sha(p);if(e.name.endsWith('.js'))js+=fs.readFileSync(p,'utf8');}}};walk(dist);
  const markers=['asistencia_intercambio_crear','asistencia_intercambio_cancelar','asistencia_intercambios_resumen','reportar_ausencia_hoy','resolver_ausencia','asistencia_novedad_crear','asistencia_horarios_personales','Solicitar devolución'];
  for(const m of markers)assert.ok(js.includes(m),'BUILD_FEATURE_MISSING_'+m);
  const tar=path.join(dir,'a3-dist.tar');cp.execFileSync('tar.exe',['-cf',tar,'-C',dist,'.'],{stdio:['ignore','pipe','pipe']});
  ssh(remote+"check_front()\nos.makedirs(stage+'/promotion/dist',exist_ok=True)\nprint('{}')\n");
  scp(tar,'root@192.168.55.201:'+stage+'/promotion/dist.tar');
  const result=JSON.parse(ssh(remote+`check_front()\nexpected=json.loads(${JSON.stringify(JSON.stringify(hashes))})\n`+String.raw`
with tarfile.open(stage+'/promotion/dist.tar') as t:
 for member in t.getmembers():assert not member.name.startswith('/') and '..' not in member.name.split('/'),'UNSAFE_BUILD_ARCHIVE'
 t.extractall(stage+'/promotion/dist',filter='data')
for p,h in expected.items():assert hashlib.sha256(open(stage+'/promotion/dist/'+p,'rb').read()).hexdigest()==h,'REMOTE_DIST_HASH_MISMATCH'
assert json.loads(subprocess.check_output(['docker','image','inspect',front['tag']]))[0]['Id']==front['image'],'BASE_IMAGE_DRIFT'
dockerfile='FROM '+front['tag']+'\nCOPY dist/ /usr/share/nginx/html/\n'
open(stage+'/promotion/Dockerfile','w').write(dockerfile)
with open(stage+'/promotion/build.log','w') as log:
 subprocess.check_call(['docker','build','--pull=false','--network=none','-t',image_tag,stage+'/promotion'],stdout=log,stderr=subprocess.STDOUT)
image=json.loads(subprocess.check_output(['docker','image','inspect',image_tag]))[0]
print(json.dumps(dict(tag=image_tag,image=image['Id'],backendUnchanged=True,distFilesVerified=len(expected))))
`));
  record.build={...record.build,...result,distHashes:hashes,markersVerified:markers,compiled:true};save();console.log(JSON.stringify({...result,markersVerified:markers.length}));
 } else throw Error('UNKNOWN_MODE');
}catch(e){console.error('A3_RELEASE_STOPPED '+e.message.split('\n')[0]);if(e.stderr)console.error(String(e.stderr).slice(-1600));process.exitCode=1;}
