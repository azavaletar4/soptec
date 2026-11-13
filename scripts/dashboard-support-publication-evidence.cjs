// Recoge estado del despliegue y rollback. Solo inspect/logs/cat/hash remotos.
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const root='deploy/dashboard-support-prospects-20261113',pkg=JSON.parse(fs.readFileSync(root+'/package.json','utf8'));
const plan=JSON.parse(fs.readFileSync(root+'/deployment-plan.json','utf8'));
const program=String.raw`import subprocess,pathlib,json,hashlib,datetime,re
stage=pathlib.Path(${JSON.stringify(pkg.stage)})
expected='2e085a576d5c7a4914bd6584d328b65da51ea4bb93497aedbdd41edf2f552410'
sha=lambda b:hashlib.sha256(b).hexdigest()
assert sha((stage/'package.json').read_bytes())==expected,'PACKAGE_DRIFT'
pkg=json.loads((stage/'package.json').read_text())
for p,h in pkg['files'].items():assert sha((stage/p).read_bytes())==h,'PACKAGE_MEMBER_DRIFT'
run=lambda a:subprocess.check_output(a,stderr=subprocess.PIPE)
front=json.loads(run(['docker','inspect','smartrayco-frontend-1']))[0]
assert front['Image']==${JSON.stringify(plan.candidateImage)} and front['State']['Running'],'FRONTEND_NOT_RUNNING'
rollback=json.loads(run(['docker','image','inspect',${JSON.stringify(plan.rollbackTag)}]))[0]
assert rollback['Id']==${JSON.stringify(plan.beforeImage)},'ROLLBACK_TAG_DRIFT'
application=json.loads((stage/'apply-result.json').read_text())
assert application['status']=='PASS' and application['frontendImage']==front['Image'],'APPLICATION_RESULT_DRIFT'
logs=subprocess.run(['docker','logs','--since',front['State']['StartedAt'],'smartrayco-frontend-1'],capture_output=True,text=True,check=True)
critical=sum(bool(re.search(r'\[(?:emerg|alert|crit)\]',line,re.I)) for line in (logs.stdout+'\n'+logs.stderr).splitlines())
assert critical==0,'CRITICAL_NGINX_ERRORS'
print(json.dumps({'status':'PASS','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'application':application,'frontend':{'id':front['Id'],'image':front['Image'],'running':front['State']['Running'],'started':front['State']['StartedAt']},'rollback':{'available':True,'image':rollback['Id'],'tag':${JSON.stringify(plan.rollbackTag)},'archive':str(stage/'frontend-before.image.tar.gz'),'archiveSha256':pkg['files']['frontend-before.image.tar.gz'],'executed':False},'packageSha256':expected,'sourceTarSha256':pkg['files']['source.tar'],'frontendTarSha256':pkg['files']['frontend-artifacts.tar'],'criticalNginxErrors':critical,'productionReadOnly':True}))
`;
try{
 const raw=cp.execFileSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),'root@192.168.55.201','python3 -'],{input:program,encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024,windowsHide:true,stdio:['pipe','pipe','pipe']});
 const data=JSON.parse(raw);fs.writeFileSync(root+'/publication-result.json',JSON.stringify(data,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(data));
}catch(error){const reason=String(error.stderr||'').match(/AssertionError: ([A-Z_]+)/)?.[1]||'READONLY_EVIDENCE_FAILED';console.error(JSON.stringify({status:'STOPPED',reason}));process.exitCode=1;}
