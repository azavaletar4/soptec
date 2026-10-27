// Despliegue visual autorizado: exclusivamente frontend, sin SQL.
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const mode=process.argv[2],dir=path.resolve('.env.a3-recovery'),recordPath='docs/ASISTENCIA-VISUAL-RELEASE.json';
const record=JSON.parse(fs.readFileSync(recordPath,'utf8'));
const front=record.front,back=record.back,stage=record.stage;
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const sorted=rows=>rows.map(r=>JSON.stringify(r)).sort();
const git=(...args)=>cp.execFileSync('git',args,{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const sshArgs=['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy')];
const ssh=code=>cp.execFileSync('ssh',[...sshArgs,'root@192.168.55.201','python3 -'],{input:code,encoding:'utf8',timeout:300000,stdio:['pipe','pipe','pipe'],maxBuffer:8*1024*1024});
const scp=(a,b)=>cp.execFileSync('scp',[...sshArgs,a,b],{timeout:120000,stdio:['ignore','pipe','pipe']});
const remote=`import json,subprocess,hashlib,os,tarfile,datetime,urllib.request\nstage=${JSON.stringify(stage)}\nfront=json.loads(${JSON.stringify(JSON.stringify(front))})\nback=json.loads(${JSON.stringify(JSON.stringify(back))})\nimage_tag=${JSON.stringify(record.imageTag)}\ndef inspect(n):return json.loads(subprocess.check_output(['docker','inspect',n]))[0]\ndef check_back():\n c=inspect('smartrayco-backend-1')\n assert c['Id']==back['id'] and c['Image']==back['image'] and c['State']['StartedAt']==back['startedAt'] and c['State']['Running'],'BACKEND_DRIFT'\n for p,h in front['composeHashes'].items():assert hashlib.sha256(open(p,'rb').read()).hexdigest()==h,'OVERRIDE_DRIFT'\n return c\ndef check_front():\n c=inspect('smartrayco-frontend-1')\n assert c['Id']==front['id'] and c['Image']==front['image'] and c['State']['StartedAt']==front['startedAt'],'FRONTEND_DRIFT'\n return c\ncheck_back()\n`;
function save(){fs.writeFileSync(recordPath,JSON.stringify(record,null,2)+'\n');}
(async()=>{
try {
 if(mode==='prepare-build') {
  assert.equal(record.status,'FRONTEND_AUTHORIZED');

  const source=path.join(dir,'source-233f230');assert.equal(fs.existsSync(source),false,'SOURCE_ALREADY_EXISTS');fs.mkdirSync(source);
  const archive=path.join(dir,'source-233f230.tar');git('archive','--format=tar','--output='+archive,'233f230');
  cp.execFileSync('tar.exe',['-xf',archive,'-C',source],{stdio:['ignore','pipe','pipe']});
  const rootEnv=require('dotenv').parse(fs.readFileSync('D:/SmartRayco/.env'));
  const dirs=fs.readdirSync(dir).filter(d=>d.startsWith('restored-assets-')).sort();assert.ok(dirs.length);
  let activeJs='';const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(e.name.endsWith('.js'))activeJs+=fs.readFileSync(p,'utf8');}};walk(path.join(dir,'restored-assets-visual'));
  for(const key of ['VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY'])assert.ok(rootEnv[key] && activeJs.includes(rootEnv[key]),'BUILD_ENV_MISMATCH_'+key);
  const custody=[...activeJs.matchAll(/"?VITE_MATERIAL_CUSTODY_LIVE_SINCE"?:("[^"]*")/g)].map(m=>JSON.parse(m[1]));
  assert.ok(new Set(custody).size<=1,'CUSTODY_ENV_CONFLICT');
  const env={VITE_SUPABASE_URL:rootEnv.VITE_SUPABASE_URL,VITE_SUPABASE_ANON_KEY:rootEnv.VITE_SUPABASE_ANON_KEY,VITE_MATERIAL_CUSTODY_LIVE_SINCE:custody[0]??''};
  fs.writeFileSync(path.join(source,'.env.production'),Object.entries(env).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n')+'\n');
  record.build={source,sourceArchiveSha256:sha(archive),environmentMatchesActive:true,custodySettingPreserved:true};save();console.log(JSON.stringify(record.build));
 } else if(mode==='build') {
assert.equal(record.build?.environmentMatchesActive,true);
  const vite=path.join(path.dirname(require.resolve('vite/package.json')),'bin/vite.js');
  const out=cp.execFileSync(process.execPath,[vite,'build'],{cwd:record.build.source,encoding:'utf8',timeout:180000,stdio:['ignore','pipe','pipe'],maxBuffer:4*1024*1024});
  fs.writeFileSync(path.join(dir,'production-build.log'),out);
  const dist=path.join(record.build.source,'dist');let js='';const hashes={};const walk=(d,rel='')=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const r=rel?rel+'/'+e.name:e.name,p=path.join(d,e.name);if(e.isDirectory())walk(p,r);else{hashes[r]=sha(p);if(e.name.endsWith('.js'))js+=fs.readFileSync(p,'utf8');}}};walk(dist);
  const markers=['asistencia_intercambio_crear','asistencia_intercambio_cancelar','asistencia_intercambios_resumen','reportar_ausencia_hoy','resolver_ausencia','asistencia_novedad_crear','asistencia_horarios_personales','Solicitar devolución'];
  for(const m of markers)assert.ok(js.includes(m),'BUILD_FEATURE_MISSING_'+m);
  const tar=path.join(dir,'visual-dist.tar');cp.execFileSync('tar.exe',['-cf',tar,'-C',dist,'.'],{stdio:['ignore','pipe','pipe']});
  ssh(remote+"check_front()\nos.makedirs(stage+'/promotion/dist',exist_ok=True)\nprint('{}')\n");
  scp(tar,'root@192.168.55.201:'+stage+'/promotion/dist.tar');
  const result=JSON.parse(ssh(remote+`check_front()\nexpected=json.loads(${JSON.stringify(JSON.stringify(hashes))})\n`+String.raw`
with tarfile.open(stage+'/promotion/dist.tar') as t:
 for member in t.getmembers():assert not member.name.startswith('/') and '..' not in member.name.split('/'),'UNSAFE_BUILD_ARCHIVE'
 t.extractall(stage+'/promotion/dist',filter='data')
for p,h in expected.items():assert hashlib.sha256(open(stage+'/promotion/dist/'+p,'rb').read()).hexdigest()==h,'REMOTE_DIST_HASH_MISMATCH'
assert json.loads(subprocess.check_output(['docker','image','inspect',front['tag']]))[0]['Id']==front['image'],'BASE_IMAGE_DRIFT'
dockerfile='FROM '+front['tag']+chr(10)+'COPY dist/ /usr/share/nginx/html/'+chr(10)
open(stage+'/promotion/Dockerfile','w').write(dockerfile)
with open(stage+'/promotion/build.log','w') as log:
 subprocess.check_call(['docker','build','--pull=false','--network=none','-t',image_tag,stage+'/promotion'],stdout=log,stderr=subprocess.STDOUT)
image=json.loads(subprocess.check_output(['docker','image','inspect',image_tag]))[0]
print(json.dumps(dict(tag=image_tag,image=image['Id'],backendUnchanged=True,distFilesVerified=len(expected))))
`));
  record.build={...record.build,...result,distHashes:hashes,markersVerified:markers,compiled:true};save();console.log(JSON.stringify({...result,markersVerified:markers.length}));
 } else if(mode==='candidate-check') {
  assert.equal(record.build?.compiled,true);assert.equal(record.status,'FRONTEND_AUTHORIZED');
  const result=JSON.parse(ssh(remote+`check_front()\nexpected_image=${JSON.stringify(record.build.image)}\nexpected_files=json.loads(${JSON.stringify(JSON.stringify(record.build.distHashes))})\n`+String.raw`
import io
image=json.loads(subprocess.check_output(['docker','image','inspect',image_tag]))[0]
base_image=json.loads(subprocess.check_output(['docker','image','inspect',front['image']]))[0]
assert image['Id']==expected_image,'CANDIDATE_IMAGE_DRIFT'
assert image['Config']==base_image['Config'],'CANDIDATE_RUNTIME_CONFIG_CHANGED'
assert image['RootFS']['Layers'][:len(base_image['RootFS']['Layers'])]==base_image['RootFS']['Layers'],'CANDIDATE_BASE_LAYERS_CHANGED'
name='a3-front-check-'+str(os.getpid())
created=False
try:
 subprocess.check_output(['docker','create','--name',name,'--network','none',image_tag]);created=True
 raw=subprocess.check_output(['docker','cp',name+':/usr/share/nginx/html/.','-'])
 with tarfile.open(fileobj=io.BytesIO(raw)) as t:
  members={m.name.removeprefix('./').removeprefix('html/'):m for m in t.getmembers() if m.isfile()}
  for p,h in expected_files.items():
   assert p in members,'CANDIDATE_ASSET_MISSING '+p
   assert hashlib.sha256(t.extractfile(members[p]).read()).hexdigest()==h,'CANDIDATE_ASSET_CHANGED '+p
finally:
 if created:subprocess.check_output(['docker','rm',name])
override=stage+'/promotion/frontend.override.json'
with open(override,'w') as f:json.dump(dict(services=dict(frontend=dict(image=image_tag))),f)
files=front['composeFiles']+[override]
cmd=['docker','compose']
for p in front['composeFiles']:cmd+=['-f',p]
old=json.loads(subprocess.check_output(cmd+['config','--format','json'],cwd=front['workingDir']))
new=json.loads(subprocess.check_output(cmd+['-f',override,'config','--format','json'],cwd=front['workingDir']))
assert new['services']['backend']['image']==back['tag'],'BACKEND_OVERRIDE_LOST'
assert new['services']['frontend']['image']==image_tag,'FRONTEND_OVERRIDE_NOT_EFFECTIVE'
config_hash=hashlib.sha256(json.dumps(new,sort_keys=True).encode()).hexdigest()
new['services']['frontend']['image']=old['services']['frontend']['image']
assert new==old,'COMPOSE_CHANGE_OUTSIDE_FRONTEND_IMAGE'
env=dict(e.split('=',1) for e in image['Config'].get('Env',[]))
env.update(old['services']['frontend'].get('environment',{}))
assert env==dict(e.split('=',1) for e in inspect('smartrayco-frontend-1')['Config'].get('Env',[])),'FRONTEND_RUNTIME_ENV_DRIFT'
check_back()
print(json.dumps(dict(image=expected_image,assetsVerified=len(expected_files),runtimeConfigPreserved=True,onlyFrontendImageChanges=True,override=override,overrideSha256=hashlib.sha256(open(override,'rb').read()).hexdigest(),composeFiles=files,effectiveConfigSha256=config_hash)))
`));
  record.candidate=result;record.status='CANDIDATE_VERIFIED';save();console.log(JSON.stringify(result));
 } else if(mode==='promote') {
  assert.equal(record.status,'CANDIDATE_VERIFIED');
  record.status='FRONTEND_PROMOTION_ATTEMPTED';save();
  const result=JSON.parse(ssh(remote+`check_front()\nexpected_image=${JSON.stringify(record.build.image)}\ncandidate=json.loads(${JSON.stringify(JSON.stringify(record.candidate))})\nothers=json.loads(${JSON.stringify(JSON.stringify(record.frontendPreflight.otherContainers))})\n`+String.raw`
def check_others():
 for old in others:
  c=inspect(old['name'])
  assert c['Id']==old['id'] and c['Image']==old['image'] and c['State']['StartedAt']==old['startedAt'],'OTHER_CONTAINER_DRIFT'
check_others()
assert json.loads(subprocess.check_output(['docker','image','inspect',image_tag]))[0]['Id']==expected_image,'CANDIDATE_IMAGE_DRIFT'
assert hashlib.sha256(open(candidate['override'],'rb').read()).hexdigest()==candidate['overrideSha256'],'CANDIDATE_OVERRIDE_DRIFT'
cmd=['docker','compose']
for p in candidate['composeFiles']:cmd+=['-f',p]
config=json.loads(subprocess.check_output(cmd+['config','--format','json'],cwd=front['workingDir']))
assert hashlib.sha256(json.dumps(config,sort_keys=True).encode()).hexdigest()==candidate['effectiveConfigSha256'],'COMPOSE_CONFIG_DRIFT'
assert config['services']['backend']['image']==back['tag'] and config['services']['frontend']['image']==image_tag,'EFFECTIVE_IMAGE_DRIFT'
with open(stage+'/promotion/promote.log','w') as log:
 subprocess.check_call(cmd+['up','-d','--no-build','--no-deps','--pull','never','frontend'],cwd=front['workingDir'],stdout=log,stderr=subprocess.STDOUT)
check_back();check_others()
c=inspect('smartrayco-frontend-1')
assert c['Image']==expected_image and c['Config']['Image']==image_tag and c['State']['Running'],'PROMOTED_FRONTEND_MISMATCH'
print(json.dumps(dict(tag=image_tag,image=c['Image'],id=c['Id'],startedAt=c['State']['StartedAt'],backendId=back['id'],backendStartedAt=back['startedAt'],backendUnchanged=True,otherContainersUnchanged=True,composeFiles=candidate['composeFiles'],promotedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())))
`));
  record.promotion=result;record.status='FRONTEND_PROMOTED_PENDING_HTTP_CHECKS';save();console.log(JSON.stringify(result));
 } else if(mode==='http-verify') {
  assert.ok(record.promotion?.backendUnchanged);
  const results=[];
  for(const p of ['/api/health','/','/asistencia','/campo']) {
   const r=await fetch('https://panel.rayconetworks.com'+p,{signal:AbortSignal.timeout(15000),headers:{'Cache-Control':'no-cache'}});assert.equal(r.status,200,p);const text=await r.text();
   if(p==='/')assert.equal(crypto.createHash('sha256').update(text).digest('hex'),record.build.distHashes['index.html'],'SERVED_INDEX_MISMATCH');
   results.push({path:p,status:r.status});
  }
  const assets=Object.keys(record.build.distHashes).filter(p=>/AsistenciaPanel|AsistenciaView|index-.*\.js$/.test(p));assert.ok(assets.length>=3);
  for(const p of assets){const r=await fetch('https://panel.rayconetworks.com/'+p,{signal:AbortSignal.timeout(15000),headers:{'Cache-Control':'no-cache'}});assert.equal(r.status,200,p);assert.equal(crypto.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex'),record.build.distHashes[p],'SERVED_ASSET_MISMATCH');results.push({path:p,status:200,hashMatches:true});}
  const final=JSON.parse(ssh(remote+`expected_image=${JSON.stringify(record.build.image)}\n`+String.raw`
c=inspect('smartrayco-frontend-1')
assert c['Image']==expected_image and c['State']['Running'],'LIVE_FRONTEND_DRIFT'
check_back()
print(json.dumps(dict(frontendImage=c['Image'],backendUnchanged=True)))
`));
  record.http={checkedAt:new Date().toISOString(),results,...final};record.status='DEPLOYED_TECHNICALLY_VERIFIED';save();console.log(JSON.stringify(record.http));
 } else throw Error('UNKNOWN_MODE');
}catch(e){console.error('VISUAL_RELEASE_STOPPED '+e.message.split('\n')[0]);if(e.stderr)console.error(String(e.stderr).slice(-1600));process.exitCode=1;}
})();
