// Comprueba paquetes/respaldo local. --built solo LEE built.json de la VM
// despues de una construccion futura autorizada; nunca publica ni revierte.
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const base=path.resolve('deploy/pppoe-20261112'),runtime=path.resolve('scripts/inventory-auth-lab/runtime/pppoe-publication');
const localOnly=process.argv.includes('--local');
if(localOnly&&process.argv.includes('--built'))throw Error('LOCAL_CANNOT_VERIFY_REMOTE_BUILD');
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const tree=folder=>{const files={};const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())walk(p);else files[path.relative(folder,p).replaceAll('\\','/')]=hash(fs.readFileSync(p));}};walk(folder);return files;};
const digest=map=>hash(JSON.stringify(Object.fromEntries(Object.entries(map).sort(([a],[b])=>a<b?-1:a>b?1:0))));
const prepIndex=process.argv.indexOf('--preparation');
const prep=json(prepIndex<0?path.join(base,'preparation.json'):process.argv[prepIndex+1]),scope=json(path.join(base,'scope.json'));
assert.equal(hash(fs.readFileSync(path.join(base,'scope.json'))),prep.scopeSha256);
assert.equal(hash(fs.readFileSync(path.join(base,'linker-proof.json'))),prep.linkerProofSha256);
assert.equal(hash(fs.readFileSync(prep.package)),prep.packageSha256);
const pkg=json(prep.package),packageDir=path.dirname(prep.package);
for(const[file,value]of Object.entries(pkg.files))assert.equal(hash(fs.readFileSync(path.join(packageDir,file))),value,'PACKAGE_DRIFT:'+file);
assert.deepEqual(pkg.scope,scope);assert.deepEqual(prep.services,['backend','frontend']);
assert.equal(scope.backendSources.length,4);assert.equal(scope.frontendSources.length,3);
const input=json(path.join(packageDir,'input.json'));
assert.equal(input.commit,prep.sourceCommit);assert.ok(!scope.backendEnvironment);
if(prepIndex>=0){
 const original=json(path.join(base,'preparation.json'));
 const oldInput=json(path.join(path.dirname(original.package),'input.json'));
 const payload=({stage,toolHash,...rest})=>rest;
 assert.deepEqual(payload(input),payload(oldInput),'UNEXPECTED_INPUT_CONTENT_CHANGE');
 assert.deepEqual(Object.keys(pkg.files),['source.tar','input.json']);
}
for(const service of ['backend','frontend'])assert.equal(hash(fs.readFileSync(prep.backupImages[service].archive)),prep.backupImages[service].sha256,'IMAGE_BACKUP_DRIFT');
const expectedFrontend=tree(path.join(runtime,'linux-canonical/dist'));
const expectedBackend=tree(path.join(runtime,'candidate-backend-image'));
let stateUnchanged=null,builtReproducesLocalProof=null;
if(process.argv.includes('--built')){
 assert.match(input.stage,/^\/opt\/smartrayco-staging\/frontend-consolidado-tr069-[a-f0-9]{7}-[a-f0-9]{10}$/);
 const code='import json\nm=json.load(open('+JSON.stringify(input.stage+'/built.json')+'))\nprint(json.dumps({k:m[k] for k in ["services","frontendCommit","before","assets","backendSources","expectedBackendEnvironmentHashes","oldBackendEnvironmentHashes"]}))\n';
 const result=cp.execFileSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),'root@192.168.55.201','python3 -'],{input:code,encoding:'utf8',timeout:30000,windowsHide:true,stdio:['pipe','pipe','pipe'],maxBuffer:4*1024*1024});
 const built=JSON.parse(result);assert.deepEqual(built.services,prep.services);assert.equal(built.frontendCommit,prep.sourceCommit);
 for(const service of prep.services){assert.equal(built.before[service].id,prep.before[service].id);assert.equal(built.before[service].image,prep.before[service].image);}
 assert.equal(digest(built.assets),digest(expectedFrontend),'REMOTE_FRONTEND_DIFFERS_FROM_PROVED_BUILD');
 assert.equal(digest(built.backendSources),digest(expectedBackend),'REMOTE_BACKEND_DIFFERS_FROM_PROVED_BUILD');
 assert.deepEqual(built.expectedBackendEnvironmentHashes,built.oldBackendEnvironmentHashes,'ENVIRONMENT_CHANGED');builtReproducesLocalProof=true;
}else if(!process.argv.includes('--local')){
 const current=json(path.join(runtime,'live-state-only.json'));
 assert.equal(current.readOnly,true);assert.ok(Date.now()-Date.parse(current.at)<5*60_000,'STATE_READ_EXPIRED');
 for(const [service,old]of Object.entries(prep.before))for(const field of ['id','image','started','running','environmentHash'])assert.equal(current.services[service][field],old[field],'PRODUCTION_BASE_DRIFT:'+service+':'+field);
 stateUnchanged=true;
}
const result={status:'PASS',verifiedAt:new Date().toISOString(),localOnly,sourceCommit:prep.sourceCommit,services:prep.services,packageAndBackupsVerified:true,
 expectedFrontendTreeSha256:digest(expectedFrontend),expectedBackendTreeSha256:digest(expectedBackend),
 stateUnchanged,builtReproducesLocalProof,remoteWrites:0};
fs.writeFileSync(path.join(base,process.argv.includes('--built')?'remote-build-verification.json':process.argv.includes('--local')?'local-package-verification.json':'verification.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
