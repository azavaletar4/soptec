// Solo empaqueta/promueve software; nunca llama endpoints de tareas GenieACS.
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path'),crypto=require('node:crypto');
const action=process.argv[2];
if(!['package','prepare','build','deploy','verify','rollback'].includes(action))throw Error('INVALID_ACTION');
const option=(name,fallback)=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:fallback;
const localOnly=process.argv.includes('--local');
if(localOnly&&action!=='prepare')throw Error('LOCAL_ONLY_REQUIRES_PREPARE');
if(process.argv.includes('--local-root')&&action!=='package'&&!localOnly)throw Error('LOCAL_ROOT_REQUIRES_LOCAL_ACTION');
const scopePath=option('--scope','deploy/consolidation-release-scope.json');
const snapshotPath=path.resolve(option('--snapshot','release-source.json'));
if(path.basename(snapshotPath)!=='release-source.json')throw Error('INVALID_SNAPSHOT_BASENAME');
const scope=JSON.parse(fs.readFileSync(scopePath,'utf8'));
const snapshot=JSON.parse(fs.readFileSync(snapshotPath,'utf8'));
if(snapshot.commit!==scope.sourceCommit)throw Error('SCOPE_SNAPSHOT_COMMIT_MISMATCH');
const contract=fs.readFileSync('scripts/consolidation-release-contract.py','utf8');
const py=fs.readFileSync('scripts/frontend-consolidation-release.py','utf8');
const toolHash=crypto.createHash('sha256').update(contract).update(py).update(fs.readFileSync(__filename)).update(JSON.stringify(scope)).digest('hex');
// Contrato y verificador identifican staging: nunca reutiliza un intento fallido.
const stage='/opt/smartrayco-staging/frontend-consolidado-tr069-'+snapshot.commit.slice(0,7)+'-'+toolHash.slice(0,10);
const rt=path.resolve(option('--local-root','scripts/inventory-auth-lab/runtime/consolidation-release'),path.basename(stage));
fs.mkdirSync(rt,{recursive:true});
const ssh=['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),'root@192.168.55.201'];
const git=(...args)=>cp.execFileSync('git',args,{encoding:'utf8'});
if(action==='prepare'||action==='package'){
 const archive=path.join(rt,'source.tar');
 const manifest=path.join(rt,'package.json');
 const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
 // Nunca sobrescribe un paquete validado, ni siquiera antes de comprobarlo.
 let packaged=null;
 if(fs.existsSync(manifest)){
  packaged=JSON.parse(fs.readFileSync(manifest,'utf8'));
  if(packaged.toolHash!==toolHash||packaged.sourceCommit!==snapshot.commit||packaged.stage!==stage||JSON.stringify(packaged.scope)!==JSON.stringify(scope))throw Error('PACKAGE_CONTRACT_DRIFT');
  for(const[name,digest]of Object.entries(packaged.files)){
   if(path.basename(name)!==name)throw Error('INVALID_PACKAGE_FILE');
   if(hash(fs.readFileSync(path.join(rt,name)))!==digest)throw Error('PACKAGE_DRIFT:'+name);
  }
 }
 if(action==='prepare'&&!packaged)throw Error('VALIDATED_PACKAGE_REQUIRED');
 // Git escribe TODO el TAR: fecha del commit, uid/gid 0, permisos normalizados,
 // orden Git y sin atime/ctime del snapshot. No mezcla tar.exe/PAX de Windows.
 const temp=fs.mkdtempSync(path.join(rt,'archive-input-'));
 let archiveBytes;
 try{
  const fixedSnapshot=path.join(temp,'release-source.json');
  fs.writeFileSync(fixedSnapshot,fs.readFileSync(snapshotPath));fs.chmodSync(fixedSnapshot,0o644);
  const epoch=git('show','-s','--format=%ct',snapshot.commit).trim();
  const candidate=path.join(temp,'source.tar');
  cp.execFileSync('git',['-c','tar.umask=0022','archive',snapshot.commit,'--format=tar','--mtime=@'+epoch,'--add-file='+fixedSnapshot,'--output='+candidate,'src','index.html','vite.config.ts','package.json','package-lock.json','scripts/frontend-release-build.mjs','deploy/Dockerfile.frontend','deploy/frontend-release-policy.json']);
  archiveBytes=fs.readFileSync(candidate);
 }finally{
  // Solo archivos temporales propios; no elimina paquetes ni respaldos.
  for(const name of ['source.tar','release-source.json']){const file=path.join(temp,name);if(fs.existsSync(file))fs.unlinkSync(file);}
  fs.rmdirSync(temp);
 }
 // Exclusivamente el commit declarado; nunca pendientes del checkout.
 const back=Object.fromEntries(scope.backendSources.map(f=>[f,git('show',snapshot.commit+':'+f)]));
 const input={stage,commit:snapshot.commit,scope,toolHash,snapshot,back};
 const file=path.join(rt,'input.json'),inputBytes=Buffer.from(JSON.stringify(input));
 const persist=(name,bytes)=>{
  if(packaged){if(hash(bytes)!==packaged.files[name])throw Error('PACKAGE_REGENERATION_DRIFT:'+name);}
  else fs.writeFileSync(path.join(rt,name),bytes,{flag:'wx'});
 };
 persist('source.tar',archiveBytes);persist('input.json',inputBytes);
 // Preparación local revisable: no abre SSH, no crea staging en la VM.
 if(action==='package'){
  const migration=option('--migration',null),rollback=option('--sql-rollback',null);
  if(!!migration!==!!rollback)throw Error('INCOMPLETE_SQL_PACKAGE');
  const names=['source.tar','input.json'];
  for(const source of [migration,rollback].filter(Boolean)){
   if(!/^[a-zA-Z0-9_./-]+\.sql$/.test(source)||source.startsWith('/')||source.split('/').includes('..'))throw Error('INVALID_SQL_PACKAGE_PATH');
   const name=path.basename(source);if(names.includes(name))throw Error('DUPLICATE_PACKAGE_FILE');names.push(name);
   persist(name,Buffer.from(git('show',snapshot.commit+':'+source)));
  }
  const files=Object.fromEntries(names.map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(rt,name))).digest('hex')]));
  const report={localOnly:true,sourceCommit:snapshot.commit,toolHash,scope,stage,files,productionWrites:0};
  const reportBytes=Buffer.from(JSON.stringify(report,null,2)+'\n');
  if(packaged){if(!fs.readFileSync(manifest).equals(reportBytes))throw Error('PACKAGE_MANIFEST_DRIFT');}
  else fs.writeFileSync(manifest,reportBytes,{flag:'wx'});
  console.log(JSON.stringify({localOnly:true,sourceCommit:snapshot.commit,package:path.join(rt,'package.json'),productionWrites:0}));process.exit(0);
 }
 if(localOnly){console.log(JSON.stringify({prepared:true,localOnly:true,sourceCommit:snapshot.commit,package:manifest,files:packaged.files,productionWrites:0}));process.exit(0);}
 cp.execFileSync('ssh',[...ssh,'python3 -'],{input:'import pathlib\np=pathlib.Path('+JSON.stringify(stage)+');assert not p.exists(),"STAGE_ALREADY_EXISTS";p.mkdir(mode=0o700)\n',stdio:['pipe','pipe','pipe'],windowsHide:true});
 for(const[local,name]of[[archive,'source.tar'],[file,'input.json']])cp.execFileSync('scp',['-q','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),local,'root@192.168.55.201:'+stage+'/'+name],{stdio:['ignore','pipe','pipe'],windowsHide:true});
}
const source='ACTION='+JSON.stringify(action)+'\nSTAGE='+JSON.stringify(stage)+'\nTOOL_HASH='+JSON.stringify(toolHash)+'\ntry:\n'+(contract+'\n'+py).split('\n').map(l=>' '+l).join('\n')+'\nexcept Exception as e:\n print(json.dumps({"ok":False,"type":type(e).__name__,"reason":str(e) if isinstance(e,AssertionError) else "Private log in staging","stage":STAGE}));sys.exit(1)\n';
const result=cp.spawnSync('ssh',[...ssh,'python3 -'],{input:source,encoding:'utf8',timeout:900000,windowsHide:true,maxBuffer:4*1024*1024});
try{const data=JSON.parse(result.stdout);fs.writeFileSync(path.join(rt,action+'.json'),JSON.stringify(data,null,2)+'\n');console.log(JSON.stringify(data));}catch{console.error('RELEASE_FAILED_DETAILS_WITHHELD');process.exitCode=1;}
if(result.status!==0)process.exitCode=1;
