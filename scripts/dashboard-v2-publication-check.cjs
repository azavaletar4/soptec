// Reconfirmación de publicación por solo lectura. No cambia el paquete sellado.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve('deploy/dashboard-v2-20261112');
const mode=process.argv[2]||'before';
if(!['before','after','rollback'].includes(mode))throw Error('INVALID_MODE');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const expectedPackage='0b790f14b694571f21a5c5c6d2f32661d3e09d57ab3f5c43b846bc2db9765787';
const bytes=fs.readFileSync(path.join(root,'package.json'));
if(hash(bytes)!==expectedPackage)throw Error('APPROVED_PACKAGE_DRIFT');
const pkg=JSON.parse(bytes);
if(JSON.stringify(pkg.services)!=='["frontend"]'||pkg.backendSources.length)throw Error('SCOPE_DRIFT');
for(const [name,h]of Object.entries(pkg.files)){
 if(path.basename(name)!==name||hash(fs.readFileSync(path.join(root,name)))!==h)throw Error('PACKAGE_FILE_DRIFT');
}
const baseline=JSON.parse(fs.readFileSync(path.join(root,'production-baseline.json'),'utf8'));
const plan=JSON.parse(fs.readFileSync(path.join(root,'deployment-plan.json'),'utf8'));
const output=path.join(root,'publication-'+mode+'.json');if(fs.existsSync(output))throw Error('EVIDENCE_ALREADY_EXISTS');
const input=JSON.stringify({baseline,plan,mode});
const program=String.raw`import subprocess,json,hashlib,tarfile,io,pathlib,datetime
e=json.loads(${JSON.stringify(input)});baseline=e['baseline'];plan=e['plan'];mode=e['mode']
run=lambda a:subprocess.check_output(a,stderr=subprocess.PIPE)
sha=lambda b:hashlib.sha256(b).hexdigest()
states={}
for name,old in baseline['services'].items():
 d=json.loads(run(['docker','inspect','smartrayco-'+name+'-1']))[0]
 env=sha(json.dumps(sorted(d['Config']['Env']),separators=(',',':')).encode())
 assert d['State']['Running'] and env==old['environmentHash'],'SERVICE_ENVIRONMENT_DRIFT_'+name
 if name!='frontend' or mode=='before':
  assert (d['Id'],d['Image'],d['State']['StartedAt'])==(old['id'],old['image'],old['started']),'SERVICE_DRIFT_'+name
 else:assert d['Image']==(plan['candidateImage'] if mode=='after' else plan['beforeImage']),'FRONTEND_IMAGE_DRIFT'
 states[name]={'id':d['Id'],'image':d['Image'],'started':d['State']['StartedAt'],'running':True}
for p,h in baseline['configurationHashes'].items():assert sha(pathlib.Path(p).read_bytes())==h,'CONFIG_DRIFT'
for p,h in baseline['backendContractHashes'].items():assert sha(run(['docker','exec','smartrayco-backend-1','cat','/app/'+p]).replace(b'\r\n',b'\n'))==h,'BACKEND_SOURCE_DRIFT'
def tree(root):
 with tarfile.open(fileobj=io.BytesIO(run(['docker','cp','smartrayco-frontend-1:'+root+'/.','-']))) as t:
  return {m.name.removeprefix('./'):sha(t.extractfile(m).read()) for m in t if m.isfile()}
assert tree('/usr/share/nginx/html')==(plan['candidateSiteHashes'] if mode=='after' else plan['beforeSiteHashes']),'FRONTEND_TREE_DRIFT'
assert tree('/etc/nginx')==baseline['nginxHashes'],'NGINX_DRIFT'
base=['curl','--silent','--show-error','--max-time','8','--resolve','panel.rayconetworks.com:443:127.0.0.1']
assert json.loads(run(base+['--fail','https://panel.rayconetworks.com/api/health']))['status']=='ok','HEALTH_FAILED'
manifest=json.loads(run(base+['--fail','https://panel.rayconetworks.com/release-manifest.json']))
assert manifest['commit']==(plan['sourceCommit'] if mode=='after' else plan['baseCommit']),'PUBLIC_COMMIT_DRIFT'
statuses={}
for route in ['/api/dashboard/pppoe-profiles','/api/dashboard/network-status','/api/dashboard/olt-summary']:
 statuses[route]=int(run(base+['--output','/dev/null','--write-out','%{http_code}','https://panel.rayconetworks.com'+route]))
 assert statuses[route]==401,'AUTH_GUARD_FAILED'
print(json.dumps({'status':'PASS','mode':mode,'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'services':states,'frontendCommit':manifest['commit'],'allFilesAndConfigurationVerified':True,'backendAndOtherServicesUnchanged':True,'health':'ok','authenticationGuards':statuses,'productionMutations':0,'supabaseRequests':0,'mikrotikRequests':0}))
`;
try{
 const raw=cp.execFileSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),'root@192.168.55.201','python3 -'],{input:program,encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024,windowsHide:true,stdio:['pipe','pipe','pipe']});
 const result=JSON.parse(raw);fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
}catch(error){
 const reason=String(error.stderr||'').match(/AssertionError: ([A-Z0-9_]+)/)?.[1]||'READONLY_RECONFIRMATION_FAILED';
 console.error(JSON.stringify({status:'STOPPED',mode,reason,productionMutations:0}));process.exitCode=1;
}
