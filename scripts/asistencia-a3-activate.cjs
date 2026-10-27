// Activación autorizada: solo imagen frontend 71944f5; detiene ante cualquier drift.
const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const action=process.argv[2];
const privateDir=path.resolve('.env.a3-recovery');fs.mkdirSync(privateDir,{recursive:true});
const recordPath='docs/ASISTENCIA-A3-ACTIVATION.json';
const baseline=JSON.parse(fs.readFileSync('docs/ASISTENCIA-A3-PREFLIGHT-VM.json','utf8'));
const oldFront=baseline.containers.find(c=>c.name.includes('frontend'));
const oldBack=baseline.containers.find(c=>c.name.includes('backend'));
const record=fs.existsSync(recordPath)?JSON.parse(fs.readFileSync(recordPath,'utf8')):{commit:'71944f5',stage:'/opt/smartrayco-staging/asistencia-a3-71944f5-'+new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z'),backendBefore:oldBack,frontendBefore:oldFront};
const sshArgs=['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy')];
const remote=program=>cp.execFileSync('ssh',[...sshArgs,'root@192.168.55.201','python3 -'],{input:program,encoding:'utf8',timeout:300000,stdio:['pipe','pipe','pipe'],maxBuffer:4*1024*1024});
const prelude=`import json,subprocess,os,hashlib,tarfile,shutil,datetime\nstage=${JSON.stringify(record.stage)}\nexpected_back=json.loads(${JSON.stringify(JSON.stringify(oldBack))})\nexpected_front=json.loads(${JSON.stringify(JSON.stringify(oldFront))})\ndef inspect(name): return json.loads(subprocess.check_output(['docker','inspect',name]))[0]\ndef check_back():\n c=inspect('smartrayco-backend-1')\n assert c['Id']==expected_back['id'] and c['Image']==expected_back['image'] and c['State']['StartedAt']==expected_back['startedAt'] and c['State']['Running'], 'BACKEND_DRIFT'\n for f,h in expected_front['composeHashes'].items(): assert hashlib.sha256(open(f,'rb').read()).hexdigest()==h,'OVERRIDE_DRIFT'\n return c\ncheck_back()\n`;
function save(){fs.writeFileSync(recordPath,JSON.stringify(record,null,2)+'\n');}
const verifierPrelude='verifier_ns={}\nexec('+JSON.stringify(fs.readFileSync('scripts/asistencia-a3-archive-verify.py','utf8'))+',verifier_ns)\n';
try {
 if(action==='backup') {
  const result=JSON.parse(remote(prelude+verifierPrelude+String.raw`
f=inspect('smartrayco-frontend-1')
assert f['Id']==expected_front['id'] and f['Image']==expected_front['image'],'FRONTEND_DRIFT'
os.makedirs(stage+'/recovery',mode=0o700,exist_ok=True)
os.chmod(stage,0o700);os.chmod(stage+'/recovery',0o700)
tag='smartrayco-asistencia-a3-rollback:'+os.path.basename(stage)
subprocess.check_call(['docker','tag',f['Image'],tag])
archive=stage+'/recovery/frontend.tar'
subprocess.check_call(['docker','image','save','-o',archive,tag])
image=json.loads(subprocess.check_output(['docker','image','inspect',f['Image']]))[0]
assert image['Id']==f['Image'] and image['Descriptor']['digest']==f['Image'],'LIVE_IMAGE_IDENTITY'
verified=verifier_ns['verify_archive'](archive,f['Image'],image['Config'],image['RootFS']['Layers'])
for index,p in enumerate(expected_front['composeFiles']): shutil.copy2(p,stage+'/recovery/'+str(index)+'-'+os.path.basename(p))
private_config=json.loads(subprocess.check_output(['docker','inspect','smartrayco-frontend-1','smartrayco-backend-1']))
with open(stage+'/recovery/containers-private.json','w') as out: json.dump(private_config,out)
os.chmod(stage+'/recovery/containers-private.json',0o600)
images=subprocess.check_output(['docker','image','ls','--format','{{.Repository}}:{{.Tag}}']).decode().splitlines()
builders=[i for i in images if 'asistencia-a2' in i and 'build' in i]
print(json.dumps(dict(archive=archive,archiveSha256=verified['archiveSha256'],verification=verified,rollbackTag=tag,builders=builders,backendUnchanged=True)))
`));
  const local=path.join(privateDir,'frontend.tar');
  cp.execFileSync('scp',[...sshArgs,'root@192.168.55.201:'+result.archive,local],{stdio:['ignore','pipe','pipe'],timeout:120000});
  if(crypto.createHash('sha256').update(fs.readFileSync(local)).digest('hex')!==result.archiveSha256)throw Error('LOCAL_BACKUP_HASH_MISMATCH');
  record.backup={...result,localCopyVerified:true};save();console.log(JSON.stringify(record.backup));
 } else if(action==='discover') {
  console.log(remote(prelude+String.raw`
images=subprocess.check_output(['docker','image','ls','--format','{{.Repository}}:{{.Tag}}']).decode().splitlines()
out=[]
for tag in images:
 if 'asistencia' in tag and ('build' in tag or 'base' in tag):
  info=json.loads(subprocess.check_output(['docker','image','inspect',tag]))[0]
  out.append(dict(tag=tag,id=info['Id'],envKeys=[e.split('=',1)[0] for e in info['Config'].get('Env',[]) if e.startswith('VITE_')]))
print(json.dumps(out))
`));
 } else throw Error('UNKNOWN_ACTION');
} catch(e) {console.error('A3_STOPPED '+e.message.split('\n')[0]);if(e.stderr)console.error(String(e.stderr).slice(-1500));process.exitCode=1;}
