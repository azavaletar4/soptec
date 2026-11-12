// Solo comprueba respaldos y referencias. Nunca ejecuta compose ni rollback.
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const prep=JSON.parse(fs.readFileSync('deploy/pppoe-20261112/preparation-reproducible.json','utf8'));
const pkg=JSON.parse(fs.readFileSync(prep.package,'utf8'));
const python=`import pathlib,json,hashlib,subprocess
p=pathlib.Path(${JSON.stringify(pkg.stage)})
m=json.loads((p/'built.json').read_text())
def sha(file):
 h=hashlib.sha256()
 with open(file,'rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
assert sha(m['rollback'])==m['rollbackFileHash'],'ROLLBACK_OVERRIDE_DRIFT'
assert sha(p/'source.tar')==m['sourceArchiveHash'],'SOURCE_ARCHIVE_DRIFT'
for file,h in {**m['configurationHashes'],**m['releaseFileHashes']}.items():assert sha(file)==h,'CONFIGURATION_DRIFT'
backups={}
for s,file in m['backupFiles'].items():
 assert sha(file)==m['backupHashes'][s],'BACKUP_DRIFT_'+s
 iid=subprocess.check_output(['docker','image','inspect',m[s+'RollbackTag'],'--format','{{.Id}}'],text=True).strip()
 assert iid==m['before'][s]['image'],'ROLLBACK_TAG_DRIFT_'+s
 backups[s]={'archive':file,'sha256':m['backupHashes'][s],'tag':m[s+'RollbackTag'],'image':iid}
for s,b in m['before'].items():
 c=json.loads(subprocess.check_output(['docker','inspect','smartrayco-'+s+'-1']))[0]
 assert c['State']['Running'],'SERVICE_NOT_RUNNING_'+s
 if s in m['services']:assert c['Image']==m[s+'Image'],'CANDIDATE_IMAGE_DRIFT_'+s
 else:assert c['Id']==b['id'] and c['Image']==b['image'] and c['State']['StartedAt']==b['started'],'OTHER_SERVICE_CHANGED_'+s
assert not(p/'auto-rollback.json').exists(),'AUTOMATIC_ROLLBACK_OCCURRED'
print(json.dumps({'status':'PASS','rollbackExecuted':False,'rollbackOverride':m['rollback'],'backups':backups,'sourceArchiveSha256':m['sourceArchiveHash'],'otherServicesUnchanged':True,'allServicesRunning':True}))
`;
const result=cp.execFileSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh/smartrayco-deploy'),'root@192.168.55.201','python3 -'],{input:python,encoding:'utf8',timeout:60000,windowsHide:true,stdio:['pipe','pipe','pipe']});
const report=JSON.parse(result);
fs.writeFileSync('deploy/pppoe-20261112/rollback-availability.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
