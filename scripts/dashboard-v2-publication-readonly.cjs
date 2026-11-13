// Preparación Dashboard V2: inspect/cp/save por stdout. Sin escrituras remotas,
// solicitudes a Supabase, lecturas de clientes ni conexiones a MikroTik.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),zlib=require('node:zlib'),crypto=require('node:crypto');
const runtime=path.resolve('scripts/inventory-auth-lab/runtime/dashboard-v2-publication');
const ssh=['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),'root@192.168.55.201','python3 -'];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
fs.mkdirSync(runtime,{recursive:true});
const backup=process.argv.includes('--backup');
async function main(){
 if(process.argv.includes('--reconfirm')){
  const live=JSON.parse(fs.readFileSync(path.join(runtime,'baseline.json'),'utf8'));
  const expected={services:live.services,configurationHashes:live.configurationHashes,backendContractHashes:live.backendContractHashes,nginxHashes:live.nginxHashes,site:Object.fromEntries(Object.entries(live.frontendFiles).map(([p,b])=>[p,hash(Buffer.from(b,'base64'))]))};
  const program=String.raw`import subprocess,json,hashlib,tarfile,io,pathlib,datetime
e=json.loads(${JSON.stringify(JSON.stringify(expected))})
run=lambda a:subprocess.check_output(a,stderr=subprocess.PIPE)
sha=lambda b:hashlib.sha256(b).hexdigest()
for name,before in e['services'].items():
 d=json.loads(run(['docker','inspect','smartrayco-'+name+'-1']))[0]
 assert (d['Id'],d['Image'],d['State']['StartedAt'],sha(json.dumps(sorted(d['Config']['Env']),separators=(',',':')).encode()),d['State']['Running'])==(before['id'],before['image'],before['started'],before['environmentHash'],True),'SERVICE_DRIFT_'+name
for p,h in e['configurationHashes'].items():assert sha(pathlib.Path(p).read_bytes())==h,'CONFIG_DRIFT'
for p,h in e['backendContractHashes'].items():assert sha(run(['docker','exec','smartrayco-backend-1','cat','/app/'+p]).replace(b'\r\n',b'\n'))==h,'BACKEND_DRIFT'
for root,expected in [('/usr/share/nginx/html',e['site']),('/etc/nginx',e['nginxHashes'])]:
 with tarfile.open(fileobj=io.BytesIO(run(['docker','cp','smartrayco-frontend-1:'+root+'/.','-']))) as t:
  actual={m.name.removeprefix('./'):sha(t.extractfile(m).read()) for m in t if m.isfile()}
 assert actual==expected,'FRONTEND_FILE_DRIFT'
base=['curl','--silent','--show-error','--max-time','8','--resolve','panel.rayconetworks.com:443:127.0.0.1']
assert json.loads(run(base+['--fail','https://panel.rayconetworks.com/api/health']))['status']=='ok','HEALTH_FAILED'
assert run(base+['--output','/dev/null','--write-out','%{http_code}','https://panel.rayconetworks.com/api/dashboard/pppoe-profiles']).decode()=='401','AUTH_GUARD_FAILED'
print(json.dumps({'status':'PASS','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'allServicesAndFilesUnchanged':True,'health':'ok','pppoeUnauthenticatedStatus':401,'remoteWrites':0,'supabaseRequests':0,'mikrotikRequests':0}))
`;
  const result=JSON.parse(cp.execFileSync('ssh',ssh,{input:program,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:2*1024*1024,stdio:['pipe','pipe','pipe']}));
  fs.writeFileSync('deploy/dashboard-v2-20261112/production-unchanged.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));return;
 }
 if(backup){
  const live=JSON.parse(fs.readFileSync(path.join(runtime,'baseline.json'),'utf8'));
  const target=path.resolve('deploy/dashboard-v2-20261112/frontend-before.image.tar.gz');
  fs.mkdirSync(path.dirname(target),{recursive:true});
  const fd=fs.openSync(target,'wx');
  try{
   const code=String.raw`import json,subprocess,sys,gzip,shutil
d=json.loads(subprocess.check_output(['docker','inspect','smartrayco-frontend-1']))[0]
assert d['Id']==${JSON.stringify(live.services.frontend.id)} and d['Image']==${JSON.stringify(live.services.frontend.image)},'FRONTEND_DRIFT'
p=subprocess.Popen(['docker','save',d['Image']],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
with gzip.GzipFile(fileobj=sys.stdout.buffer,mode='wb',mtime=0) as out:shutil.copyfileobj(p.stdout,out)
assert p.wait()==0,'EXPORT_FAILED'
`;
   const child=cp.spawn('ssh',ssh,{windowsHide:true,stdio:['pipe',fd,'pipe']});child.stdin.end(code);
   child.stderr.resume();
   const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
   if(exit!==0)throw Error('READONLY_EXPORT_FAILED');
  }finally{fs.closeSync(fd);}
  const digest=crypto.createHash('sha256');for await(const b of fs.createReadStream(target))digest.update(b);
  const result={status:'PASS',image:live.services.frontend.image,archive:path.relative(process.cwd(),target).replaceAll('\\','/'),sha256:digest.digest('hex'),bytes:fs.statSync(target).size,remoteWrites:0};
  fs.writeFileSync('deploy/dashboard-v2-20261112/backup.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(result));return;
 }
 const target=path.join(runtime,'baseline.json');
 if(fs.existsSync(target))throw Error('BASELINE_ALREADY_EXISTS');
 const program=String.raw`import subprocess,json,hashlib,tarfile,io,base64,gzip,datetime,pathlib
def run(args):return subprocess.check_output(args,stderr=subprocess.PIPE)
sha=lambda b:hashlib.sha256(b).hexdigest()
def tree(cid,root):
 with tarfile.open(fileobj=io.BytesIO(run(['docker','cp',cid+':'+root+'/.','-']))) as t:
  return {m.name.removeprefix('./'):t.extractfile(m).read() for m in t if m.isfile()}
out={'readOnly':True,'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'services':{}}
configs=set()
for name in ['frontend','backend','caddy','mongo','genieacs']:
 d=json.loads(run(['docker','inspect','smartrayco-'+name+'-1']))[0]
 files=d['Config']['Labels'].get('com.docker.compose.project.config_files','').split(',')
 out['services'][name]={'id':d['Id'],'image':d['Image'],'tag':d['Config']['Image'],'running':d['State']['Running'],'started':d['State']['StartedAt'],'composeFiles':files,'environmentHash':sha(json.dumps(sorted(d['Config']['Env']),separators=(',',':')).encode())}
 if name in ['frontend','backend']:configs.update(files)
front=tree(out['services']['frontend']['id'],'/usr/share/nginx/html')
out['frontendManifest']=json.loads(front['release-manifest.json'])
out['frontendFiles']={p:base64.b64encode(b).decode() for p,b in front.items()}
out['nginxHashes']={p:sha(b) for p,b in tree(out['services']['frontend']['id'],'/etc/nginx').items()}
out['configurationHashes']={p:sha(pathlib.Path(p).read_bytes()) for p in sorted(configs|{'/opt/smartrayco/.env'})}
out['backendContractHashes']={}
for p in ['server/src/routes/dashboard.ts','server/src/services/dashboardPppoeProfiles.ts','server/src/services/dashboardPppoeHandler.ts','src/lib/pppoeProfileCounts.ts','package-lock.json']:
 b=run(['docker','exec',out['services']['backend']['id'],'cat','/app/'+p]);out['backendContractHashes'][p]=sha(b.replace(b'\r\n',b'\n'))
print(base64.b64encode(gzip.compress(json.dumps(out).encode())).decode())
`;
 const raw=cp.execFileSync('ssh',ssh,{input:program,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:100*1024*1024,stdio:['pipe','pipe','pipe']});
 const live=JSON.parse(zlib.gunzipSync(Buffer.from(raw.trim(),'base64')));
 const expected=JSON.parse(fs.readFileSync('deploy/pppoe-20261112/publication-result.json','utf8'));
 if(!live.readOnly||Object.values(live.services).some(s=>!s.running))throw Error('SERVICES_NOT_RUNNING');
 for(const [name,service]of Object.entries(live.services))if(service.image!==expected.services[name].image)throw Error('PRODUCTION_IMAGE_DRIFT_'+name);
 if(live.frontendManifest.commit!==expected.sourceCommit)throw Error('FRONTEND_COMMIT_DRIFT');
 for(const [p,h]of Object.entries(live.frontendManifest.artifacts))if(hash(Buffer.from(live.frontendFiles[p],'base64'))!==h)throw Error('ACTIVE_ASSET_DRIFT');
 for(const [p,h]of Object.entries(live.backendContractHashes)){
  const bytes=cp.execFileSync('git',['show',expected.sourceCommit+':'+p],{maxBuffer:16*1024*1024});
  if(hash(bytes.toString().replaceAll('\r\n','\n'))!==h)throw Error('BACKEND_CONTRACT_DRIFT_'+p);
 }
 fs.writeFileSync(target,JSON.stringify(live),{flag:'wx'});
 const summary={status:'PASS',readOnly:true,at:live.at,services:live.services,frontendManifest:live.frontendManifest,nginxHashes:live.nginxHashes,configurationHashes:live.configurationHashes,backendContractHashes:live.backendContractHashes,remoteWrites:0,supabaseRequests:0,mikrotikRequests:0};
 fs.mkdirSync('deploy/dashboard-v2-20261112',{recursive:true});
 fs.writeFileSync('deploy/dashboard-v2-20261112/production-baseline.json',JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:'PASS',readOnly:true,frontendCommit:live.frontendManifest.commit,images:Object.fromEntries(Object.entries(live.services).map(([n,s])=>[n,s.image])),artifacts:Object.keys(live.frontendManifest.artifacts).length,remoteWrites:0}));
}
main().catch(error=>{console.error(JSON.stringify({status:'STOPPED',reason:/^[A-Z0-9_]+$/.test(error.message)?error.message:'READONLY_OPERATION_FAILED',remoteWrites:0}));process.exitCode=1;});
