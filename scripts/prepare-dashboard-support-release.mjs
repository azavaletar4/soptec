// Todo se ejecuta LOCALMENTE. No SSH, red de contenedores, backend ni base de datos.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {loadEnv} from 'vite';
import assert from 'node:assert/strict';
const root=process.cwd();
const option=(name,fallback)=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:fallback;
assert.ok(!process.argv.includes('--package-dir')||process.argv.includes('--verify'),'PACKAGE_OVERRIDE_ONLY_FOR_READONLY_VERIFICATION');
const out=path.resolve(option('--package-dir','deploy/dashboard-support-prospects-20261113'));
const runtime=path.resolve('scripts/inventory-auth-lab/runtime/dashboard-support-prospects-release');
const source=path.join(runtime,'source');
const run=(bin,args,cwd=root,env=process.env)=>execFileSync(bin,args,{cwd,env,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe']});
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const digest=file=>hash(fs.readFileSync(file));
const persist=(file,bytes)=>{bytes=Buffer.from(bytes);if(fs.existsSync(file))assert.equal(digest(file),hash(bytes),'APPROVED_ARTIFACT_DRIFT:'+path.basename(file));else fs.writeFileSync(file,bytes,{flag:'wx'});};
if(process.argv.includes('--verify')){
 const expected=option('--expected-package-sha256',null);
 assert.match(expected??'',/^[a-f0-9]{64}$/,'EXTERNAL_APPROVED_DIGEST_REQUIRED');
 assert.equal(digest(path.join(out,'package.json')),expected,'APPROVED_PACKAGE_DIGEST_DRIFT');
 const pkg=read(path.join(out,'package.json'));
 assert.deepEqual(pkg.services,['frontend']);assert.deepEqual(pkg.backendSources,[]);
 for(const [name,h]of Object.entries(pkg.files)){assert.equal(path.basename(name),name);assert.equal(digest(path.join(out,name)),h,'PACKAGE_DRIFT:'+name);}
 const sums=Object.entries({...pkg.files,'package.json':digest(path.join(out,'package.json'))}).sort(([a],[b])=>a.localeCompare(b)).map(([n,h])=>h+'  '+n).join('\n')+'\n';
 assert.equal(fs.readFileSync(path.join(out,'SHA256SUMS'),'utf8'),sums,'CHECKSUMS_DRIFT');
 console.log(JSON.stringify({status:'PASS',integrityOnly:true,files:Object.keys(pkg.files).length,packageSha256:digest(path.join(out,'package.json')),sourceTarSha256:pkg.files['source.tar'],frontendTarSha256:pkg.files['frontend-artifacts.tar'],productionWrites:0}));process.exit(0);
}
const live=read(path.join(runtime,'baseline.json')),backup=read(path.join(out,'backup.json'));
const approved=run('git',['rev-parse','61e0e31']).trim(),commit=run('git',['rev-parse','HEAD'],source).trim();
const sourcePathsForScope=['src','index.html','vite.config.ts','package.json','package-lock.json','scripts/frontend-release-build.mjs','deploy/Dockerfile.frontend','deploy/frontend-release-policy.json'];
const expectedFiles=['src/components/clientes/UnfulfilledProspectDiscardDialog.vue','src/lib/__tests__/dashboardOperationalCounts.test.ts','src/lib/dashboardClients.ts','src/lib/dashboardSupport.ts','src/lib/unfulfilledProspect.ts','src/stores/clients.ts','src/stores/dashboard.ts','src/types/domain.ts','src/views/DashboardView.vue','src/views/clientes/ClientesView.vue'];
assert.equal(run('git',['merge-base',live.frontendManifest.commit,commit],source).trim(),live.frontendManifest.commit,'PUBLISHED_BASE_NOT_ANCESTOR');
assert.deepEqual(run('git',['diff','--name-only',live.frontendManifest.commit,commit,'--',...sourcePathsForScope],source).trim().split('\n').sort(),expectedFiles,'SOURCE_SCOPE_DRIFT');
for(const p of expectedFiles.filter(p=>!['src/lib/dashboardSupport.ts','src/stores/dashboard.ts','src/views/DashboardView.vue','src/lib/__tests__/dashboardOperationalCounts.test.ts'].includes(p)))assert.equal(hash(execFileSync('git',['show',commit+':'+p])),hash(execFileSync('git',['show',approved+':'+p])),'AUTHORIZED_FEATURE_SOURCE_DRIFT');
assert.equal(run('git',['status','--porcelain','--untracked-files=all','--','src','index.html','vite.config.ts','package.json','package-lock.json','scripts/frontend-release-build.mjs','deploy/Dockerfile.frontend','deploy/frontend-release-policy.json'],source).trim(),'','ISOLATED_SOURCE_DIRTY');
const context=run('docker',['context','show']).trim(),endpoint=JSON.parse(run('docker',['context','inspect',context]))[0].Endpoints.docker.Host;
assert.match(endpoint,/^(npipe:|unix:|tcp:\/\/(?:127\.0\.0\.1|localhost):)/,'LOCAL_DOCKER_REQUIRED');
assert.equal(digest(path.resolve(backup.archive)),backup.sha256,'BACKUP_HASH_DRIFT');assert.equal(backup.image,live.services.frontend.image);
run('docker',['load','-i',path.resolve(backup.archive)]);
const frontendBase='smartrayco-dashboard-support-base:'+backup.image.slice(7,19);
run('docker',['tag',backup.image,frontendBase]);
// Solo herramientas de compilación de la imagen local ya verificada; nunca inicia el servidor.
const builder='smartrayco-pppoe-base-backend:87e442e9bdcf';
const builderId=JSON.parse(run('docker',['image','inspect',builder]))[0].Id;
assert.equal(builderId,'sha256:87e442e9bdcf17fcd192dbe401fa533c5746e8fd96658b50e0fe24b175162001');
const publicEnv=loadEnv('production',root,'VITE_');
for(const [key,h]of Object.entries(live.frontendManifest.configurationHashes))assert.equal(hash(publicEnv[key]??''),h,'PUBLIC_CONFIG_DRIFT:'+key);
const env={...process.env,...publicEnv,NODE_ENV:'production'};
const node22=path.resolve('scripts/inventory-auth-lab/runtime/pppoe-publication/node22/node.exe');
const nodeVersion=run('docker',['run','--rm','--network=none',builder,'node','--version']).trim();
assert.equal(run(node22,['--version']).trim(),nodeVersion,'BUILD_NODE_VERSION_DRIFT');
const sums=fs.readFileSync(path.resolve('scripts/inventory-auth-lab/runtime/pppoe-publication/node22/SHASUMS256.txt'),'utf8');
assert.equal(digest(node22),sums.split('\n').find(s=>s.endsWith('  win-x64/node.exe')).split(/\s+/)[0]);
if(!fs.existsSync(path.join(source,'node_modules')))fs.symlinkSync(path.join(root,'node_modules'),path.join(source,'node_modules'),'junction');
run(node22,[path.join(root,'node_modules/vue-tsc/bin/vue-tsc.js'),'-b'],source,env);
console.log(JSON.stringify({local:true,isolatedTypes:'PASS',sourceCommit:commit}));
const snapshotPath=path.join(runtime,'release-source.json');
run(node22,['scripts/frontend-release-build.mjs','--export-snapshot','--snapshot-output',snapshotPath],source,env);
const snapshot=read(snapshotPath),epoch=run('git',['show','-s','--format=%ct',commit]).trim();
assert.deepEqual(Object.keys({...live.frontendManifest.sourceFiles,...snapshot.files}).filter(p=>live.frontendManifest.sourceFiles[p]!==snapshot.files[p]).sort(),expectedFiles);
persist(path.join(out,'release-source.json'),fs.readFileSync(snapshotPath));
const sourcePaths=['src','index.html','vite.config.ts','package.json','package-lock.json','scripts/frontend-release-build.mjs','deploy/Dockerfile.frontend','deploy/frontend-release-policy.json'];
const tree=folder=>{
 const entries={};const walk=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(e.isFile())entries[path.relative(folder,f).replaceAll('\\','/')]=digest(f);}};walk(folder);return Object.fromEntries(Object.entries(entries).sort(([a],[b])=>a.localeCompare(b)));
};
const pythonTar=String.raw`import pathlib,tarfile,sys,io,hashlib,json
folder,target,epoch=pathlib.Path(sys.argv[1]),pathlib.Path(sys.argv[2]),int(sys.argv[3])
with tarfile.open(target,'w',format=tarfile.PAX_FORMAT) as t:
 for p in sorted(x for x in folder.rglob('*') if x.is_file()):
  b=p.read_bytes();m=tarfile.TarInfo(p.relative_to(folder).as_posix());m.mode=0o644;m.uid=m.gid=0;m.mtime=epoch;m.size=len(b);t.addfile(m,io.BytesIO(b))
print(hashlib.sha256(target.read_bytes()).hexdigest())`;
const attempts=[];
for(let index=1;index<=2;index++){
 const folder=path.join(runtime,'build-'+index);fs.mkdirSync(folder,{recursive:true});
 const tar=path.join(folder,'source.tar');
 run('git',['-c','tar.umask=0022','archive',commit,'--format=tar','--mtime=@'+epoch,'--add-file='+snapshotPath,'--output='+tar,...sourcePaths],source);
 persist(path.join(out,'source.tar'),fs.readFileSync(tar));
 const unpacked=path.join(folder,'source');fs.mkdirSync(unpacked,{recursive:true});run('tar.exe',['-xf',tar,'-C',unpacked]);
 let docker='FROM '+builder+' AS build\nWORKDIR /build/source\nCOPY source/ ./\nRUN ln -s /app/node_modules node_modules\n';
 for(const key of Object.keys(live.frontendManifest.configurationHashes))docker+='ENV '+key+'='+JSON.stringify(publicEnv[key]??'')+'\n';
 docker+='ENV SOURCE_COMMIT='+commit+'\nRUN node scripts/frontend-release-build.mjs --snapshot release-source.json\nFROM '+frontendBase+'\nCOPY --from=build /build/source/dist/ /usr/share/nginx/html/\nLABEL org.opencontainers.image.revision="'+commit+'"\n';
 fs.writeFileSync(path.join(folder,'Dockerfile'),docker);
 const tag='smartrayco-dashboard-support:'+commit.slice(0,12)+(index===2?'-repro':'');
 fs.writeFileSync(path.join(folder,'build.log'),run('docker',['build','--pull=false','--network=none','--no-cache','-t',tag,'.'],folder));
 const image=JSON.parse(run('docker',['image','inspect',tag]))[0].Id;
 const cid=run('docker',['create','--network','none',image]).trim();
 const dist=path.join(folder,'dist');fs.mkdirSync(dist,{recursive:true});
 let nginxHashes;
 try{
  run('docker',['cp',cid+':/usr/share/nginx/html/.',dist]);
  // Lee el TAR por stdout; no necesita crear symlinks Linux en Windows.
  nginxHashes=JSON.parse(run('python',['-c',"import subprocess,tarfile,io,hashlib,json,sys\nb=subprocess.check_output(['docker','cp',sys.argv[1]+':/etc/nginx/.','-'])\nwith tarfile.open(fileobj=io.BytesIO(b)) as t:print(json.dumps({m.name.removeprefix('./'):hashlib.sha256(t.extractfile(m).read()).hexdigest() for m in t if m.isfile()}))",cid]));
 }finally{run('docker',['rm',cid]);}
 assert.deepEqual(nginxHashes,live.nginxHashes,'NGINX_CONFIG_DRIFT');
 const manifest=read(path.join(dist,'release-manifest.json'));
 assert.deepEqual(manifest.sourceFiles,snapshot.files);assert.equal(manifest.commit,commit);assert.deepEqual(manifest.configurationHashes,live.frontendManifest.configurationHashes);
 for(const [p,h]of Object.entries(manifest.artifacts))assert.equal(digest(path.join(dist,p)),h,'BUILT_ASSET_DRIFT');
 for(const [p,b64]of Object.entries(live.frontendFiles))if(!['index.html','release-manifest.json','.vite/manifest.json'].includes(p))assert.equal(digest(path.join(dist,p)),hash(Buffer.from(b64,'base64')),'HISTORICAL_ASSET_CHANGED:'+p);
 const markers=['Cliente laboratorio','LOCAL · DATOS SIMULADOS','2001-01-02T08:09:10Z','window.__tickGeneral','synthetic@example.invalid'];
 for(const p of Object.keys(manifest.artifacts).filter(p=>/\.(js|css|html)$/.test(p)))for(const marker of markers)assert.ok(!fs.readFileSync(path.join(dist,p),'utf8').includes(marker),'LAB_FIXTURE_IN_PRODUCT:'+p);
 const artifactTar=path.join(folder,'frontend-artifacts.tar');
 const artifactHash=run('python',['-c',pythonTar,dist,artifactTar,epoch]).trim();
 persist(path.join(out,'frontend-artifacts.tar'),fs.readFileSync(artifactTar));
 attempts.push({run:index,sourceTarSha256:digest(tar),frontendTarSha256:artifactHash,image,tag,files:Object.keys(tree(dist)).length,treeSha256:hash(JSON.stringify(tree(dist))),manifestSha256:digest(path.join(dist,'release-manifest.json'))});
 console.log(JSON.stringify({local:true,build:index,status:'PASS',sourceTarSha256:digest(tar),frontendTarSha256:artifactHash}));
}
for(const field of ['sourceTarSha256','frontendTarSha256','treeSha256','manifestSha256'])assert.equal(attempts[0][field],attempts[1][field],'NON_REPRODUCIBLE:'+field);
const old=path.join(runtime,'baseline-frontend');fs.mkdirSync(old,{recursive:true});
for(const [p,b]of Object.entries(live.frontendFiles)){const target=path.resolve(old,p);assert.ok(target.startsWith(old+path.sep));fs.mkdirSync(path.dirname(target),{recursive:true});persist(target,Buffer.from(b,'base64'));}
const proof={status:'PASS',services:['frontend'],approvedCommit:approved,baseFrontendCommit:live.frontendManifest.commit,sourceCommit:commit,sourceFiles:expectedFiles,backendSources:[],sourceFileCount:Object.keys(snapshot.files).length,attempts,types:'PASS',nginxUnchanged:true,historicalAssetsRetained:true,fixturesExcluded:true,builderImage:builderId,node:nodeVersion,productionWrites:0,supabaseRequests:0,mikrotikRequests:0};
persist(path.join(out,'build-reproducibility.json'),JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify({status:'PASS',sourceCommit:commit,sourceFiles:Object.keys(snapshot.files).length,attempts:attempts.length,frontendOnly:true}));
