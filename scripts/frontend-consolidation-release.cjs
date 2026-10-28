// Solo empaqueta/promueve software; nunca llama endpoints de tareas GenieACS.
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path'),crypto=require('node:crypto');
const action=process.argv[2];
if(!['prepare','build','deploy','verify','rollback'].includes(action))throw Error('INVALID_ACTION');
const scope=JSON.parse(fs.readFileSync('deploy/consolidation-release-scope.json','utf8'));
const snapshot=JSON.parse(fs.readFileSync('release-source.json','utf8'));
if(snapshot.commit!==scope.sourceCommit)throw Error('SCOPE_SNAPSHOT_COMMIT_MISMATCH');
const contract=fs.readFileSync('scripts/consolidation-release-contract.py','utf8');
const py=fs.readFileSync('scripts/frontend-consolidation-release.py','utf8');
const toolHash=crypto.createHash('sha256').update(contract).update(py).update(fs.readFileSync(__filename)).update(JSON.stringify(scope)).digest('hex');
// Contrato y verificador identifican staging: nunca reutiliza un intento fallido.
const stage='/opt/smartrayco-staging/frontend-consolidado-tr069-'+snapshot.commit.slice(0,7)+'-'+toolHash.slice(0,10);
const rt=path.resolve('scripts/inventory-auth-lab/runtime/consolidation-release',path.basename(stage));
fs.mkdirSync(rt,{recursive:true});
const ssh=['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),'root@192.168.55.201'];
const git=(...args)=>cp.execFileSync('git',args,{encoding:'utf8'});
if(action==='prepare'){
 const archive=path.join(rt,'source.tar');
 cp.execFileSync('git',['archive',snapshot.commit,'--format=tar','--output='+archive,'src','index.html','vite.config.ts','package.json','package-lock.json','scripts/frontend-release-build.mjs','deploy/Dockerfile.frontend','deploy/frontend-release-policy.json']);
 cp.execFileSync('tar.exe',['-rf',archive,'release-source.json']);
 // Exclusivamente el commit declarado; nunca pendientes del checkout.
 const back=Object.fromEntries(scope.backendSources.map(f=>[f,git('show',snapshot.commit+':'+f)]));
 const input={stage,commit:snapshot.commit,scope,toolHash,snapshot,back};
 const file=path.join(rt,'input.json');fs.writeFileSync(file,JSON.stringify(input));
 cp.execFileSync('ssh',[...ssh,'python3 -'],{input:'import pathlib\np=pathlib.Path('+JSON.stringify(stage)+');assert not p.exists(),"STAGE_ALREADY_EXISTS";p.mkdir(mode=0o700)\n',stdio:['pipe','pipe','pipe'],windowsHide:true});
 for(const[local,name]of[[archive,'source.tar'],[file,'input.json']])cp.execFileSync('scp',['-q','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),local,'root@192.168.55.201:'+stage+'/'+name],{stdio:['ignore','pipe','pipe'],windowsHide:true});
}
const source='ACTION='+JSON.stringify(action)+'\nSTAGE='+JSON.stringify(stage)+'\nTOOL_HASH='+JSON.stringify(toolHash)+'\ntry:\n'+(contract+'\n'+py).split('\n').map(l=>' '+l).join('\n')+'\nexcept Exception as e:\n print(json.dumps({"ok":False,"type":type(e).__name__,"reason":str(e) if isinstance(e,AssertionError) else "Private log in staging","stage":STAGE}));sys.exit(1)\n';
const result=cp.spawnSync('ssh',[...ssh,'python3 -'],{input:source,encoding:'utf8',timeout:900000,windowsHide:true,maxBuffer:4*1024*1024});
try{const data=JSON.parse(result.stdout);fs.writeFileSync(path.join(rt,action+'.json'),JSON.stringify(data,null,2)+'\n');console.log(JSON.stringify(data));}catch{console.error('RELEASE_FAILED_DETAILS_WITHHELD');process.exitCode=1;}
if(result.status!==0)process.exitCode=1;
