const cp = require('node:child_process');
const path = require('node:path');
const program = String.raw`import json,subprocess,datetime,os,hashlib
containers=json.loads(subprocess.check_output(['docker','inspect','smartrayco-frontend-1','smartrayco-backend-1']))
out=[]
for c in containers:
 labels=c['Config'].get('Labels') or {}
 files=labels.get('com.docker.compose.project.config_files','').split(',')
 cmd=['docker','compose']
 for f in files: cmd+=['-f',f]
 cmd+=['config','--format','json']
 config=json.loads(subprocess.check_output(cmd,cwd=labels.get('com.docker.compose.project.working_dir')))
 digests={f:hashlib.sha256(open(f,'rb').read()).hexdigest() for f in files}
 out.append(dict(name=c['Name'],id=c['Id'],image=c['Image'],tag=c['Config']['Image'],startedAt=c['State']['StartedAt'],running=c['State']['Running'],composeFiles=files,composeHashes=digests,workingDir=labels.get('com.docker.compose.project.working_dir'),effectiveImages={k:v.get('image') for k,v in config['services'].items() if k in ['backend','frontend']}))
archive='/opt/smartrayco-staging/asistencia-a2-full-20261027T000500Z/recovery/frontend.tar'
print(json.dumps(dict(checkedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),containers=out,previousA2Recovery=dict(path=archive,exists=os.path.isfile(archive),bytes=os.path.getsize(archive) if os.path.isfile(archive) else None),readOnly=True)))
`;
try {
 const result=cp.execFileSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),'root@192.168.55.201','python3 -'],{input:program,encoding:'utf8',timeout:25000,stdio:['pipe','pipe','pipe']});
 require('node:fs').writeFileSync('docs/ASISTENCIA-A3-PREFLIGHT-VM.json',JSON.stringify(JSON.parse(result),null,2)+'\n');
 process.stdout.write(result);
} catch (e) { console.error('READ_ONLY_SSH_FAILED '+(e.code||e.status));process.exitCode=1; }
