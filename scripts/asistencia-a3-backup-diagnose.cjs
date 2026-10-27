const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const program=String.raw`import json,subprocess,tarfile,hashlib,os
archive='/opt/smartrayco-staging/asistencia-a3-71944f5-20261027T034446Z/recovery/frontend.tar'
c=json.loads(subprocess.check_output(['docker','inspect','smartrayco-frontend-1']))[0]
i=json.loads(subprocess.check_output(['docker','image','inspect',c['Image']]))[0]
out=dict(containerImage=c['Image'],containerReference=c['Config']['Image'],inspectId=i['Id'],repoDigests=i.get('RepoDigests'),descriptor=i.get('Descriptor'),dockerVersion=subprocess.check_output(['docker','version','--format','{{.Server.Version}}']).decode().strip())
with tarfile.open(archive) as t:
 m=json.load(t.extractfile('manifest.json'))[0]
 raw=t.extractfile(m['Config']).read(); config=json.loads(raw)
 out.update(archiveConfig=m['Config'],archiveConfigHash='sha256:'+hashlib.sha256(raw).hexdigest(),archiveLayerCount=len(m['Layers']),rootfsMatches=i['RootFS']['Layers']==config['rootfs']['diff_ids'],configMatches=i['Config']==config['config'],architectureMatches=i['Architecture']==config['architecture'],osMatches=i['Os']==config['os'],configKeys=list(config),index=json.load(t.extractfile('index.json')) if 'index.json' in t.getnames() else None)
 rawpath='/var/lib/docker/image/overlay2/imagedb/content/sha256/'+i['Id'].split(':')[1]
 out['rawConfigExists']=os.path.isfile(rawpath)
 if os.path.isfile(rawpath):
  original=open(rawpath,'rb').read(); originalJson=json.loads(original)
  out['originalHash']='sha256:'+hashlib.sha256(original).hexdigest()
  out['originalKeys']=list(originalJson)
  out['differentTopLevelKeys']=[k for k in set(originalJson)|set(config) if originalJson.get(k)!=config.get(k)]
print(json.dumps(out))
`;
try{const result=cp.execFileSync('ssh',['-o','BatchMode=yes','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),'root@192.168.55.201','python3 -'],{input:program,encoding:'utf8',timeout:20000,stdio:['pipe','pipe','pipe']});fs.writeFileSync('docs/ASISTENCIA-A3-BACKUP-DIAGNOSIS.json',JSON.stringify(JSON.parse(result),null,2)+'\n');process.stdout.write(result);}catch(e){console.error('READONLY_BACKUP_DIAGNOSIS_FAILED');if(e.stderr)console.error(String(e.stderr).slice(-1200));process.exitCode=1;}
