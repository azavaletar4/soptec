// Preparacion exclusivamente LOCAL. Usa Docker local, sin SSH, SQL ni RouterOS.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { loadEnv } from 'vite';
import assert from 'node:assert/strict';
const root=process.cwd(),runtime=path.resolve('scripts/inventory-auth-lab/runtime/pppoe-publication');
const option=(name,fallback)=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:fallback;
const buildRoot=path.resolve(option('--build-root',runtime));
const source=path.join(runtime,'source'),feature='a4a5b41c9a862d6b82cccc2c74dfed3d1d328f16';
const run=(bin,args,cwd=root,env=process.env)=>execFileSync(bin,args,{cwd,env,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});
const git=(...args)=>run('git',args).trim();
const dockerContext=run('docker',['context','show']).trim();
const dockerEndpoint=JSON.parse(run('docker',['context','inspect',dockerContext]))[0].Endpoints.docker.Host;
assert.ok(/^(npipe:|unix:|tcp:\/\/(?:127\.0\.0\.1|localhost):)/.test(dockerEndpoint),'LOCAL_DOCKER_REQUIRED');
const hash=value=>createHash('sha256').update(value).digest('hex');
const treeHashes=folder=>{
 const result={};const walk=dir=>{for(const item of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,item.name);if(item.isDirectory())walk(full);else result[path.relative(folder,full).replaceAll('\\','/')]=hash(fs.readFileSync(full));}};walk(folder);return result;
};
const imageTree=(image,label,entries)=>{
 const cid=run('docker',['create','--network','none',image]).trim(),folder=path.join(runtime,label);
 fs.mkdirSync(folder,{recursive:true});
 try{for(const [prefix,remote]of entries){const destination=path.join(folder,prefix);fs.mkdirSync(destination,{recursive:true});run('docker',['cp',cid+':'+remote+'/.',destination]);}}
 finally{run('docker',['rm',cid]);}
 return treeHashes(folder);
};
const imageRegularHashes=(image,remote)=>{
 const cid=run('docker',['create','--network','none',image]).trim();
 try{return JSON.parse(run('python',['-c',"import subprocess,tarfile,io,hashlib,json,sys\nb=subprocess.check_output(['docker','cp',sys.argv[1]+':'+sys.argv[2]+'/.','-'])\nwith tarfile.open(fileobj=io.BytesIO(b)) as t:print(json.dumps({m.name.removeprefix('./'):hashlib.sha256(t.extractfile(m).read()).hexdigest() for m in t if m.isfile()}))",cid,remote]));}
 finally{run('docker',['rm',cid]);}
};
const normalized=value=>value.toString('utf8').replaceAll('\r\n','\n');
const live=JSON.parse(fs.readFileSync(path.join(runtime,'live-readonly.json'),'utf8'));
const commit=run('git',['rev-parse','HEAD'],source).trim(),base=live.frontendManifest.commit;
const front=['src/components/dashboard/PppoeProfileCards.vue','src/lib/pppoeProfileCounts.ts','src/views/DashboardView.vue'];
const back=['server/src/routes/dashboard.ts','server/src/services/dashboardPppoeHandler.ts','server/src/services/dashboardPppoeProfiles.ts','src/lib/pppoeProfileCounts.ts'];
const node22=path.join(runtime,'node22/node.exe');
const sums=fs.readFileSync(path.join(runtime,'node22/SHASUMS256.txt'),'utf8');
const official=sums.split('\n').find(line=>line.endsWith('  win-x64/node.exe'))?.split(/\s+/)[0];
assert.equal(hash(fs.readFileSync(node22)),official,'NODE_BINARY_CHECKSUM');
assert.equal(run(node22,['--version']).trim(),live.backendRuntime.node,'NODE_RUNTIME_VERSION');
const out=path.resolve(option('--output-dir','deploy/pppoe-20261112'));fs.mkdirSync(out,{recursive:true});
const scopePath=path.join(out,'scope.json');
assert.equal(run('git',['rev-parse','HEAD^'],source).trim(),base,'RELEASE_PARENT_MUST_BE_LIVE_FRONTEND');
for(const file of new Set([...front,...back])) {
 assert.equal(hash(run('git',['show',commit+':'+file],source)),hash(run('git',['show',feature+':'+file])),'FEATURE_CONTENT_DRIFT:'+file);
}
for(const [file,digest]of Object.entries(live.frontendManifest.sourceFiles))assert.equal(hash(normalized(execFileSync('git',['show',base+':'+file],{maxBuffer:16*1024*1024}))),digest,'LIVE_FRONTEND_BASE_MISMATCH:'+file);
assert.equal(normalized(Buffer.from(live.backendFiles['server/src/routes/dashboard.ts'],'base64')),normalized(execFileSync('git',['show',feature+'^:server/src/routes/dashboard.ts'])),'LIVE_BACKEND_ROUTE_MISMATCH');
assert.equal(hash(Buffer.from(live.backendConfig['package-lock.json'],'base64')),hash(fs.readFileSync('package-lock.json')),'DEPENDENCY_DRIFT');
const publicEnv=loadEnv('production',root,'VITE_');
for(const [key,digest]of Object.entries(live.frontendManifest.configurationHashes))assert.equal(hash(publicEnv[key]??''),digest,'PUBLIC_CONFIG_DRIFT:'+key);
const env={...process.env,...publicEnv,NODE_ENV:'production'};
const safeWrite=(folder,name,content)=>{const target=path.resolve(folder,name);assert.ok(target.startsWith(path.resolve(folder)+path.sep),'UNSAFE_PATH');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);};
const backup=path.join(runtime,'backup'),candidate=path.join(runtime,'backend-candidate');
for(const [file,encoded]of Object.entries(live.frontendFiles))safeWrite(path.join(backup,'frontend'),file,Buffer.from(encoded,'base64'));
for(const [file,encoded]of Object.entries(live.nginxFiles))safeWrite(path.join(backup,'nginx'),file,Buffer.from(encoded,'base64'));
for(const [file,encoded]of Object.entries({...live.backendFiles,...live.backendConfig})) {
 const bytes=Buffer.from(encoded,'base64');safeWrite(path.join(backup,'backend'),file,bytes);safeWrite(candidate,file,bytes);
}
for(const file of back)safeWrite(candidate,file,run('git',['show',commit+':'+file],source));
const link=folder=>{const target=path.join(folder,'node_modules');if(!fs.existsSync(target))fs.symlinkSync(path.join(root,'node_modules'),target,'junction');};
link(source);link(candidate);
const beforeBackend=Object.fromEntries(Object.entries(live.backendFiles).map(([file,value])=>[file,hash(Buffer.from(value,'base64'))]));
const afterBackend={...beforeBackend,...Object.fromEntries(back.map(file=>[file,hash(fs.readFileSync(path.join(candidate,file)))]))};
assert.deepEqual(Object.keys(afterBackend).filter(file=>beforeBackend[file]!==afterBackend[file]).sort(),[...back].sort(),'BACKEND_SCOPE');
const sourceSnapshot=path.join(runtime,'release-source.json');
run(node22,['scripts/frontend-release-build.mjs','--export-snapshot','--snapshot-output',sourceSnapshot],source,env);
// Prepara el paquete revisable antes del build. Las imagenes consumen ese TAR.
const packaged=JSON.parse(run(process.execPath,['scripts/frontend-consolidation-release.cjs','package','--scope',scopePath,'--snapshot',sourceSnapshot]));
const prepared=JSON.parse(run(process.execPath,['scripts/frontend-consolidation-release.cjs','prepare','--local','--scope',scopePath,'--snapshot',sourceSnapshot]));
assert.equal(prepared.localOnly,true);assert.equal(prepared.productionWrites,0);
const packageManifest=JSON.parse(fs.readFileSync(packaged.package,'utf8'));
const packagedArchive=path.join(path.dirname(packaged.package),'source.tar');
assert.equal(hash(fs.readFileSync(packagedArchive)),packageManifest.files['source.tar']);
const images=JSON.parse(fs.readFileSync(path.join(runtime,'image-backups.json'),'utf8'));
const baseTags={};
for(const service of ['backend','frontend']){
 assert.equal(images.images[service].image,live.services[service].image,'BACKUP_BASE_IMAGE');
 const archive=images.images[service].archive;
 assert.equal(hash(fs.readFileSync(archive)),images.images[service].sha256,'BACKUP_ARCHIVE_HASH');
 run('docker',['image','inspect',live.services[service].image]); // Las cargas son explicitas y locales.
 baseTags[service]='smartrayco-pppoe-base-'+service+':'+live.services[service].image.slice(7,19);
 run('docker',['tag',live.services[service].image,baseTags[service]]);
}
const builtImages={};
const makeFront=label=>{
 const folder=path.join(buildRoot,'linux-'+label);fs.mkdirSync(folder,{recursive:true});
 const sourceFolder=path.join(folder,'source');fs.mkdirSync(sourceFolder,{recursive:true});
 run('tar.exe',['-xf',path.basename(packagedArchive),'-C',sourceFolder],path.dirname(packagedArchive));
 let docker='FROM '+baseTags.backend+' AS build\nWORKDIR /build/source\nCOPY source/ ./\nRUN ln -s /app/node_modules node_modules\n';
 for(const key of Object.keys(live.frontendManifest.configurationHashes))docker+='ENV '+key+'='+JSON.stringify(publicEnv[key]??'')+'\n';
 docker+='ENV SOURCE_COMMIT='+commit+'\nRUN node scripts/frontend-release-build.mjs --snapshot release-source.json\nFROM '+baseTags.frontend+'\nCOPY --from=build /build/source/dist/ /usr/share/nginx/html/\nLABEL org.opencontainers.image.revision="'+commit+'"\n';
 fs.writeFileSync(path.join(folder,'Dockerfile'),docker);
 const tag='smartrayco-pppoe-frontend:'+commit.slice(0,12)+(label==='repro'?'-repro':'');
 fs.writeFileSync(path.join(buildRoot,'linux-'+label+'-build.log'),run('docker',['build','--pull=false','--network=none',...(label==='repro'?['--no-cache']:[]),'-t',tag,'.'],folder));
 builtImages[label]=JSON.parse(run('docker',['image','inspect',tag]))[0].Id;
 run('docker',['tag',tag,tag+'-proof-'+hash(buildRoot).slice(0,10)]);
 const cid=run('docker',['create','--network','none',tag]).trim();
 const dist=path.join(folder,'dist');fs.mkdirSync(dist,{recursive:true});
 try{run('docker',['cp',cid+':/usr/share/nginx/html/.',dist]);}finally{run('docker',['rm',cid]);}
 return dist;
};
const reuse=process.argv.includes('--reuse-local-builds');
let canonical,repro;
if(reuse){
 canonical=path.join(buildRoot,'linux-canonical/dist');repro=path.join(buildRoot,'linux-repro/dist');
 for(const label of ['canonical','repro']){
  const tag='smartrayco-pppoe-frontend:'+commit.slice(0,12)+(label==='repro'?'-repro':'');
  const image=JSON.parse(run('docker',['image','inspect',tag]))[0];
  assert.equal(image.Config.Labels['org.opencontainers.image.revision'],commit);
  builtImages[label]=image.Id;
  const folder=label==='canonical'?canonical:repro,manifest=JSON.parse(fs.readFileSync(path.join(folder,'release-manifest.json'),'utf8'));
  assert.equal(manifest.commit,commit);assert.deepEqual(manifest.sourceFiles,JSON.parse(fs.readFileSync(sourceSnapshot,'utf8')).files);
  assert.deepEqual(manifest.configurationHashes,live.frontendManifest.configurationHashes);
  for(const[file,digest]of Object.entries(manifest.artifacts))assert.equal(hash(fs.readFileSync(path.join(folder,file))),digest,'LOCAL_ARTIFACT_DRIFT');
 }
}else{canonical=makeFront('canonical');repro=makeFront('repro');}
const artifactManifest=folder=>JSON.parse(fs.readFileSync(path.join(folder,'release-manifest.json'),'utf8'));
assert.deepEqual(artifactManifest(canonical),artifactManifest(repro),'NON_REPRODUCIBLE_FRONTEND');
if(!reuse)run('python',['scripts/iptv-release-scope.py',path.join(backup,'frontend'),canonical,scopePath]);
const scope=JSON.parse(fs.readFileSync(scopePath,'utf8'));
assert.equal(scope.sourceCommit,commit);
assert.deepEqual(scope.frontendSources,[...front].sort(),'UNRELATED_FRONTEND_SOURCE');
const linker=JSON.parse(run(process.execPath,['scripts/pppoe-publication-linker-proof.mjs',path.join(backup,'frontend'),canonical,scopePath,path.join(out,'linker-proof.json')]));
assert.equal(linker.linkerProof,'PASS');
scope.backendSources=back;fs.writeFileSync(scopePath,JSON.stringify(scope,null,2)+'\n');
fs.writeFileSync(path.join(runtime,'backend-proof.json'),JSON.stringify({beforeBackend,afterBackend,expected:Object.fromEntries(back.map(file=>[file,afterBackend[file]])),scope}));
const backendProof=String.raw`import json,runpy,sys
d=json.load(open(sys.argv[1]));c=runpy.run_path('scripts/consolidation-release-contract.py')
c['validate_scope'](d['scope']);c['validate_backend'](d['beforeBackend'],d['afterBackend'],d['scope'],d['expected']);print('BACKEND_SCOPE_PASS')`;
assert.match(run('python',['-c',backendProof,path.join(runtime,'backend-proof.json')]),/BACKEND_SCOPE_PASS/);
// No se importa index.ts: arrancaria schedulers ajenos al indicador.
const smoke=`globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN')};const {dashboardRoutes}=await import('./server/src/routes/dashboard.ts');
for(const p of ['/pppoe-profiles','/network-status','/olt-summary']){const r=await dashboardRoutes.request(p);if(r.status!==401)throw Error('AUTH_COMPATIBILITY');}
console.log('NODE22_DASHBOARD_IMPORT_AND_AUTH_PASS');`;
const smokeOutput=run(node22,['--import','tsx','--input-type=module','-e',smoke],candidate,{...process.env,NODE_ENV:'test'});
assert.match(smokeOutput,/NODE22_DASHBOARD_IMPORT_AND_AUTH_PASS/);
link(path.join(backup,'backend'));
const types=folder=>{try{return {code:0,output:run(node22,[path.join(root,'node_modules/typescript/bin/tsc'),'-p','tsconfig.server.json','--noEmit'],folder)};}
 catch(error){return {code:error.status,output:String(error.stdout).replaceAll('\r\n','\n')};}};
