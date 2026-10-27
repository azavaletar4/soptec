// Solo respaldos y recuperación LOCAL sin red. No contiene migración ni promoción.
const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const args=['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy')];
const stage='/opt/smartrayco-staging/asistencia-a3-71944f5-20261027T034446Z';
const privateDir=path.resolve('.env.a3-recovery');fs.mkdirSync(privateDir,{recursive:true});
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const baseline=JSON.parse(fs.readFileSync('docs/ASISTENCIA-A3-PREFLIGHT-VM.json','utf8'));
const ssh=p=>cp.execFileSync('ssh',[...args,'root@192.168.55.201','python3 -'],{input:p,encoding:'utf8',timeout:120000,stdio:['pipe','pipe','pipe'],maxBuffer:8*1024*1024});
const scp=(from,to)=>cp.execFileSync('scp',[...args,from,to],{timeout:120000,stdio:['ignore','pipe','pipe']});
const remotePrefix=`import os,json,subprocess,hashlib,sys,shutil\nstage=${JSON.stringify(stage)}\nbaseline=json.loads(${JSON.stringify(JSON.stringify(baseline))})\ndef inspect(name):return json.loads(subprocess.check_output(['docker','inspect',name]))[0]\ndef check():\n out=[]\n for expected in baseline['containers']:\n  c=inspect(expected['name'])\n  assert c['Id']==expected['id'] and c['Image']==expected['image'] and c['State']['StartedAt']==expected['startedAt'] and c['State']['Running'],'LIVE_CONTAINER_DRIFT'\n  out.append(dict(name=c['Name'],id=c['Id'],image=c['Image'],startedAt=c['State']['StartedAt']))\n for p,h in baseline['containers'][0]['composeHashes'].items():assert hashlib.sha256(open(p,'rb').read()).hexdigest()==h,'OVERRIDE_DRIFT'\n return out\ncheck()\n`;
try {
 const mode=process.argv[2];
 if(mode==='verifier-test') {
  scp('scripts/asistencia-a3-archive-verify-test.py','root@192.168.55.201:'+stage+'/recovery/test_archive_verifier.py');
  console.log(ssh(remotePrefix+"print(subprocess.check_output(['python3',stage+'/recovery/test_archive_verifier.py']).decode())"));
 } else if(mode==='image') {
  scp('scripts/asistencia-a3-archive-verify.py','root@192.168.55.201:'+stage+'/recovery/asistencia_a3_archive_verify.py');
  scp('scripts/asistencia-a3-archive-verify-test.py','root@192.168.55.201:'+stage+'/recovery/test_archive_verifier.py');
  const result=JSON.parse(ssh(remotePrefix+String.raw`
sys.path.insert(0,stage+'/recovery')
from asistencia_a3_archive_verify import verify_archive
test=json.loads(subprocess.check_output(['python3',stage+'/recovery/test_archive_verifier.py']))
c=inspect('smartrayco-frontend-1')
image=json.loads(subprocess.check_output(['docker','image','inspect',c['Image']]))[0]
assert image['Id']==c['Image'] and image['Descriptor']['digest']==c['Image'],'LIVE_IMAGE_IDENTITY'
archive=stage+'/recovery/frontend.tar'
verified=verify_archive(archive,c['Image'],image['Config'],image['RootFS']['Layers'])
overrides=[]
for index,p in enumerate(baseline['containers'][0]['composeFiles']):
 target=stage+'/recovery/'+str(index)+'-'+os.path.basename(p)
 shutil.copy2(p,target);os.chmod(target,0o600)
 overrides.append(dict(path=target,sha256=hashlib.sha256(open(target,'rb').read()).hexdigest()))
raw=subprocess.check_output(['docker','exec','smartrayco-frontend-1','find','/usr/share/nginx/html','-type','f','-exec','sha256sum','{}','+']).decode().splitlines()
assets={line.split(None,1)[1].strip().replace('/usr/share/nginx/html/',''):line.split()[0] for line in raw}
print(json.dumps(dict(stage=stage,archive=archive,verification=verified,verifierTests=test,overrides=overrides,assets=assets,containersAfter=check())))
`));
  const local=path.join(privateDir,'frontend.tar');scp('root@192.168.55.201:'+result.archive,local);
  if(hash(local)!==result.verification.archiveSha256)throw Error('PC_ARCHIVE_HASH_MISMATCH');
  for(const file of result.overrides){const target=path.join(privateDir,path.basename(file.path));scp('root@192.168.55.201:'+file.path,target);if(hash(target)!==file.sha256)throw Error('PC_OVERRIDE_HASH_MISMATCH');}
  // Carga real en Docker local; ningún servicio se inicia y no se contacta un registro.
  cp.execFileSync('docker',['image','load','-i',local],{timeout:120000,stdio:['ignore','pipe','pipe']});
  const runtime=result.containersAfter.find(c=>c.name.includes('frontend'));
  const recovered=JSON.parse(cp.execFileSync('docker',['image','inspect',runtime.image],{encoding:'utf8',stdio:['ignore','pipe','pipe']}))[0];
  if(recovered.Id!==runtime.image)throw Error('RECOVERED_IMAGE_ID_MISMATCH');
  const name='a3-recovery-check-'+Date.now();let created=false;
  try {
   cp.execFileSync('docker',['create','--name',name,'--network','none',runtime.image],{stdio:['ignore','pipe','pipe']});created=true;
   const target=path.join(privateDir,'restored-assets-'+Date.now());fs.mkdirSync(target);
   cp.execFileSync('docker',['cp',name+':/usr/share/nginx/html/.',target],{stdio:['ignore','pipe','pipe']});
   const actual={};const walk=(dir,rel='')=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const r=rel?rel+'/'+e.name:e.name;const p=path.join(dir,e.name);if(e.isDirectory())walk(p,r);else if(e.isFile())actual[r]=hash(p);}};walk(target);
   if(JSON.stringify(Object.entries(actual).sort())!==JSON.stringify(Object.entries(result.assets).sort()))throw Error('RECOVERED_ASSETS_MISMATCH');
   result.localRecovery={loaded:true,imageId:recovered.Id,network:'none',containerStarted:false,assetsVerified:Object.keys(actual).length,archiveSha256:hash(local)};
  } finally {if(created)cp.execFileSync('docker',['rm',name],{stdio:['ignore','pipe','pipe']});}
  fs.writeFileSync('docs/ASISTENCIA-A3-IMAGE-BACKUP-VERIFIED.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({archive:result.archive,...result.verification,verifierTests:result.verifierTests,localRecovery:result.localRecovery,backendAndOverridesUnchanged:true}));
 } else if(mode==='sql-copy') {
  const metadata=JSON.parse(fs.readFileSync('docs/ASISTENCIA-A3-SQL-BACKUP-VERIFIED.json','utf8'));
  if(!metadata.restorationVerified)throw Error('SQL_RESTORE_NOT_VERIFIED');
  const files=['asistencia-before.dump','functions-before.sql','sql-before-private.json'].map(name=>({name,local:path.join(privateDir,name)}));
  files.push({name:'asistencia-a3-rollback.sql',local:'scripts/sql/asistencia-a3-rollback.sql'});
  for(const f of files){f.sha256=hash(f.local);scp(f.local,'root@192.168.55.201:'+stage+'/recovery/'+f.name);}
  const result=JSON.parse(ssh(remotePrefix+'files=json.loads('+JSON.stringify(JSON.stringify(files.map(({name,sha256})=>({name,sha256}))))+')\n'+String.raw`
for f in files:
 p=stage+'/recovery/'+f['name'];os.chmod(p,0o600)
 assert hashlib.sha256(open(p,'rb').read()).hexdigest()==f['sha256'],'REMOTE_SQL_BACKUP_HASH_MISMATCH'
print(json.dumps(dict(remoteFiles=files,allRemoteHashesMatch=True,containersAfter=check())))
`));
  metadata.remoteCopy={directory:stage+'/recovery',...result};
  fs.writeFileSync('docs/ASISTENCIA-A3-SQL-BACKUP-VERIFIED.json',JSON.stringify(metadata,null,2)+'\n');
  console.log(JSON.stringify({sqlRemoteCopyVerified:true,fileCount:files.length,allRemoteHashesMatch:result.allRemoteHashesMatch,backendAndOverridesUnchanged:true}));
 } else if(mode==='final-check') {
  const result=JSON.parse(ssh(remotePrefix+'print(json.dumps(dict(containers=check(),backendAndOverridesUnchanged=True)))'));
  fs.writeFileSync('docs/ASISTENCIA-A3-BACKUPS-FINAL-CHECK.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 } else throw Error('UNKNOWN_MODE');
}catch(e){console.error('A3_BACKUP_STOPPED '+e.message.split('\n')[0]);if(e.stderr)console.error(String(e.stderr).slice(-1400));process.exitCode=1;}
