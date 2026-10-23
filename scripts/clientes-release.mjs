// Sólo preparación local y copias en staging. No contiene una acción de despliegue.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const runtime=path.resolve('scripts/inventory-auth-lab/runtime');
const key=path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy');
const host='root@192.168.55.201';
const contextFile=path.join(runtime,'clientes-production-context-private.json');
const backupFile=path.join(runtime,'clientes-backup-private.json');
const artifactFile=path.join(runtime,'clientes-artifact.json');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n');
const exec=(cmd,args,options={})=>cp.execFileSync(cmd,args,{windowsHide:true,timeout:120000,maxBuffer:64*1024*1024,...options});
function ssh(code) { return exec('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',key,host,'python3 -'],{input:code,encoding:'utf8'}); }
function scp(args) {exec('scp',['-q','-o','BatchMode=yes','-i',key,...args]);}
const deployed=read('docs/CUSTODIA-DEVOLUCIONES-ARTEFACTO-CONFIGURADO.json');
const activated=read('docs/CUSTODIA-DEVOLUCIONES-ACTIVACION-RESULTADO.json').activation;
const clientsFiles=['src/lib/clientLifecycle.ts','src/stores/clients.ts','src/stores/contracts.ts','src/stores/installations.ts','src/stores/dashboard.ts','src/views/clientes/ClientesView.vue'];
const mode=process.argv[2];
if (mode==='context'||mode==='backup'||mode==='verify') {
  const files=exec('tar',['-tzf',deployed.frontendArchive.file],{encoding:'utf8'}).trim().split(/\r?\n/).filter(n=>!n.endsWith('/'));
  assert.equal(hash(fs.readFileSync(deployed.frontendArchive.file)),activated.artifactSha256);
  const assets={};for(const name of files)assets[name.replace(/^\.\//,'')]=hash(exec('tar',['-xOf',deployed.frontendArchive.file,name]));
  const expected={base:deployed.base,image:activated.frontendImage,assets,mode};
  let code=fs.readFileSync('scripts/tests/clientes-image-verify.py','utf8');
  code+='\nEXPECTED=json.loads('+JSON.stringify(JSON.stringify(expected))+')\n';
  code+=fs.readFileSync('scripts/tests/clientes-release-vm.py','utf8');
  const result=JSON.parse(ssh(code));
  if(mode==='backup')write(backupFile,result);else if(mode==='context')write(contextFile,result);
  else assert.deepEqual(result.services,read(backupFile).services,'RUNNING_SERVICES_CHANGED');
  console.log(JSON.stringify({mode,base:result.base,image:result.image,servedAssetsVerified:Object.keys(result.assets).length,stage:result.stage,servicesUnchanged:mode==='verify'}));
} else if(mode==='build') {
  const context=read(contextFile);
  const stage=fs.mkdtempSync(path.join(runtime,'clientes-release-')),source=path.join(stage,'source');fs.mkdirSync(source);
  const baseTar=path.join(stage,'base.tar');exec('git',['archive','--format=tar','--output='+baseTar,context.base]);exec('tar',['-xf',baseTar,'-C',source]);
  const tracked=exec('git',['ls-tree','-r','--name-only',context.base],{encoding:'utf8'}).trim().split(/\r?\n/);
  const baselineHashes=new Map(tracked.map(file=>[file,hash(fs.readFileSync(path.join(source,file)))]));
  const overlays=[...deployed.files.map(f=>({file:f.file,body:exec('git',['show','4a0b956:'+f.file]),sha256:f.sha256})),
    ...clientsFiles.map(file=>({file,body:fs.readFileSync(file)}))];
  for(const f of overlays){if(f.sha256)assert.equal(hash(f.body),f.sha256);const target=path.join(source,f.file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,f.body);}
  // Contrastar todo el árbol versionado: sólo las sobreescrituras declaradas.
  const allowed=new Set(overlays.map(f=>f.file));
  for(const file of tracked)if(!allowed.has(file))assert.equal(hash(fs.readFileSync(path.join(source,file))),baselineHashes.get(file),'UNRELATED_SOURCE_CHANGE: '+file);
  assert.equal(hash(JSON.stringify(read('package-lock.json'))),hash(JSON.stringify(read(path.join(source,'package-lock.json')))),'DEPENDENCY_LOCK_DIVERGENCE');
  assert.equal(fs.existsSync(path.join(source,'.env')),false);
  fs.symlinkSync(path.resolve('node_modules'),path.join(source,'node_modules'),'junction');
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('VITE_')));Object.assign(env,context.buildArguments);
  const result=cp.spawnSync('cmd.exe',['/d','/s','/c','npm.cmd run build'],{cwd:source,env,windowsHide:true,encoding:'utf8',timeout:180000});
  fs.writeFileSync(path.join(stage,'build.log'),result.stdout+'\n'+result.stderr);assert.equal(result.status,0,'ISOLATED_BUILD_FAILED; see private build.log');
  const dist=path.join(source,'dist'),archive=path.join(stage,'frontend-dist.tar.gz');exec('tar',['-czf',archive,'-C',dist,'.']);
  const artifact={base:context.base,sourceBaseHead:exec('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),stage,source,
    productionImage:context.image,frontendArchive:{file:archive,sha256:hash(fs.readFileSync(archive))},
    files:clientsFiles.map(file=>({file,sha256:hash(fs.readFileSync(file))})),
    deployedOverlays:deployed.files,productionConfigKeys:Object.keys(context.buildArguments),
    configSha256:hash(JSON.stringify(context.buildArguments)),baselineFilesCompared:tracked.length,
    packageLockUnchanged:true,prospectsSourceUnchanged:true,deployedOverlaysPreserved:true,build:'PASS',deployment:'NOT_DEPLOYED'};
  write(artifactFile,artifact);write('docs/CLIENTES-ARTEFACTO.json',artifact);
  console.log(JSON.stringify({build:'PASS',base:artifact.base,stage,archiveSha256:artifact.frontendArchive.sha256,baselineFilesCompared:tracked.length}));
} else if(mode==='copy') {
  const backup=read(backupFile),artifact=read(artifactFile);assert.match(backup.stage,/^\/opt\/smartrayco-staging\/clientes-\d{8}T\d{6}Z$/);
  const pc=path.resolve(runtime,'clientes-backup-'+path.basename(backup.stage));fs.mkdirSync(pc,{recursive:true});
  for(const [name,meta] of Object.entries(backup.files)){const target=path.join(pc,name);if(!fs.existsSync(target))scp([host+':'+backup.stage+'/backup/'+name,target]);assert.equal(hash(fs.readFileSync(target)),meta.sha256);}
  const manifest={...backup};delete manifest.buildArguments;write(path.join(pc,'manifest.json'),manifest);
  const staged={'frontend-dist.tar.gz':artifact.frontendArchive.file,'release-manifest.json':'docs/CLIENTES-ARTEFACTO.json',
    'rollback-check.py':'scripts/tests/clientes-rollback-check.py','image-verifier.py':'scripts/tests/clientes-image-verify.py'};
  const expected={};for(const [name,file]of Object.entries(staged)){scp([file,host+':'+backup.stage+'/'+name]);expected[name]=hash(fs.readFileSync(file));fs.copyFileSync(file,path.join(pc,name));}
  const checks=JSON.parse(ssh('import json,pathlib,hashlib\np=pathlib.Path('+JSON.stringify(backup.stage)+')\nexpected=json.loads('+JSON.stringify(JSON.stringify(expected))+')\nfor name,digest in expected.items():\n f=p/name\n assert hashlib.sha256(f.read_bytes()).hexdigest()==digest\n f.chmod(0o600)\nprint(json.dumps({"verified":len(expected)}))\n'));
  const rollback=JSON.parse(ssh('import subprocess\nprint(subprocess.check_output(["python3",'+JSON.stringify(backup.stage+'/rollback-check.py')+','+JSON.stringify(backup.stage)+'],text=True))\n'));
  assert.equal(rollback.check,'PASS');
  const summary={pcBackup:pc,vmStage:backup.stage,filesVerified:Object.keys(backup.files).length,stagedFilesVerified:checks.verified,rollbackImage:backup.image,rollbackExactIdentity:backup.imageVerification.exactIdentity,rollbackCheck:rollback,stagedHashes:expected,deployment:'NOT_DEPLOYED'};
  write('docs/CLIENTES-RESPALDO.json',summary);console.log(JSON.stringify(summary));
} else throw Error('Use context | backup | build | copy | verify. No deploy action exists.');