const baselineTypes=types(path.join(backup,'backend')),candidateTypes=types(candidate);
assert.deepEqual(candidateTypes,baselineTypes,'NEW_BACKEND_GLOBAL_TYPE_ERRORS');
fs.writeFileSync(path.join(runtime,'backend-global-types.json'),JSON.stringify({baseline:baselineTypes,candidate:candidateTypes},null,2));
fs.writeFileSync(path.join(candidate,'pppoe-release-types.local.json'),JSON.stringify({extends:'./tsconfig.server.json',include:['server/src/**/*.ts'],exclude:['server/**/__tests__/**','server/tests/**']}));
fs.writeFileSync(path.join(runtime,'backend-production-types.log'),run(node22,[path.join(root,'node_modules/typescript/bin/tsc'),'-p','pppoe-release-types.local.json','--noEmit'],candidate));
const tests=run(node22,['--import','tsx','--test','server/src/services/__tests__/dashboardPppoeProfiles.test.ts','server/src/mikrotik/__tests__/client.test.ts'],source);
fs.writeFileSync(path.join(runtime,'tests-node22.log'),tests);
const backendContext=path.join(buildRoot,'backend-overlay');fs.mkdirSync(backendContext,{recursive:true});
for(const file of back)safeWrite(backendContext,file,fs.readFileSync(path.join(candidate,file)));
fs.writeFileSync(path.join(backendContext,'Dockerfile'),'FROM '+baseTags.backend+'\n'+back.map(file=>'COPY '+JSON.stringify([file,'/app/'+file])).join('\n')+'\nLABEL org.opencontainers.image.revision="'+commit+'"\n');
const backendTag='smartrayco-pppoe-backend:'+commit.slice(0,12);
fs.writeFileSync(path.join(buildRoot,'backend-build.log'),run('docker',['build','--pull=false','--network=none','--no-cache','-t',backendTag,'.'],backendContext));
builtImages.backend=JSON.parse(run('docker',['image','inspect',backendTag]))[0].Id;
run('docker',['tag',backendTag,backendTag+'-proof-'+hash(buildRoot).slice(0,10)]);
assert.match(run('docker',['run','--rm','--network','none',backendTag,'node','--import','tsx','--input-type=module','-e',smoke]),/NODE22_DASHBOARD_IMPORT_AND_AUTH_PASS/);
const backendEntries=[['server/src','/app/server/src'],['src','/app/src']];
assert.deepEqual(imageTree(live.services.backend.image,'rollback-backend-image',backendEntries),beforeBackend,'ROLLBACK_BACKEND_NOT_EXACT');
assert.deepEqual(imageTree(builtImages.backend,'candidate-backend-image',backendEntries),afterBackend,'CANDIDATE_BACKEND_NOT_ISOLATED');
assert.deepEqual(imageTree(live.services.frontend.image,'rollback-frontend-image',[['','/usr/share/nginx/html']]),
 Object.fromEntries(Object.entries(live.frontendFiles).map(([file,value])=>[file,hash(Buffer.from(value,'base64'))])),'ROLLBACK_FRONTEND_NOT_EXACT');
