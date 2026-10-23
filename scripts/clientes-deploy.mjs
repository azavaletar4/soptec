// Ejecutar sólo con autorización de despliegue. Publica el tar aprobado, sin rebuild del workspace.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const action=process.argv[2];assert.ok(['preflight','prepare','activate','verify'].includes(action));
const artifact=JSON.parse(fs.readFileSync('docs/CLIENTES-ARTEFACTO.json','utf8'));
const backup=JSON.parse(fs.readFileSync('docs/CLIENTES-RESPALDO.json','utf8'));
const before=JSON.parse(fs.readFileSync(path.join(backup.pcBackup,'manifest.json'),'utf8'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(artifact.frontendArchive.sha256,'e3b07dba31b7f5b4796e0157e93fa3e903b88d63e3f4d50fe6d1674351d833b2');
assert.equal(hash(fs.readFileSync(artifact.frontendArchive.file)),artifact.frontendArchive.sha256);
for(const f of artifact.files){
  assert.equal(hash(fs.readFileSync(f.file)),f.sha256,'WORKSPACE_SOURCE_DIVERGENCE: '+f.file);
  const committed=cp.execFileSync('git',['show','2f25873:'+f.file],{encoding:'utf8'});
  assert.equal(fs.readFileSync(f.file,'utf8').replaceAll('\r\n','\n'),committed.replaceAll('\r\n','\n'),'UNAPPROVED_SOURCE');
}
for(const [name,meta]of Object.entries(before.files))assert.equal(hash(fs.readFileSync(path.join(backup.pcBackup,name))),meta.sha256,'PC_BACKUP_DIVERGENCE');
const input={action,stage:backup.vmStage,artifact,before,stagedHashes:backup.stagedHashes,revision:'2f25873',imageTag:'smartrayco-frontend:clientes-2f25873-e3b07db'};
let code='import json\nEXPECTED=json.loads('+JSON.stringify(JSON.stringify(input))+')\n';
code+=fs.readFileSync('scripts/tests/clientes-deploy-vm.py','utf8');
const key=path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy');
const result=cp.spawnSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',key,'root@192.168.55.201','python3 -'],{input:code,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:3*1024*1024});
if(result.status!==0){fs.writeFileSync('scripts/inventory-auth-lab/runtime/clientes-deploy-error-private.log',result.stderr+'\n'+result.stdout);throw Error('CLIENTES_'+action.toUpperCase()+'_FAILED; see private log; no further action');}
const report=JSON.parse(result.stdout);
fs.writeFileSync('scripts/inventory-auth-lab/runtime/clientes-deploy-'+action+'.json',JSON.stringify(report,null,2)+'\n');
if(action==='activate'||action==='verify')fs.writeFileSync('docs/CLIENTES-DESPLIEGUE-'+action.toUpperCase()+'.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
