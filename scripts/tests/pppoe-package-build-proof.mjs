// Comprueba builds y respaldos LOCALES; exportaciones TAR canonicas de software.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const base='deploy/pppoe-20261112';
const runtime='scripts/inventory-auth-lab/runtime/pppoe-publication';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const original=read(base+'/preparation.json');
const run=(bin,args)=>execFileSync(bin,args,{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe']});
const context=run('docker',['context','show']).trim();
const endpoint=JSON.parse(run('docker',['context','inspect',context]))[0].Endpoints.docker.Host;
assert.match(endpoint,/^(npipe:|unix:|tcp:\/\/(?:127\.0\.0\.1|localhost):)/);
const python=String.raw`import sys,pathlib,json,tarfile,hashlib,io,subprocess
run=pathlib.Path(sys.argv[1]);epoch=int(sys.argv[2]);prep=json.loads((run/'evidence/preparation.json').read_text())
def inspect(cid,root):
 raw=subprocess.check_output(['docker','cp',cid+':'+root+'/.','-'])
 with tarfile.open(fileobj=io.BytesIO(raw)) as t:return {m.name.removeprefix('./'):t.extractfile(m).read() for m in t if m.isfile()}
def image_files(image,roots):
 cid=subprocess.check_output(['docker','create','--network','none',image],text=True).strip()
 try:return {prefix+p:b for prefix,root in roots for p,b in inspect(cid,root).items()}
 finally:subprocess.check_call(['docker','rm',cid],stdout=subprocess.DEVNULL)
def digest(files):
 hashes={p:hashlib.sha256(b).hexdigest() for p,b in sorted(files.items())}
 return hashlib.sha256(json.dumps(hashes,separators=(',',':')).encode()).hexdigest()
def export(files,name):
 target=run/name
 with tarfile.open(target,'w',format=tarfile.PAX_FORMAT) as t:
  for p,b in sorted(files.items()):
   info=tarfile.TarInfo(p);info.size=len(b);info.mode=0o644;info.uid=info.gid=0;info.mtime=epoch;t.addfile(info,io.BytesIO(b))
 return hashlib.sha256(target.read_bytes()).hexdigest()
front=image_files(prep['candidateImages']['frontend'],[('','/usr/share/nginx/html')])
back=image_files(prep['candidateImages']['backend'],[('server/src/','/app/server/src'),('src/','/app/src')])
frontdisk={str(p.relative_to(run/'build/linux-canonical/dist')).replace('\\','/'):p.read_bytes() for p in (run/'build/linux-canonical/dist').rglob('*') if p.is_file()}
repro={str(p.relative_to(run/'build/linux-repro/dist')).replace('\\','/'):p.read_bytes() for p in (run/'build/linux-repro/dist').rglob('*') if p.is_file()}
assert front==frontdisk==repro,'IMAGE_AND_BUILD_DIFFER'
print(json.dumps({'frontendTreeSha256':digest(front),'backendTreeSha256':digest(back),'frontendExportTarSha256':export(front,'frontend-artifacts.tar'),'backendExportTarSha256':export(back,'backend-sources.tar'),'frontendFiles':len(front),'backendFiles':len(back),'imageMatchesBothFrontendBuilds':True}))`;
const epoch=run('git',['show','-s','--format=%ct',original.sourceCommit]).trim();
const attempts=[];
for(const name of ['repack-run1','repack-run2']){
 const folder=path.join(runtime,name);
 const prep=read(path.join(folder,'evidence/preparation.json'));
 assert.equal(prep.sourceCommit,original.sourceCommit);
 assert.deepEqual(prep.before,original.before);
 assert.deepEqual(prep.services,['backend','frontend']);
 assert.deepEqual(prep.backendSourceHashes,original.backendSourceHashes);
 assert.deepEqual(prep.backupImages,original.backupImages);
 assert.deepEqual(prep.rollbackImages,original.rollbackImages);
 assert.equal(prep.scopeSha256,original.scopeSha256);
 assert.equal(prep.linkerProofSha256,original.linkerProofSha256);
 assert.equal(prep.frontendReleaseManifestSha256,original.frontendReleaseManifestSha256);
 assert.equal(prep.backendGlobalTypeDiagnosticsUnchanged,true);
 assert.equal(prep.backendProductionTypesPassed,true);
 const pkg=read(prep.package);
 for(const [name,value]of Object.entries(pkg.files))assert.equal(hash(fs.readFileSync(path.join(path.dirname(prep.package),name))),value);
 for(const backup of Object.values(prep.backupImages))assert.equal(hash(fs.readFileSync(backup.archive)),backup.sha256);
 const proof=JSON.parse(run('python',['-c',python,folder,epoch]));
 assert.equal(proof.frontendTreeSha256,'f0485fb7e25a565cb916f43c65b35859ee7de721132862baa8b30c5c653b0fa1');
 assert.equal(proof.backendTreeSha256,'1ae06259d11f39e83d2ff6b0985796ede35bc5bce8ade87fe4444ec3cdef04a8');
 attempts.push({run:name,packageSha256:prep.packageSha256,packageFiles:pkg.files,candidateImages:prep.candidateImages,...proof});
}
for(const field of ['packageSha256','packageFiles','frontendTreeSha256','backendTreeSha256','frontendExportTarSha256','backendExportTarSha256'])assert.deepEqual(attempts[0][field],attempts[1][field],'NON_REPRODUCIBLE:'+field);
const revised=read(runtime+'/repack-run2/evidence/preparation.json');
// Se conserva preparation.json original; el nuevo paquete tiene evidencia separada.
fs.writeFileSync(base+'/preparation-reproducible.json',JSON.stringify(revised,null,2)+'\n');
const report={status:'PASS',localOnly:true,sourceCommit:original.sourceCommit,services:['backend','frontend'],
 attempts,scopeUnchanged:true,originalProofTreesUnchanged:true,backupsUnchangedAndVerified:true,
 originalPreparationRetained:true,originalRollbackRetained:true,productionAccessed:false,productionWrites:0,supabaseWrites:0,mikrotikRequests:0};
fs.writeFileSync(base+'/build-reproducibility.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:'PASS',attempts:attempts.length,...attempts[0],report:base+'/build-reproducibility.json'}));