assert.deepEqual(imageRegularHashes(builtImages.canonical,'/etc/nginx'),
 Object.fromEntries(Object.entries(live.nginxFiles).map(([file,value])=>[file,hash(Buffer.from(value,'base64'))])),'NGINX_CHANGED');
for(const service of ['backend','frontend']){
 const oldImage=JSON.parse(run('docker',['image','inspect',live.services[service].image]))[0];
 const newImage=JSON.parse(run('docker',['image','inspect',service==='backend'?builtImages.backend:builtImages.canonical]))[0];
 for(const field of ['Env','Cmd','Entrypoint','User','WorkingDir','Volumes','ExposedPorts'])assert.ok(JSON.stringify(oldImage.Config[field])===JSON.stringify(newImage.Config[field]),'IMAGE_RUNTIME_CONFIG_CHANGED:'+field);
}
// Revalida despues del build sin reescribir el paquete ni aceptar hashes nuevos.
run(process.execPath,['scripts/frontend-consolidation-release.cjs','prepare','--local','--scope',scopePath,'--snapshot',sourceSnapshot]);
assert.equal(hash(fs.readFileSync(packagedArchive)),packageManifest.files['source.tar']);
const chains=[live.services.frontend.composeFiles,live.services.backend.composeFiles].sort((a,b)=>b.length-a.length);
assert.deepEqual(chains[0].slice(0,chains[1].length),chains[1],'COMPOSE_CHAINS_DIVERGE');
const release={version:1,featureCommit:feature,sourceCommit:commit,baseFrontendCommit:base,liveReadAt:live.at,
 services:['backend','frontend'],backendSources:back,frontendSources:front,frontendAssets:scope.frontendAssets,
 before:Object.fromEntries(Object.entries(live.services).map(([name,{id,image,tag,running,started,environmentHash}])=>[name,{id,image,tag,running,started,environmentHash}])),
 composeFiles:chains[0],nodeRuntime:live.backendRuntime,nodeExecutableSha256:official,
 sourceAndAssetScopePassed:true,reproducibleFrontend:true,backendProductionTypesPassed:true,backendGlobalTypeDiagnosticsUnchanged:true,backendRuntimeSmokePassed:true,
 dockerContext,
 nonFunctionalRelinkingVerified:linker,linkerProofSha256:hash(fs.readFileSync(path.join(out,'linker-proof.json'))),
 frontendReleaseManifestSha256:hash(fs.readFileSync(path.join(canonical,'release-manifest.json'))),
 backendSourceHashes:Object.fromEntries(back.map(file=>[file,afterBackend[file]])),
 candidateImages:{backend:builtImages.backend,frontend:builtImages.canonical,frontendRepro:builtImages.repro},
 rollbackImagesRestoredLocallyAndExact:true,actualBackendImageScopePassed:true,imageRuntimeConfigurationUnchanged:true,
 backupImages:images.images,
 package:packaged.package,packageSha256:hash(fs.readFileSync(packaged.package)),scopeSha256:hash(fs.readFileSync(scopePath)),
 rollbackImages:{backend:live.services.backend.image,frontend:live.services.frontend.image},
 backupDirectory:backup,productionChanges:0,pppoeReadingsPersisted:0};
fs.writeFileSync(path.join(out,'preparation.json'),JSON.stringify(release,null,2)+'\n');
fs.writeFileSync(path.join(out,'rollback.override.json'),JSON.stringify({services:{backend:{image:release.rollbackImages.backend},frontend:{image:release.rollbackImages.frontend}}},null,2)+'\n');
console.log(JSON.stringify({preparedLocally:true,sourceCommit:commit,baseFrontendCommit:base,services:release.services,
 sourceScope:{backend:back.length,frontend:front.length},frontendAssets:scope.frontendAssets,reproducible:true,
 backendNode22Smoke:'PASS',backendProductionTypes:'PASS',globalTypeDiagnosticsUnchanged:true,package:packaged.package,productionChanges:0}));
