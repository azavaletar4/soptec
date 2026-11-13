// Sella archivos LOCALES ya compilados. No usa SSH ni ejecuta publicación.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createGzip} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import assert from 'node:assert/strict';
const out=path.resolve('deploy/dashboard-v2-20261112'),runtime=path.resolve('scripts/inventory-auth-lab/runtime/dashboard-v2-publication');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8')),hash=b=>createHash('sha256').update(b).digest('hex');
const digest=async p=>{const h=createHash('sha256');for await(const b of fs.createReadStream(p))h.update(b);return h.digest('hex');};
const run=(bin,args)=>execFileSync(bin,args,{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024,stdio:['pipe','pipe','pipe']});
const put=(name,object)=>{const bytes=Buffer.from(JSON.stringify(object,null,2)+'\n'),p=path.join(out,name);if(fs.existsSync(p))assert.deepEqual(fs.readFileSync(p),bytes,'SEALED_DATA_DRIFT:'+name);else fs.writeFileSync(p,bytes,{flag:'wx'});};
const context=run('docker',['context','show']).trim(),endpoint=JSON.parse(run('docker',['context','inspect',context]))[0].Endpoints.docker.Host;
assert.match(endpoint,/^(npipe:|unix:|tcp:\/\/(?:127\.0\.0\.1|localhost):)/);
const prep=read(path.join(out,'build-reproducibility.json')),proof=read(path.join(out,'artifact-scope-proof.json')),baseline=read(path.join(runtime,'baseline.json'));
assert.equal(proof.status,'PASS');assert.equal(proof.sourceCommit,prep.sourceCommit);
const candidate=prep.attempts[0],tag=candidate.tag,image=JSON.parse(run('docker',['image','inspect',tag]))[0];assert.equal(image.Id,candidate.image);
const base=JSON.parse(run('docker',['image','inspect',baseline.services.frontend.image]))[0];
for(const field of ['Env','Entrypoint','Cmd','WorkingDir','User','ExposedPorts','Volumes','Healthcheck','StopSignal'])assert.deepEqual(image.Config[field],base.Config[field],'FRONTEND_RUNTIME_CONFIG_CHANGED:'+field);
// Prueba nginx aislado, sin puertos publicados ni acceso a servicios externos.
// Nginx conserva el upstream "backend". Se resuelve solo a loopback en este
// contenedor de laboratorio, sin arrancar backend ni abrir acceso externo.
const cid=run('docker',['run','-d','--network','none','--add-host','backend:127.0.0.1',tag]).trim();
try{
 run('docker',['exec',cid,'nginx','-t']);
 for(const route of ['/','/dashboard','/clientes','/soporte','/olt','/inventario','/facturacion'])assert.equal(hash(execFileSync('docker',['exec',cid,'wget','-q','-T','2','-t','1','-O','-','http://127.0.0.1'+route],{maxBuffer:4*1024*1024})),await digest(path.join(runtime,'build-1/dist/index.html')),'LOCAL_NGINX_ROUTE:'+route);
}finally{run('docker',['stop',cid]);run('docker',['rm',cid]);}
const archive=path.join(out,'frontend-candidate.image.tar.gz');
if(!fs.existsSync(archive)){
 const child=spawn('docker',['save',tag],{windowsHide:true,stdio:['ignore','pipe','pipe']});child.stderr.resume();
 const finished=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('LOCAL_IMAGE_EXPORT_FAILED')));});
 await Promise.all([pipeline(child.stdout,createGzip(),fs.createWriteStream(archive,{flags:'wx'})),finished]);
}
// Comprueba que el respaldo restaurado es exacto y que el candidato exportado
// contiene la configuración y blobs identificados por sus hashes Docker.
const python=String.raw`import sys,tarfile,json,hashlib
for path,expected in zip(sys.argv[1::2],sys.argv[2::2]):
 manifest=None;index=None;hashes={};sizes={};documents={};seen=set()
 with tarfile.open(path,'r|gz') as t:
  for m in t:
   assert m.name not in seen,'DUPLICATE_IMAGE_MEMBER';seen.add(m.name)
   assert not m.name.startswith('/') and '..' not in m.name.split('/'),'UNSAFE_IMAGE_MEMBER'
   if m.isfile():
    b=t.extractfile(m).read();hashes[m.name]=hashlib.sha256(b).hexdigest();sizes[m.name]=len(b)
    if m.name=='manifest.json':manifest=json.loads(b)
    if m.name=='index.json':index=json.loads(b)
    if m.name.startswith('blobs/sha256/'):assert hashes[m.name]==m.name.split('/')[-1],'IMAGE_BLOB_DRIFT'
    if m.name.startswith('blobs/sha256/') and b.startswith(b'{'):
     try:documents[m.name]=json.loads(b)
     except ValueError:pass
 assert len(manifest)==1,'EXPORTED_IMAGE_COUNT_DRIFT'
 # Docker/containerd identifica estas imágenes por el índice OCI, no por
 # el JSON de configuración. Comprueba raíz, blobs y cadena de referencias.
 assert index and len(index['manifests'])==1 and index['manifests'][0]['digest']==expected,'EXPORTED_IMAGE_ID_DRIFT'
 configs=set();visited=set()
 def descriptor(d):
  assert d['digest'].startswith('sha256:'),'UNSUPPORTED_IMAGE_DIGEST'
  p='blobs/sha256/'+d['digest'].split(':')[1]
  assert p in hashes and hashes[p]==d['digest'].split(':')[1] and sizes[p]==d['size'],'IMAGE_DESCRIPTOR_DRIFT'
  if p in visited:return
  visited.add(p);doc=documents.get(p,{})
  if doc.get('schemaVersion')!=2:return
  for child in doc.get('manifests',[]):descriptor(child)
  if 'config' in doc:
   descriptor(doc['config']);configs.add(doc['config']['digest'].split(':')[1])
  for layer in doc.get('layers',[]):descriptor(layer)
 descriptor(index['manifests'][0])
 assert hashes[manifest[0]['Config']] in configs,'IMAGE_CONFIG_NOT_BOUND_TO_ROOT'
 for layer in manifest[0]['Layers']:assert layer in hashes,'IMAGE_LAYER_MISSING'
print(json.dumps({'status':'PASS','backupAndCandidateImageExportsVerified':True,'dockerIdentity':'OCI index','allDescriptorsAndBlobsVerified':True}))`;
const imageProof=JSON.parse(run('python',['-c',python,path.join(out,'frontend-before.image.tar.gz'),baseline.services.frontend.image,archive,candidate.image]));
const browser=read(path.join(runtime,'browser/verification.json')),ppp=read(path.join(runtime,'browser/pppoe-regression.json'));
assert.equal(browser.status,'PASS');assert.equal(browser.checks.length,32);assert.equal(ppp.checks.length,16);assert.equal(browser.writes,0);assert.equal(browser.externalRequests,0);
put('regression.json',{status:'PASS',builtPackageTested:true,sourceCommit:prep.sourceCommit,v2:browser,pppoe:ppp,localNginx:'PASS',runtimeConfigurationUnchanged:true,imageExports:imageProof});
const site=path.join(runtime,'build-1/dist'),candidateSiteHashes={};
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(e.isFile())candidateSiteHashes[path.relative(site,p).replaceAll('\\','/')]=hash(fs.readFileSync(p));}}walk(site);
const chains=['frontend','backend'].map(s=>baseline.services[s].composeFiles),composeFiles=chains.reduce((a,b)=>a.length>b.length?a:b);
for(const chain of chains)assert.deepEqual(composeFiles.slice(0,chain.length),chain,'COMPOSE_CHAINS_DIVERGED');
const rollbackTag='smartrayco-dashboard-v2-rollback:'+baseline.services.frontend.image.slice(7,19);
const stage='/opt/smartrayco-staging/dashboard-v2-'+prep.sourceCommit.slice(0,12)+'-'+candidate.sourceTarSha256.slice(0,10);
put('deployment-plan.json',{version:1,stage,services:['frontend'],sourceCommit:prep.sourceCommit,baseCommit:baseline.frontendManifest.commit,candidateTag:tag,candidateImage:candidate.image,beforeImage:baseline.services.frontend.image,rollbackTag,composeFiles,beforeSiteHashes:Object.fromEntries(Object.entries(baseline.frontendFiles).map(([p,b])=>[p,hash(Buffer.from(b,'base64'))])),candidateSiteHashes});
put('release.override.json',{services:{frontend:{image:tag}}});put('rollback.override.json',{services:{frontend:{image:rollbackTag}}});
run('python',['-c',"import pathlib;compile(pathlib.Path('deploy/dashboard-v2-20261112/publish.py').read_text(encoding='utf8'),'publish.py','exec');print('SYNTAX_OK')"]);
const names=['source.tar','frontend-artifacts.tar','release-source.json','frontend-candidate.image.tar.gz','frontend-before.image.tar.gz','production-baseline.json','backup.json','build-reproducibility.json','artifact-scope-proof.json','regression.json','deployment-plan.json','release.override.json','rollback.override.json','publish.py'];
const files={};for(const name of names)files[name]=await digest(path.join(out,name));
put('package.json',{version:1,sourceCommit:prep.sourceCommit,approvedCommit:prep.approvedCommit,baseFrontendCommit:prep.baseFrontendCommit,services:['frontend'],frontendSources:prep.sourceFiles,backendSources:[],stage,candidateImage:candidate.image,beforeFrontendImage:baseline.services.frontend.image,files,productionWrites:0});
const sums=Object.entries({...files,'package.json':await digest(path.join(out,'package.json'))}).sort(([a],[b])=>a.localeCompare(b)).map(([n,h])=>h+'  '+n).join('\n')+'\n';
const sumsPath=path.join(out,'SHA256SUMS');if(fs.existsSync(sumsPath))assert.equal(fs.readFileSync(sumsPath,'utf8'),sums);else fs.writeFileSync(sumsPath,sums,{flag:'wx'});
console.log(JSON.stringify({status:'PASS',packageSha256:await digest(path.join(out,'package.json')),sourceTarSha256:files['source.tar'],frontendTarSha256:files['frontend-artifacts.tar'],candidateImage:candidate.image,packageFiles:names.length,localOnly:true}));
